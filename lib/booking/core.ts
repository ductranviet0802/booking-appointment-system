// Booking core: the one write path for create / change / cancel (P13, P16, S01, S02). Every rule of P13 §4.2 / S02
// event 10 is re-checked inside one transaction (F4-07) under row locks taken in a fixed order — account → patient →
// booking → frames (by id) — so withdrawal (P06), member delete (P07) and two confirms for the last seat serialise.
// The CHECK 0 ≤ reserved_count ≤ capacity (03 §3.13) stays the last guard against over-booking.
import { randomInt } from "node:crypto";
import { Prisma, type Booking, type BookingChannel, type CancelReason, type Language } from "@prisma/client";
import { encryptJson, encryptText } from "@/lib/crypto/field";
import { addDays, dbDate, dbTime, jstInstant, todayJst, toHhmm, toIsoDate } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { deliverAfterCommit, enqueueBookingNotice } from "./notify";
import { beforeDeadline, policyOf } from "./policy";

type Tx = Prisma.TransactionClient;

export type Actor = { kind: "PATIENT" | "STAFF"; accountId: string; channel: BookingChannel };

export type BookingInput = {
  clinicId: string;
  departmentId: string;
  visitTypeId: string;
  patientId: string;
  /** null = 指名なし: the system assigns the least-booked doctor (F4-04) */
  doctorId: string | null;
  /** false with a doctorId = staff picked a doctor's frame under 指名なし (F4-04 staff exception) */
  doctorRequested: boolean;
  slotDate: string;
  startTime: string;
  /** plain text ≤ 200 (F10-06); stored encrypted */
  notes: string | null;
  /** 初診 new booking only (P12) */
  questionnaire?: { formVersion: string; language: Language; answers: unknown } | null;
};

/** rule names; screens map them: PATIENT_CODE (P11 / P13 / P16), STAFF_CODE (S01 / S02) */
export type Rule =
  | "WINDOW" | "CUTOFF" | "CLOSED" | "TAKEN" | "LIMIT" | "OVERLAP"
  | "STALE" | "NOT_RESERVED" | "ALREADY_CANCELED" | "DEADLINE";

export const PATIENT_CODE: Record<Rule, string> = {
  WINDOW: "PE031", CUTOFF: "PE032", CLOSED: "PE035", TAKEN: "PE030", LIMIT: "PE033", OVERLAP: "PE034",
  STALE: "PE047", NOT_RESERVED: "PE045", ALREADY_CANCELED: "PE044", DEADLINE: "PE041",
};
export const STAFF_CODE: Record<Rule, string> = {
  WINDOW: "SE022", CUTOFF: "SE022", CLOSED: "SE023", TAKEN: "SE020", LIMIT: "SW020", OVERLAP: "SE021",
  STALE: "SE010", NOT_RESERVED: "SE010", ALREADY_CANCELED: "SE010", DEADLINE: "SE010",
};
/** one message per request, the first failing rule (P13 §4.2 order; S02 Q6: limit last) */
export const PATIENT_ORDER: Rule[] = ["WINDOW", "CUTOFF", "CLOSED", "TAKEN", "LIMIT", "OVERLAP"];
export const STAFF_ORDER: Rule[] = ["WINDOW", "CLOSED", "TAKEN", "OVERLAP", "LIMIT"];

export type Options = {
  /** same-day cut-off (F4-05); default on for patients, off for staff (F14-03) */
  cutoff?: boolean;
  /** S02 SW020 answered はい: the per-person limit does not block (F4-06) */
  overrideLimit?: boolean;
  /** web change / cancel deadline (F5-03); default on for patients, off for staff (F5-04); 要調整 is exempt */
  deadline?: boolean;
  /** queue NT-01 / NT-03 / NT-04; default true (staff reassigning a doctor only sends none, F4-04) */
  notify?: boolean;
  /** one result per draft / submit: a repeat with the same key returns the first success (F4-07, Q14) */
  idempotencyKey?: string;
  /** account written to bookings.booked_by_account_id; default the actor */
  bookedByAccountId?: string | null;
  now?: Date;
};

