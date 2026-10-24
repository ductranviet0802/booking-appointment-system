// B2 枠生成 (06 §B2): frames from the calendar and the shifts. Pure planning first (rows in → inserts / closes / reopens /
// substitutions out), then a thin database part per clinic. Idempotent (unique key doctor × date × start on slots), never
// cancels a booking. The open-band computation of step 1 is exported for the booking screens (`openBandsForDate`).
import type { Band, Prisma } from "@prisma/client";
import { deliverAfterCommit, enqueueBookingNotice } from "@/lib/booking/notify";
import { addDays, dbDate, dbTime, todayJst, toHhmm, toIsoDate, weekdayOf } from "@/lib/datetime";
import { log } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type { Job, JobResult } from "@/lib/batch/runner";
import { openBandsOfDay, type CalendarRow, type HourRow, type OpenBand } from "@/lib/public/hours";

type Db = Prisma.TransactionClient;

// ── pure part ────────────────────────────────────────────────────────────────────────────────────────────────────────

const mins = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** the frames of [start, end) of `fm` minutes; the last frame must end ≤ end (step 3) */
export function cutFrames(start: string, end: string, fm: number): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let t = mins(start); t + fm <= mins(end); t += fm) out.push([hhmm(t), hhmm(t + fm)]);
  return out;
}

/** Step 1: the bands a clinic is open on a date. A holiday closes the day unless the date is SPECIAL_OPEN (F3-03). */
export function openBandsOn(date: string, hours: HourRow[], calendar: CalendarRow | null, isHoliday: boolean): OpenBand[] {
  if (isHoliday && calendar && calendar.kind !== "SPECIAL_OPEN") return [];
  return openBandsOfDay({ weekday: weekdayOf(date), hours, calendar, isHoliday });
}

export type PatternRow = {
  doctorId: string; departmentId: string; weekday: number; band: Band; start: string; end: string; validFrom: string; validTo: string | null;
};
export type ExceptionRow = {
  doctorId: string; date: string; kind: "OFF" | "EXTRA" | "SUBSTITUTE"; clinicId: string | null; departmentId: string | null;
  band: Band | null; start: string | null; end: string | null; substituteDoctorId: string | null;
};
export type ExistingFrame = { id: string; doctorId: string; date: string; start: string; end: string; status: "OPEN" | "CLOSED"; reserved: number };
export type FrameKey = { doctorId: string; departmentId: string; date: string; start: string; end: string };
export type ShiftBand = { doctorId: string; departmentId: string; band: Band; start: string; end: string };
export type Plan = {
  inserts: FrameKey[];
  closes: Array<{ id: string; reason: "HOLIDAY" | "CLINIC_CLOSED" | "DOCTOR_OFF"; reserved: number }>;
  reopens: string[];
  /** step 7: the frame of the absent doctor and the frame of the substitute it moves to */
  moves: Array<{ fromId: string; to: { doctorId: string; departmentId: string; date: string; start: string } }>;
};
export type PlanInput = {
  clinicId: string; dates: string[]; frameMinutes: number; hours: HourRow[]; calendar: Map<string, CalendarRow>; holidays: Set<string>;
  /** the patterns of this clinic */
  patterns: PatternRow[]; exceptions: ExceptionRow[]; existing: ExistingFrame[];
};