export type BookOk = { ok: true; bookingId: string; bookingNo: string; notificationId: string | null };
export type Fail = { ok: false; rule: Rule; failed: Rule[]; sameDayBookingNos?: string[] };
export type CancelOk = { ok: true; bookingId: string; notificationId: string | null };

// ── public entry points (own transaction, delivery after commit) ──────────────────────────────────────────────────

export const createBooking = (input: BookingInput, actor: Actor, opts: Options = {}) =>
  once(actor, opts, () => withTx((tx) => bookInTx(tx, input, actor, opts)));

/** change mode: `version` = the value read when the change started (optimistic lock, P13 Q6 / S02 SE010) */
export const changeBooking = (bookingId: string, version: number, input: BookingInput, actor: Actor, opts: Options = {}) =>
  once(actor, opts, () => withTx((tx) => bookInTx(tx, input, actor, opts, { bookingId, version })));

export const cancelBooking = (c: CancelInput, actor: Actor, opts: Options = {}) =>
  once(actor, opts, () => withTx((tx) => cancelInTx(tx, c, actor, opts)));

async function withTx<T extends { ok: boolean; notificationId?: string | null }>(fn: (tx: Tx) => Promise<T>) {
  const r = await prisma.$transaction(fn, { timeout: 15_000 });
  if (r.ok && r.notificationId) await deliverAfterCommit([r.notificationId]);
  return r;
}

// shortcut: in-process single-flight per key, single instance only; persist the key with the booking before scaling out.
const g = globalThis as unknown as { bookingOnce?: Map<string, { at: number; p: Promise<unknown> }> };
const done = (g.bookingOnce ??= new Map());
const ONCE_MS = 30 * 60_000; // the draft lifetime (P11 Q1)

async function once<T extends { ok: boolean }>(actor: Actor, opts: Options, fn: () => Promise<T>): Promise<T> {
  if (!opts.idempotencyKey) return fn();
  const key = `${actor.accountId}:${opts.idempotencyKey}`;
  const now = Date.now();
  for (const [k, v] of done) if (now - v.at > ONCE_MS) done.delete(k);
  const hit = done.get(key);
  if (hit) return hit.p as Promise<T>;
  const p = fn().then(
    (r) => { if (!r.ok) done.delete(key); return r; }, // a failure wrote nothing: a retry runs again
    (e) => { done.delete(key); throw e; },
  );
  done.set(key, { at: now, p });
  return p;
}

// ── locks ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** account row (if any) then patient row; refuses a merged or anonymised patient. Status writes outside this file
 *  (S01 check-in / no-show, B4) take lockPerson then lockBooking too, so every booking write locks in one order.
 *  `lock` false = the same refusal without row locks (checkBooking). */
export async function lockPerson(tx: Tx, patientId: string, lock = true) {
  const p = await tx.patient.findUniqueOrThrow({ where: { id: patientId }, select: { accountId: true } });
  if (lock && p.accountId) await tx.$queryRaw`SELECT 1 FROM accounts WHERE id = ${p.accountId}::uuid FOR UPDATE`;
  const [row] = await tx.$queryRaw<{ merged: boolean; anon: boolean }[]>`
    SELECT merged_into_id IS NOT NULL AS merged, anonymized_at IS NOT NULL AS anon FROM patients WHERE id = ${patientId}::uuid ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`;
  if (row.merged || row.anon) throw new Error(`patient ${patientId} is merged or anonymised`);
}

export const lockBooking = (tx: Tx, id: string) => tx.$queryRaw`SELECT 1 FROM bookings WHERE id = ${id}::uuid FOR UPDATE`;

type Frame = { id: string; doctor_id: string; start: string; end: string; capacity: number; reserved: number; status: "OPEN" | "CLOSED" };

// ── create / change ───────────────────────────────────────────────────────────────────────────────────────────────