/** Step 2: shift bands of one date at the clinic = patterns valid that date ∩ open bands, plus EXTRA, minus OFF; SUBSTITUTE hands the band over */
export function shiftBandsOn(o: {
  date: string; clinicId: string; open: OpenBand[]; patterns: PatternRow[]; exceptions: ExceptionRow[];
}): { entries: ShiftBand[]; substitutions: Array<{ from: ShiftBand; to: ShiftBand }> } {
  const wd = weekdayOf(o.date);
  let entries: ShiftBand[] = [];
  for (const p of o.patterns) {
    if (p.weekday !== wd || p.validFrom > o.date || (p.validTo !== null && p.validTo < o.date)) continue;
    const ob = o.open.find((b) => b.band === p.band);
    if (!ob) continue;
    const start = mins(p.start) > mins(ob.open) ? p.start : ob.open;
    const end = mins(p.end) < mins(ob.close) ? p.end : ob.close;
    if (mins(start) < mins(end)) entries.push({ doctorId: p.doctorId, departmentId: p.departmentId, band: p.band, start, end });
  }
  const todays = o.exceptions.filter((e) => e.date === o.date);
  for (const e of todays) {
    if (e.kind === "EXTRA" && e.clinicId === o.clinicId && e.departmentId && e.band && e.start && e.end && mins(e.start) < mins(e.end)) {
      entries.push({ doctorId: e.doctorId, departmentId: e.departmentId, band: e.band, start: e.start, end: e.end });
    }
  }
  for (const e of todays) {
    if (e.kind === "OFF") entries = entries.filter((s) => !(s.doctorId === e.doctorId && (e.band === null || s.band === e.band)));
  }
  const substitutions: Array<{ from: ShiftBand; to: ShiftBand }> = [];
  for (const e of todays) {
    if (e.kind !== "SUBSTITUTE" || e.clinicId !== o.clinicId || !e.substituteDoctorId || !e.departmentId || !e.band) continue;
    entries = entries.map((s) => {
      if (s.doctorId !== e.doctorId || s.band !== e.band) return s;
      const to = { ...s, doctorId: e.substituteDoctorId as string, departmentId: e.departmentId as string };
      substitutions.push({ from: s, to });
      return to;
    });
  }
  return { entries, substitutions };
}

/** Steps 1–7 of one clinic over `dates`, from the rows read; nothing is written here */
export function planFrames(i: PlanInput): Plan {
  const plan: Plan = { inserts: [], closes: [], reopens: [], moves: [] };
  for (const date of i.dates) {
    const day = i.existing.filter((f) => f.date === date);
    // 「existing frames keep their length」: a date that has frames keeps the length of its first frame
    const fm = day.length ? Math.max(1, mins(day[0].end) - mins(day[0].start)) : i.frameMinutes;
    const holiday = i.holidays.has(date);
    const open = openBandsOn(date, i.hours, i.calendar.get(date) ?? null, holiday);
    const { entries, substitutions } = shiftBandsOn({ date, clinicId: i.clinicId, open, patterns: i.patterns, exceptions: i.exceptions });

    const desired = new Map<string, FrameKey>();
    for (const e of entries) {
      for (const [start, end] of cutFrames(e.start, e.end, fm)) {
        const k = `${e.doctorId}|${start}`;
        if (!desired.has(k)) desired.set(k, { doctorId: e.doctorId, departmentId: e.departmentId, date, start, end });
      }
    }
    const existing = new Map(day.map((f) => [`${f.doctorId}|${f.start}`, f]));
    for (const [k, frame] of desired) if (!existing.has(k)) plan.inserts.push(frame);
    for (const f of day) {
      if (desired.has(`${f.doctorId}|${f.start}`)) {
        if (f.status === "CLOSED") plan.reopens.push(f.id);
      } else if (f.status === "OPEN") {
        const inOpenBand = open.some((b) => mins(f.start) >= mins(b.open) && mins(f.start) < mins(b.close));
        const reason = inOpenBand ? "DOCTOR_OFF" : open.length === 0 && holiday ? "HOLIDAY" : "CLINIC_CLOSED";
        plan.closes.push({ id: f.id, reason, reserved: f.reserved });
      }
    }
    for (const s of substitutions) {
      for (const [start] of cutFrames(s.from.start, s.from.end, fm)) {
        const x = existing.get(`${s.from.doctorId}|${start}`);
        if (x && x.status === "OPEN" && x.reserved > 0) {
          plan.moves.push({ fromId: x.id, to: { doctorId: s.to.doctorId, departmentId: s.to.departmentId, date, start } });
        }
      }
    }
  }
  return plan;
}