export async function bookInTx(
  tx: Tx, input: BookingInput, actor: Actor, opts: Options = {}, changing?: { bookingId: string; version: number },
): Promise<BookOk | Fail> {
  const plan = await rulesOf(tx, input, actor, opts, changing, true);
  if (!plan.ok) return plan;
  const { old, oldFrames, doctorId, frames, endIso, vt, now } = plan;
  const startIso = input.startTime;

  // writes (P13 更新1–11, S02 event 10)
  if (old) {
    await tx.bookingSlot.deleteMany({ where: { bookingId: old.id } });
    for (const id of oldFrames) await tx.slot.update({ where: { id }, data: { reservedCount: { decrement: 1 } } });
  }
  const data = {
    doctorId, doctorRequested: input.doctorRequested, slotDate: dbDate(input.slotDate),
    startTime: dbTime(startIso), endTime: dbTime(endIso), notes: input.notes ? encryptText(input.notes) : null,
  };
  let bookingId: string;
  let bookingNo: string;
  if (old) {
    const moved = await tx.booking.updateMany({
      where: { id: old.id, version: old.version, status: "RESERVED" },
      data: { ...data, changeCount: { increment: 1 }, version: { increment: 1 }, adjustRequiredAt: null },
    });
    if (moved.count !== 1) throw new Error("booking changed under its lock");
    [bookingId, bookingNo] = [old.id, old.bookingNo];
    const at = now;
    const actorCols = { actorKind: actor.kind, actorAccountId: actor.accountId, channel: actor.kind === "STAFF" ? actor.channel : null, at };
    await tx.bookingEvent.create({ data: { bookingId, event: "CHANGED", ...actorCols, before: snapshot(old), after: snapshot({ ...data, status: "RESERVED" }) } });
    if (old.adjustRequiredAt) await tx.bookingEvent.create({ data: { bookingId, event: "ADJUST_CLEARED", ...actorCols } });
    await tx.questionnaire.updateMany({ where: { bookingId }, data: { purgeAfter: dbDate(addDays(input.slotDate, 90)) } }); // Q8 c, 06 §5
  } else {
    bookingNo = await newBookingNo(tx);
    const created = await tx.booking.create({
      data: {
        ...data, bookingNo, clinicId: input.clinicId, departmentId: input.departmentId, visitTypeId: input.visitTypeId,
        patientId: input.patientId, bookedByAccountId: opts.bookedByAccountId === undefined ? actor.accountId : opts.bookedByAccountId,
        channel: actor.channel, status: "RESERVED", priceYen: vt.category === "SELF_PAY" ? vt.priceYen : null,
      },
    });
    bookingId = created.id;
    await tx.bookingEvent.create({
      data: {
        bookingId, event: "CREATED", actorKind: actor.kind, actorAccountId: actor.accountId,
        channel: actor.kind === "STAFF" ? actor.channel : null, after: snapshot({ ...data, status: "RESERVED" }), at: now,
      },
    });
    if (input.questionnaire) {
      await tx.questionnaire.create({
        data: {
          bookingId, formVersion: input.questionnaire.formVersion, language: input.questionnaire.language,
          answers: encryptJson(input.questionnaire.answers), submittedAt: now, purgeAfter: dbDate(addDays(input.slotDate, 90)),
        },
      });
    }
  }
  await tx.bookingSlot.createMany({ data: frames.map((f) => ({ bookingId, slotId: f.id })) });
  for (const f of frames) await tx.slot.update({ where: { id: f.id }, data: { reservedCount: { increment: 1 } } });

  const notificationId = opts.notify === false ? null : await enqueueBookingNotice(tx, bookingId, old ? "NT03_CHANGED" : "NT01_BOOKED");
  return { ok: true, bookingId, bookingNo, notificationId };
}

export type CheckOk = { ok: true; doctorId: string; endTime: string };

/**
 * Read-only entry (P11 event 11 / 抽出11): the rules of bookInTx / change in the same order with the same Fail, without a
 * write and without row locks — the transactional claim stays P13's (F4-07). `changing.version` omitted = STALE not
 * compared (P11 does not know a newer version yet; P13 compares it).
 */
export async function checkBooking(
  input: BookingInput, actor: Actor, opts: Options = {}, changing?: { bookingId: string; version?: number },
): Promise<CheckOk | Fail> {
  const r = await rulesOf(prisma as unknown as Tx, input, actor, opts, changing, false);
  return r.ok ? { ok: true, doctorId: r.doctorId, endTime: r.endIso } : r;
}