// ── database part ────────────────────────────────────────────────────────────────────────────────────────────────────

export type B2Counts = {
  read: number; inserted: number; closed: number; reopened: number;
  /** OPEN frames holding a booking that the run closes (SW040 / SW041 {n}) */
  closedWithBookings: number;
  /** bookings newly marked 要調整 */
  adjusted: number;
  /** bookings moved to the substitute (step 7) */
  moved: number;
};
const noCounts = (): B2Counts => ({ read: 0, inserted: 0, closed: 0, reopened: 0, closedWithBookings: 0, adjusted: 0, moved: 0 });

const iso = (d: Date) => toIsoDate(d);
export const daysBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

/** the daily range of 06 B2 Trigger: today … today + booking_window_days + 7 */
export async function dailyRange(db: Db, clinicId: string, now = new Date()) {
  const policy = await db.bookingPolicy.findUnique({ where: { clinicId }, select: { bookingWindowDays: true } });
  const from = todayJst(now);
  return { from, to: addDays(from, (policy?.bookingWindowDays ?? 30) + 7) };
}

/** The bands a clinic is open on a date (step 1): weekday hours modified by the calendar day, holidays, SPECIAL_OPEN over a holiday. [] = closed. */
export async function openBandsForDate(db: Db, clinicId: string, date: string): Promise<OpenBand[]> {
  const [hours, cal, holiday] = await Promise.all([
    db.clinicBusinessHour.findMany({ where: { clinicId } }),
    db.clinicCalendarDay.findUnique({ where: { clinicId_calDate: { clinicId, calDate: dbDate(date) } } }),
    db.holiday.findFirst({ where: { holidayDate: dbDate(date), isActive: true } }),
  ]);
  return openBandsOn(date, hours.map(hourRow), cal ? calendarRow(cal) : null, !!holiday);
}

const hourRow = (h: { weekday: number; band: Band; openTime: Date; closeTime: Date; receptionEndTime: Date | null }): HourRow => ({
  weekday: h.weekday, band: h.band, open: toHhmm(h.openTime), close: toHhmm(h.closeTime), reception: h.receptionEndTime ? toHhmm(h.receptionEndTime) : null,
});
const hm = (d: Date | null) => (d ? toHhmm(d) : null);
const calendarRow = (c: { kind: CalendarRow["kind"]; amOpen: Date | null; amClose: Date | null; pmOpen: Date | null; pmClose: Date | null }): CalendarRow => ({
  kind: c.kind, amOpen: hm(c.amOpen), amClose: hm(c.amClose), pmOpen: hm(c.pmOpen), pmClose: hm(c.pmClose),
});

/** 要調整 count of a clinic (RESERVED with adjust_required_at; A01 抽出8, A02 抽出8, S01 SI014) */
export const adjustRequiredCount = (db: Db, clinicId: string) =>
  db.booking.count({ where: { clinicId, status: "RESERVED", adjustRequiredAt: { not: null } } });