/** the rules of P13 §4.2 / S02 event 10 and the frames they pick; `lock` = take the row locks (inside bookInTx) */
async function rulesOf(tx: Tx, input: BookingInput, actor: Actor, opts: Options, changing: { bookingId: string; version?: number } | undefined, lock: boolean) {
  const now = opts.now ?? new Date();
  const patient = actor.kind === "PATIENT";
  // values a screen cannot produce: the caller turns a throw into ER-02 (nothing written)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.slotDate) || toIsoDate(dbDate(input.slotDate)) !== input.slotDate || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startTime)) {
    throw new Error("bad slot date / start time");
  }
  if (input.notes && input.notes.length > 200) throw new Error("notes over 200 characters");
  await lockPerson(tx, input.patientId, lock);

  let old: Booking | null = null;
  let oldFrames = new Set<string>();
  if (changing) {
    if (lock) await lockBooking(tx, changing.bookingId);
    old = await tx.booking.findUniqueOrThrow({ where: { id: changing.bookingId } });
    if (old.patientId !== input.patientId || old.clinicId !== input.clinicId || old.departmentId !== input.departmentId || old.visitTypeId !== input.visitTypeId) {
      throw new Error("change mode keeps patient, clinic, department and visit type (F5-01)");
    }
    if (old.status !== "RESERVED") return fail("NOT_RESERVED");
    // status → deadline → version, as cancel (P16 5-1 / Q4)
    if ((opts.deadline ?? patient) && !old.adjustRequiredAt && !beforeDeadline(await policyOf(old.clinicId, tx), toIsoDate(old.slotDate), toHhmm(old.startTime), now)) {
      return fail("DEADLINE");
    }
    if (changing.version !== undefined && old.version !== changing.version) return fail("STALE");
    oldFrames = new Set((await tx.bookingSlot.findMany({ where: { bookingId: old.id }, select: { slotId: true } })).map((r) => r.slotId));
  }

  const policy = await policyOf(input.clinicId, tx);
  const vt = await tx.visitType.findUnique({ where: { id: input.visitTypeId } });
  const masterOk = !!vt && vt.isActive && vt.clinicId === input.clinicId && vt.departmentId === input.departmentId && (!patient || vt.webBookable);
  const n = vt?.durationFrames ?? 1;

  // frames of clinic × department × date from the start on (one frame ≤ 30 min, so n × 30 min bounds the run) of active
  // doctors (a deactivated doctor's frames are not bookable, P11 抽出6), locked by id
  const startIso = input.startTime;
  const until = addMinutes(startIso, n * 30);
  const rows = await tx.$queryRaw<Frame[]>`
    SELECT id::text, doctor_id::text, to_char(start_time, 'HH24:MI') AS start, to_char(end_time, 'HH24:MI') AS "end",
           capacity, reserved_count AS reserved, status::text AS status
      FROM slots
     WHERE clinic_id = ${input.clinicId}::uuid AND department_id = ${input.departmentId}::uuid AND slot_date = ${input.slotDate}::date
       AND start_time >= ${startIso}::time AND start_time < ${until}::time
       AND doctor_id IN (SELECT id FROM doctors WHERE is_active)
       ${input.doctorId ? Prisma.sql`AND doctor_id = ${input.doctorId}::uuid` : Prisma.empty}
     ORDER BY id ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`;
  const free = (f: Frame) => f.status === "OPEN" && f.reserved - (oldFrames.has(f.id) ? 1 : 0) < f.capacity;

  /** the run of n consecutive frames of one doctor from the start, or null when the doctor has no such run */
  const runOf = (doctorId: string) => {
    const mine = rows.filter((f) => f.doctor_id === doctorId).sort((a, b) => a.start.localeCompare(b.start));
    const run: Frame[] = [];
    let at = startIso;
    for (const f of mine) {
      if (f.start !== at) continue;
      run.push(f);
      at = f.end;
      if (run.length === n) return run;
    }
    return null;
  };

  const failed = new Set<Rule>();
  const today = todayJst(now);
  if (input.slotDate < today || input.slotDate > addDays(today, policy.bookingWindowDays)) failed.add("WINDOW");
  if ((opts.cutoff ?? patient) && input.slotDate === today && jstInstant(input.slotDate, startIso).getTime() < now.getTime() + policy.sameDayCutoffMinutes * 60_000) {
    failed.add("CUTOFF");
  }

  let doctorId = input.doctorId;
  let run: Frame[] | null = null;
  if (!masterOk) failed.add("TAKEN"); // master no longer bookable = frame no longer bookable (P13 5-1)
  else if (doctorId) {
    run = runOf(doctorId);
    if (!run) failed.add("TAKEN");
    else if (run.some((f) => f.status === "CLOSED")) failed.add("CLOSED");
    else if (!run.every(free)) failed.add("TAKEN");
  } else {
    const runs = [...new Set(rows.map((f) => f.doctor_id))].map((d) => [d, runOf(d)] as const).filter((x): x is readonly [string, Frame[]] => !!x[1]);
    const fits = runs.filter(([, r]) => r.every(free));
    if (fits.length === 0) failed.add(runs.length > 0 && runs.every(([, r]) => r.some((f) => f.status === "CLOSED")) ? "CLOSED" : "TAKEN");
    else [doctorId, run] = await leastBooked(tx, input, fits, changing?.bookingId);
  }

  const notSelf = changing ? { id: { not: changing.bookingId } } : {};
  const sameDay = await tx.booking.findMany({
    where: { patientId: input.patientId, slotDate: dbDate(input.slotDate), status: { in: ["RESERVED", "CHECKED_IN"] }, ...notSelf },
    select: { clinicId: true, bookingNo: true, startTime: true, endTime: true },
    orderBy: { startTime: "asc" },
  });
  // per person × clinic × date: RESERVED and CHECKED_IN count (F4-06, P11 Q29 A, 質疑 Q-046 answered)
  const limitRows = sameDay.filter((b) => b.clinicId === input.clinicId);
  if (!opts.overrideLimit && limitRows.length >= policy.perPersonDailyLimit) failed.add("LIMIT");
  const endIso = run ? run[run.length - 1].end : addMinutes(startIso, n * policy.frameMinutes);
  if (sameDay.some((b) => toHhmm(b.startTime) < endIso && toHhmm(b.endTime) > startIso)) failed.add("OVERLAP");

  if (failed.size > 0) {
    const order = patient ? PATIENT_ORDER : STAFF_ORDER;
    const list = order.filter((r) => failed.has(r));
    return { ok: false, rule: list[0], failed: list, sameDayBookingNos: failed.has("LIMIT") ? limitRows.map((b) => b.bookingNo) : undefined } satisfies Fail;
  }
  return { ok: true as const, old, oldFrames, doctorId: doctorId!, frames: run!, endIso, vt: vt!, now };
}