/** Reads the rows of one clinic and plans; with `write` also applies the plan (steps 4–7). The caller owns the transaction. */
export async function generateClinic(
  db: Db,
  o: { clinicId: string; dates: string[]; runId: string | null; now: Date; dryRun: boolean },
): Promise<{ counts: B2Counts; plan: Plan; substituted: string[] }> {
  const counts = noCounts();
  const empty = { counts, plan: { inserts: [], closes: [], reopens: [], moves: [] } as Plan, substituted: [] as string[] };
  if (o.dates.length === 0) return empty;
  const dates = [...o.dates].sort();
  const dbDates = dates.map(dbDate);
  const [hours, calDays, holidays, policy, patterns, exceptions, slots] = await Promise.all([
    db.clinicBusinessHour.findMany({ where: { clinicId: o.clinicId } }),
    db.clinicCalendarDay.findMany({ where: { clinicId: o.clinicId, calDate: { in: dbDates } } }),
    db.holiday.findMany({ where: { holidayDate: { in: dbDates }, isActive: true } }),
    db.bookingPolicy.findUnique({ where: { clinicId: o.clinicId } }),
    db.doctorShiftPattern.findMany({
      where: { clinicId: o.clinicId, validFrom: { lte: dbDate(dates[dates.length - 1]) }, OR: [{ validTo: null }, { validTo: { gte: dbDate(dates[0]) } }] },
    }),
    db.doctorShiftException.findMany({ where: { shiftDate: { in: dbDates } } }),
    db.slot.findMany({ where: { clinicId: o.clinicId, slotDate: { in: dbDates } } }),
  ]);
  const capacity = policy?.frameCapacity ?? 1;
  const plan = planFrames({
    clinicId: o.clinicId, dates, frameMinutes: policy?.frameMinutes ?? 15, hours: hours.map(hourRow),
    calendar: new Map(calDays.map((c) => [iso(c.calDate), calendarRow(c)])), holidays: new Set(holidays.map((h) => iso(h.holidayDate))),
    patterns: patterns.map((p) => ({
      doctorId: p.doctorId, departmentId: p.departmentId, weekday: p.weekday, band: p.band, start: toHhmm(p.startTime), end: toHhmm(p.endTime),
      validFrom: iso(p.validFrom), validTo: p.validTo ? iso(p.validTo) : null,
    })),
    exceptions: exceptions.map((e) => ({
      doctorId: e.doctorId, date: iso(e.shiftDate), kind: e.kind, clinicId: e.clinicId, departmentId: e.departmentId, band: e.band,
      start: hm(e.startTime), end: hm(e.endTime), substituteDoctorId: e.substituteDoctorId,
    })),
    existing: slots.map((s) => ({
      id: s.id, doctorId: s.doctorId, date: iso(s.slotDate), start: toHhmm(s.startTime), end: toHhmm(s.endTime), status: s.status, reserved: s.reservedCount,
    })),
  });
  counts.read = slots.length;
  counts.closedWithBookings = plan.closes.filter((c) => c.reserved > 0).length;
  if (o.dryRun) {
    counts.inserted = plan.inserts.length;
    counts.closed = plan.closes.length;
    counts.reopened = plan.reopens.length;
    return { counts, plan, substituted: [] };
  }
  if (!o.runId) throw new Error("runId is required to write frames");
  const now = o.now;

  // step 4: insert missing frames (a key taken by the same doctor at another clinic is skipped by the unique key)
  if (plan.inserts.length > 0) {
    const r = await db.slot.createMany({
      skipDuplicates: true,
      data: plan.inserts.map((f) => ({
        clinicId: o.clinicId, departmentId: f.departmentId, doctorId: f.doctorId, slotDate: dbDate(f.date), startTime: dbTime(f.start),
        endTime: dbTime(f.end), capacity, status: "OPEN" as const, generatedRunId: o.runId as string,
      })),
    });
    counts.inserted = r.count;
  }
  // step 6: a CLOSED frame inside a shift again → OPEN
  if (plan.reopens.length > 0) {
    counts.reopened = (await db.slot.updateMany({ where: { id: { in: plan.reopens } }, data: { status: "OPEN", closedReason: null } })).count;
  }
  // step 7: bookings of a 代診 move to the substitute's frame of the same time, before the absent doctor's frames close
  const substituted = plan.moves.length > 0 ? await moveBookings(db, o.clinicId, plan.moves, now) : [];
  counts.moved = substituted.length;
  // step 5: OPEN frames outside every shift → CLOSED; a booking still on one gets 要調整 (never cancelled)
  for (const reason of ["HOLIDAY", "CLINIC_CLOSED", "DOCTOR_OFF"] as const) {
    const ids = plan.closes.filter((c) => c.reason === reason).map((c) => c.id);
    if (ids.length === 0) continue;
    counts.closed += (await db.slot.updateMany({ where: { id: { in: ids } }, data: { status: "CLOSED", closedReason: reason } })).count;
  }
  const closedIds = plan.closes.filter((c) => c.reserved > 0).map((c) => c.id);
  if (closedIds.length > 0) {
    const held = await db.booking.findMany({
      where: { status: "RESERVED", adjustRequiredAt: null, bookingSlots: { some: { slotId: { in: closedIds } } } },
      select: { id: true },
    });
    if (held.length > 0) {
      await db.booking.updateMany({ where: { id: { in: held.map((b) => b.id) } }, data: { adjustRequiredAt: now } });
      await db.bookingEvent.createMany({
        data: held.map((b) => ({ bookingId: b.id, event: "ADJUST_REQUIRED", actorKind: "SYSTEM" as const, after: { reason: "frame closed" }, at: now })),
      });
    }
    counts.adjusted = held.length;
  }
  return { counts, plan, substituted };
}

/** Step 7. A booking moves only when all its frames are moved and every target frame is OPEN with room; otherwise it stays (→ 要調整 when the frame closes). */
async function moveBookings(db: Db, clinicId: string, moves: Plan["moves"], now: Date): Promise<string[]> {
  const fromIds = moves.map((m) => m.fromId);
  const targetOf = new Map(moves.map((m) => [m.fromId, m.to]));
  const keys = moves.map((m) => m.to);
  const targets = await db.slot.findMany({
    where: { clinicId, OR: keys.map((k) => ({ doctorId: k.doctorId, slotDate: dbDate(k.date), startTime: dbTime(k.start) })) },
  });
  const targetByKey = new Map(targets.map((t) => [`${t.doctorId}|${iso(t.slotDate)}|${toHhmm(t.startTime)}`, t]));
  const free = new Map(targets.map((t) => [t.id, t.status === "OPEN" ? t.capacity - t.reservedCount : 0]));
  const bookings = await db.booking.findMany({
    where: { status: "RESERVED", bookingSlots: { some: { slotId: { in: fromIds } } } },
    include: { bookingSlots: true },
    orderBy: { createdAt: "asc" },
  });
  const moved: string[] = [];
  for (const b of bookings) {
    const pairs = b.bookingSlots.map((bs) => {
      const to = targetOf.get(bs.slotId);
      const target = to ? targetByKey.get(`${to.doctorId}|${to.date}|${to.start}`) : undefined;
      return { from: bs.slotId, target };
    });
    if (pairs.some((p) => !p.target || (free.get(p.target.id) ?? 0) < 1)) continue;
    for (const p of pairs) {
      const target = p.target as (typeof targets)[number];
      free.set(target.id, (free.get(target.id) ?? 1) - 1);
      await db.bookingSlot.delete({ where: { bookingId_slotId: { bookingId: b.id, slotId: p.from } } });
      await db.bookingSlot.create({ data: { bookingId: b.id, slotId: target.id } });
      await db.slot.update({ where: { id: p.from }, data: { reservedCount: { decrement: 1 } } });
      await db.slot.update({ where: { id: target.id }, data: { reservedCount: { increment: 1 } } });
    }
    const first = pairs[0].target as (typeof targets)[number];
    await db.booking.update({ where: { id: b.id }, data: { doctorId: first.doctorId, departmentId: first.departmentId, version: { increment: 1 } } });
    await db.bookingEvent.create({
      data: {
        bookingId: b.id, event: "DOCTOR_SUBSTITUTED", actorKind: "SYSTEM", before: { doctorId: b.doctorId }, after: { doctorId: first.doctorId }, at: now,
      },
    });
    moved.push(b.id);
  }
  return moved;
}

/** NT-03 for the bookings moved to a substitute; after the commit, a failure is logged and never fails the run (X1 / X2 retry per notification) */
export async function notifySubstituted(bookingIds: string[]) {
  for (const id of bookingIds) {
    try {
      await deliverAfterCommit([await enqueueBookingNotice(prisma, id, "NT03_CHANGED")]);
    } catch (e) {
      log("error", "NT-03 after a substitution failed", { bookingId: id, error: e instanceof Error ? e.message : String(e) });
    }
  }
}