/** 指名なし (F4-04, P13 抽出5, Q7 A): fewest RESERVED + CHECKED_IN bookings at the clinic that date, tie display_order */
async function leastBooked(tx: Tx, input: BookingInput, fits: ReadonlyArray<readonly [string, Frame[]]>, exclude?: string): Promise<[string, Frame[]]> {
  const ids = fits.map(([d]) => d);
  const counts = await tx.booking.groupBy({
    by: ["doctorId"], _count: { _all: true },
    where: { doctorId: { in: ids }, clinicId: input.clinicId, slotDate: dbDate(input.slotDate), status: { in: ["RESERVED", "CHECKED_IN"] }, ...(exclude && { id: { not: exclude } }) },
  });
  const order = new Map((await tx.doctor.findMany({ where: { id: { in: ids } }, select: { id: true, displayOrder: true } })).map((d) => [d.id, d.displayOrder]));
  const count = new Map(counts.map((c) => [c.doctorId, c._count._all]));
  const best = [...fits].sort(([a], [b]) => (count.get(a) ?? 0) - (count.get(b) ?? 0) || (order.get(a) ?? 0) - (order.get(b) ?? 0))[0];
  return [best[0], best[1]];
}

// ── cancel ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type CancelInput = {
  bookingId: string;
  /** optimistic lock (S01 / P16); omitted = not compared */
  version?: number;
  reasonCode: CancelReason;
  /** ≤ 200; required by the screen for OTHER (F5-02) */
  reasonText: string | null;
};