// ── the job ───────────────────────────────────────────────────────────────────────────────────────────────────────────

class DryRunDone extends Error {
  constructor(readonly value: Awaited<ReturnType<typeof generateClinic>>) {
    super("dry run");
  }
}

/**
 * J-06: a dry run applies the real steps 4–7 inside a transaction that is always rolled back, so 要調整 and 代診 are counted
 * exactly as a run would (the substitute's frames of step 4 exist for step 7). Nothing stays written and no NT-03 is sent;
 * the rows it touches are locked until the rollback.
 */
async function simulateClinic(clinicId: string, dates: string[], now: Date) {
  try {
    await prisma.$transaction(async (tx) => {
      const run = await tx.batchRun.create({
        data: { jobCode: "B2", trigger: "MANUAL", clinicId, startedAt: now, status: "RUNNING", readCount: 0, writtenCount: 0, errorCount: 0, message: "dry run" },
      });
      throw new DryRunDone(await generateClinic(tx, { clinicId, dates, runId: run.id, now, dryRun: false }));
    }, { timeout: 120_000, maxWait: 20_000 });
  } catch (e) {
    if (e instanceof DryRunDone) return { ...e.value, substituted: [] };
    throw e;
  }
  throw new Error("dry run did not roll back");
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (v: unknown, name: string) => {
  if (typeof v !== "string" || !ISO.test(v) || toIsoDate(dbDate(v)) !== v) throw new Error(`bad parameter ${name}: ${String(v)}`);
  return v;
};
const dateList = (v: unknown) => {
  const items = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  return items.map((d) => isoDate(String(d).trim(), "dates"));
};

/**
 * params: `from`, `to` (ISO dates; default the daily range), `dates` (a list or comma string: only these dates of the range).
 * Per clinic its own transaction: one failing clinic → PARTIAL, the others stay committed.
 */
export const b2Job: Job = async (ctx) => {
  const now = new Date();
  const clinics = await prisma.clinic.findMany({
    where: ctx.clinicId ? { id: ctx.clinicId } : { isActive: true }, orderBy: { displayOrder: "asc" }, select: { id: true, code: true },
  });
  const from = ctx.params.from === undefined ? null : isoDate(ctx.params.from, "from");
  const to = ctx.params.to === undefined ? null : isoDate(ctx.params.to, "to");
  const only = ctx.params.dates === undefined ? null : dateList(ctx.params.dates);
  const total = noCounts();
  const failed: string[] = [];
  const notify: string[] = [];
  for (const c of clinics) {
    try {
      const daily = await dailyRange(prisma, c.id, now);
      const range = daysBetween(from ?? daily.from, to ?? daily.to);
      const dates = only ? range.filter((d) => only.includes(d)) : range;
      const run = ctx.dryRun
        ? await simulateClinic(c.id, dates, now)
        : await prisma.$transaction((tx) => generateClinic(tx, { clinicId: c.id, dates, runId: ctx.runId, now, dryRun: false }), { timeout: 120_000, maxWait: 20_000 });
      for (const k of Object.keys(total) as Array<keyof B2Counts>) total[k] += run.counts[k];
      notify.push(...run.substituted);
    } catch (e) {
      failed.push(`${c.code}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (notify.length > 0) await notifySubstituted(notify);
  const message = `追加${total.inserted}・閉鎖${total.closed}・再開${total.reopened}・要調整${total.adjusted}・代診${total.moved}${failed.length ? `／失敗 ${failed.join("; ")}`.slice(0, 300) : ""}`;
  const status: JobResult["status"] = failed.length === 0 ? "SUCCESS" : failed.length === clinics.length ? "FAILED" : "PARTIAL";
  return { status, read: total.read, written: total.inserted + total.closed + total.reopened, errors: failed.length, message };
};