export async function cancelInTx(tx: Tx, c: CancelInput, actor: Actor, opts: Options = {}): Promise<CancelOk | Fail> {
  const now = opts.now ?? new Date();
  const head = await tx.booking.findUniqueOrThrow({ where: { id: c.bookingId }, select: { patientId: true } });
  await lockPerson(tx, head.patientId);
  await lockBooking(tx, c.bookingId);
  const b = await tx.booking.findUniqueOrThrow({ where: { id: c.bookingId } });
  if (b.status === "CANCELED") return fail("ALREADY_CANCELED");
  if (b.status !== "RESERVED") return fail("NOT_RESERVED");
  // P16 5-1 / Q4: status → deadline → version
  if ((opts.deadline ?? actor.kind === "PATIENT") && !b.adjustRequiredAt && !beforeDeadline(await policyOf(b.clinicId, tx), toIsoDate(b.slotDate), toHhmm(b.startTime), now)) {
    return fail("DEADLINE");
  }
  if (c.version !== undefined && b.version !== c.version) return fail("STALE");

  const frames = await tx.bookingSlot.findMany({ where: { bookingId: b.id }, select: { slotId: true } });
  await tx.bookingSlot.deleteMany({ where: { bookingId: b.id } }); // F5-05: frames free at once
  for (const f of frames) await tx.slot.update({ where: { id: f.slotId }, data: { reservedCount: { decrement: 1 } } });
  await tx.booking.update({
    where: { id: b.id },
    data: {
      status: "CANCELED", canceledAt: now, canceledByKind: actor.kind, canceledByAccountId: actor.accountId,
      cancelReasonCode: c.reasonCode, cancelReasonText: c.reasonText || null, version: { increment: 1 }, adjustRequiredAt: null,
    },
  });
  const actorCols = { actorKind: actor.kind, actorAccountId: actor.accountId, channel: actor.kind === "STAFF" ? actor.channel : null, at: now };
  await tx.bookingEvent.create({ data: { bookingId: b.id, event: "CANCELED", ...actorCols, before: snapshot(b), after: { ...snapshot(b), status: "CANCELED" } } });
  if (b.adjustRequiredAt) await tx.bookingEvent.create({ data: { bookingId: b.id, event: "ADJUST_CLEARED", ...actorCols } });

  const notificationId = opts.notify === false ? null : await enqueueBookingNotice(tx, b.id, "NT04_CANCELED");
  return { ok: true, bookingId: b.id, notificationId };
}

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────

const fail = (rule: Rule): Fail => ({ ok: false, rule, failed: [rule] });

/** booking_events before / after: date, time, doctor, status (03 §3.24) */
const snapshot = (b: { slotDate: Date; startTime: Date; endTime: Date; doctorId: string; doctorRequested: boolean; status: string }) => ({
  date: toIsoDate(b.slotDate), start: toHhmm(b.startTime), end: toHhmm(b.endTime), doctorId: b.doctorId, doctorRequested: b.doctorRequested, status: b.status,
});

function addMinutes(hhmm: string, minutes: number) {
  const [h, m] = hhmm.split(":").map(Number);
  const t = Math.min(h * 60 + m + minutes, 24 * 60 - 1);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // F7-01: no I, O

/** F7-01 / 03 §3.22 `^[A-HJ-NP-Z]{4}[0-9]{4}$`, unique (checked inside the transaction; 24⁴ × 10⁴ values) */
export async function newBookingNo(tx: Tx) {
  for (let i = 0; i < 5; i++) {
    const no = Array.from({ length: 4 }, () => LETTERS[randomInt(LETTERS.length)]).join("") + String(randomInt(10_000)).padStart(4, "0");
    if (!(await tx.booking.count({ where: { bookingNo: no } }))) return no;
  }
  throw new Error("no free booking number after 5 tries");
}
