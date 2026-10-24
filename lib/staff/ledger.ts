// spec-screen: S01
// 予約台帳 server side: the list (抽出1–6), the status writes of events 4–7 and 16 (抽出10, 更新1/2/5/7), cancel (event 9 through the
// booking core), the 問診・備考 dialog (event 13, 更新6) and the 予約番号 search (event 3). Every write takes lockPerson → lockBooking.
import type { CancelReason, Prisma } from "@prisma/client";
import { bad, done, fail, isUuid, type Actor } from "@/lib/admin/common";
import { audit, type Result } from "@/lib/auth/service";
import { cancelInTx, lockBooking, lockPerson, STAFF_CODE } from "@/lib/booking/core";
import { deliverAfterCommit, enqueueBookingNotice } from "@/lib/booking/notify";
import { decryptJson, decryptText } from "@/lib/crypto/field";
import { addDays, dbDate, todayJst, toHhmm, toIsoDate } from "@/lib/datetime";
import { W3, w3 } from "@/lib/i18n/labels-w3";
import { prisma } from "@/lib/prisma";
import { answerRows } from "./questionnaire-labels";
import { BOOKING_NO, DAY_MS, DEFAULT_STATES, displayState, FILTERS, normalizeBookingNo, STATES, showNo, type DisplayState, type Filter } from "./ledger-rules";

type Db = Prisma.TransactionClient;
// cap: ledger rows per request (質疑 pending): 抽出1 says "no limit on the row count"
export const LEDGER_ROW_CAP = 1000;
// cap: rows of one bulk 調整依頼 send (質疑 pending): 抽出2 / event 16 give no bound
export const ADJUST_BULK_CAP = 500;

const jst = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString();
const hm = (d: Date) => { const s = jst(d); return `${Number(s.slice(11, 13))}:${s.slice(14, 16)}`; };
const mdHm = (d: Date) => { const s = jst(d); return `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))} ${s.slice(11, 16)}`; };
const stateText = (s: DisplayState) => W3.states[s];

export type LedgerRow = {
  id: string; version: number; bookingNo: string; date: string; start: string; end: string; patientId: string;
  name: string; kana: string; channel: "WEB" | "PHONE" | "COUNTER"; visitType: string; first: boolean; doctorId: string; doctorName: string;
  unrequested: boolean; state: DisplayState; badge: string; old: boolean; hasQuestionnaire: boolean; hasNotes: boolean; adjustNotified: string | null;
  can: { checkin: boolean; undo: boolean; change: boolean; cancel: boolean; noShow: boolean; correct: boolean; adjust: boolean };
};
export type LedgerView = {
  filter: Filter | null; date: string; today: string; doctorId: string; doctors: Array<{ id: string; label: string }>; states: DisplayState[];
  rows: LedgerRow[]; totals: Record<DisplayState, number> & { all: number }; shown: number; truncated: boolean;
  notices: { candidates: number; old: number; adjust: number }; batch: string | null; isDoctor: boolean; highlight: string | null; clinicName: string;
};

/** thrown inside a transaction to roll it back and answer with `result` */
class Abort {
  constructor(public result: Result) {}
}

const doctorOf =(accountId: string) => prisma.doctor.findUnique({ where: { accountId }, select: { id: true } });

/** the clinic of a booking must be the session clinic (ER-03), an unknown id is ER-02 */
async function headOf(db: Db, a: Actor, id: unknown) {
  if (!isUuid(id)) return { err: bad() };
  const head = await db.booking.findUnique({ where: { id }, select: { id: true, clinicId: true, patientId: true, doctorId: true } });
  if (!head) return { err: bad() };
  if (head.clinicId !== a.clinicId) return { err: fail(403, "SE091") };
  return { head };
}

// ── events 1, 2, 12, 14, 17 ─────────────────────────────────────────────────────────────────────────────────────────

export async function loadLedger(a: Actor, q: Record<string, unknown>): Promise<Result> {
  const own = a.role === "DOCTOR" ? await doctorOf(a.accountId) : null;
  if (a.role === "DOCTOR" && !own) return fail(403, "SE091");
  const today = todayJst(a.now);
  const filterRaw = q.filter ?? null;
  if (filterRaw !== null && filterRaw !== "" && !FILTERS.includes(filterRaw as Filter)) return bad();
  const filter = (filterRaw || null) as Filter | null;
  let date = today;
  if (q.date !== undefined && q.date !== null) {
    if (typeof q.date !== "string") return bad();
    if (q.date.trim() === "") return fail(400, "SE001", { 項目: W3.field.date });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(q.date) || toIsoDate(dbDate(q.date)) !== q.date) return bad();
    date = q.date;
  }
  const states = q.states === undefined ? DEFAULT_STATES : q.states;
  if (!Array.isArray(states) || !states.every((s) => STATES.includes(s as DisplayState))) return bad();

  // 抽出6: doctors with a frame or a booking that day
  const [slotDocs, bookDocs] = await Promise.all([
    prisma.slot.findMany({ where: { clinicId: a.clinicId, slotDate: dbDate(date) }, select: { doctorId: true }, distinct: ["doctorId"] }),
    prisma.booking.findMany({ where: { clinicId: a.clinicId, slotDate: dbDate(date) }, select: { doctorId: true }, distinct: ["doctorId"] }),
  ]);
  const ids = [...new Set([...slotDocs, ...bookDocs].map((d) => d.doctorId))];
  const docs = (await prisma.doctor.findMany({ where: { id: own ? own.id : { in: ids } }, orderBy: { displayOrder: "asc" } }))
    .map((d) => ({ id: d.id, label: `${d.familyName} ${d.givenName}` }));
  let doctorId = "";
  if (own) doctorId = own.id;
  else if (q.doctorId) {
    if (typeof q.doctorId !== "string" || !docs.some((d) => d.id === q.doctorId)) return bad();
    doctorId = q.doctorId;
  }

  const old = new Date(a.now.getTime() - 7 * DAY_MS);
  const where: Prisma.BookingWhereInput = { clinicId: a.clinicId, ...(own && { doctorId: own.id }) };
  if (filter === "adjust") Object.assign(where, { status: "RESERVED", adjustRequiredAt: { not: null } });
  else if (filter) Object.assign(where, { status: "RESERVED", noShowCandidateAt: filter === "candidate7" ? { lt: old } : { not: null } });
  else Object.assign(where, { slotDate: dbDate(date), ...(doctorId && { doctorId }) });

  const found = await prisma.booking.findMany({
    where, take: LEDGER_ROW_CAP + 1,
    include: { patient: true, visitType: true, doctor: true, questionnaire: { select: { bookingId: true } } },
  });
  const truncated = found.length > LEDGER_ROW_CAP;
  found.sort((x, y) =>
    +x.slotDate - +y.slotDate || +x.startTime - +y.startTime || x.doctor.displayOrder - y.doctor.displayOrder || x.bookingNo.localeCompare(y.bookingNo));

  const todayMinus7 = addDays(today, -7);
  const all = found.slice(0, LEDGER_ROW_CAP).map((b): LedgerRow => {
    const state = displayState(b);
    const iso = toIsoDate(b.slotDate);
    const isOld = state === "CANDIDATE" && !!b.noShowCandidateAt && b.noShowCandidateAt < old;
    const reserved = b.status === "RESERVED";
    const write = !own;
    return {
      id: b.id, version: b.version, bookingNo: b.bookingNo, date: iso, start: toHhmm(b.startTime), end: toHhmm(b.endTime), patientId: b.patientId,
      name: `${b.patient.familyName} ${b.patient.givenName}`, kana: `${b.patient.familyNameKana} ${b.patient.givenNameKana}`, channel: b.channel,
      visitType: b.visitType.nameJa, first: b.visitType.category === "FIRST", doctorId: b.doctorId, doctorName: b.doctor.familyName,
      unrequested: !b.doctorRequested, state, old: isOld, badge: state === "CHECKED_IN" && b.checkedInAt ? `${stateText(state)} ${hm(b.checkedInAt)}` : isOld ? W3.candidateOld : stateText(state),
      hasQuestionnaire: !!b.questionnaire, hasNotes: b.notes !== null, adjustNotified: b.adjustNotifiedAt ? mdHm(b.adjustNotifiedAt) : null,
      can: {
        checkin: write && reserved && iso === today && !b.adjustRequiredAt,
        undo: write && b.status === "CHECKED_IN" && iso === today && !!b.checkedInAt && a.now.getTime() - b.checkedInAt.getTime() <= 30 * 60_000,
        change: write && reserved, cancel: write && reserved, noShow: write && reserved && !!b.noShowCandidateAt,
        correct: write && ((reserved && !!b.noShowCandidateAt) || (b.status === "NO_SHOW" && iso >= todayMinus7)),
        adjust: write && reserved && !!b.adjustRequiredAt,
      },
    };
  });

  const totals = { RESERVED: 0, CHECKED_IN: 0, NO_SHOW: 0, CANCELED: 0, ADJUST: 0, CANDIDATE: 0, all: all.length };
  for (const r of all) totals[r.state]++;
  const rows = filter ? all : all.filter((r) => (states as string[]).includes(r.state));

  const mine: Prisma.BookingWhereInput = { clinicId: a.clinicId, status: "RESERVED", ...(own && { doctorId: own.id }) };
  const [candidates, oldCount, adjust, run, clinic] = await Promise.all([
    prisma.booking.count({ where: { ...mine, noShowCandidateAt: { not: null } } }),
    prisma.booking.count({ where: { ...mine, noShowCandidateAt: { lt: old } } }),
    prisma.booking.count({ where: { ...mine, adjustRequiredAt: { not: null } } }),
    prisma.batchRun.findFirst({ where: { jobCode: "B4", OR: [{ clinicId: a.clinicId }, { clinicId: null }] }, orderBy: { startedAt: "desc" } }),
    prisma.clinic.findUniqueOrThrow({ where: { id: a.clinicId }, select: { nameJa: true } }),
  ]);
  const batch = run
    ? `${W3.batch} ${mdHm(run.endedAt ?? run.startedAt)} ${W3.batchStatus[run.status]}${run.message ? `（${run.message}）` : ""}` // Q5
    : null;

  const view: LedgerView = {
    filter, date, today, doctorId, doctors: docs, states: filter ? DEFAULT_STATES : (states as DisplayState[]), rows, totals, shown: rows.length, truncated,
    notices: { candidates, old: oldCount, adjust }, batch, isDoctor: !!own, highlight: typeof q.highlight === "string" ? q.highlight : null, clinicName: clinic.nameJa,
  };
  return done({ view });
}

// ── event 3 ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function searchBooking(a: Actor, clinicIds: string[], body: Record<string, unknown>): Promise<Result> {
  const raw = typeof body.bookingNo === "string" ? body.bookingNo : "";
  const no = normalizeBookingNo(raw);
  if (no === "") return fail(400, "SE001", { 項目: W3.field.bookingNo });
  if (!BOOKING_NO.test(no)) return done({ found: false }); // SI018
  const own = a.role === "DOCTOR" ? await doctorOf(a.accountId) : null;
  if (a.role === "DOCTOR" && !own) return fail(403, "SE091");
  const b = await prisma.booking.findUnique({ where: { bookingNo: no }, select: { id: true, clinicId: true, slotDate: true, doctorId: true, bookingNo: true } });
  if (!b || !clinicIds.includes(b.clinicId) || (own && b.doctorId !== own.id)) return done({ found: false });
  const switched = b.clinicId !== a.clinicId;
  if (switched) await prisma.session.update({ where: { id: a.sessionId }, data: { clinicId: b.clinicId } }); // _common 更新4
  return done({ found: true, date: toIsoDate(b.slotDate), bookingNo: b.bookingNo, switched });
}

// ── events 4–7 ──────────────────────────────────────────────────────────────────────────────────────────────────────

const snap = (b: { status: string; slotDate: Date; startTime: Date; endTime: Date; doctorId: string }) =>
  ({ status: b.status, date: toIsoDate(b.slotDate), start: toHhmm(b.startTime), end: toHhmm(b.endTime), doctorId: b.doctorId });

async function trail(tx: Db, a: Actor, b: { id: string; clinicId: string }, event: string, before: object, after: object) {
  await tx.bookingEvent.create({ data: { bookingId: b.id, event, actorKind: "STAFF", actorAccountId: a.accountId, channel: null, before, after, at: a.now } });
  await audit(tx, { accountId: a.accountId, role: a.role, action: "BOOKING_UPDATE", ip: a.ip, now: a.now, targetType: "booking", targetId: b.id, clinicId: b.clinicId, detail: { event } });
}

const KINDS = ["checkin", "undo", "noshow", "correct"] as const;
export type StatusKind = (typeof KINDS)[number];
const EVENT: Record<StatusKind, string> = { checkin: "CHECKED_IN", undo: "CHECKIN_UNDONE", noshow: "NO_SHOW", correct: "NO_SHOW_CORRECTED" };

export async function statusWrite(a: Actor, body: Record<string, unknown>): Promise<Result> {
  const kind = body.kind as StatusKind;
  if (!KINDS.includes(kind) || !Number.isInteger(body.version)) return bad();
  return prisma.$transaction(async (tx) => {
    const { head, err } = await headOf(tx, a, body.bookingId);
    if (!head) return err;
    await lockPerson(tx, head.patientId);
    await lockBooking(tx, head.id);
    const b = await tx.booking.findUniqueOrThrow({ where: { id: head.id } });
    if (b.version !== body.version) return fail(409, "SE010");
    const today = todayJst(a.now);
    const isToday = toIsoDate(b.slotDate) === today;
    const reserved = b.status === "RESERVED";
    const data: Prisma.BookingUpdateInput = { version: { increment: 1 } };
    if (kind === "checkin") {
      if (!reserved || !isToday || b.adjustRequiredAt) return fail(409, "SE011", { 状態: stateText(displayState(b)) }); // 4-3
      Object.assign(data, { status: "CHECKED_IN", checkedInAt: a.now });
    } else if (kind === "undo") {
      if (b.status !== "CHECKED_IN" || !isToday) return bad();
      Object.assign(data, { status: "RESERVED", checkedInAt: null });
    } else if (kind === "noshow") {
      if (!reserved || !b.noShowCandidateAt) return bad();
      Object.assign(data, { status: "NO_SHOW" }); // the frames stay (Q9)
    } else {
      const recent = b.status === "NO_SHOW" && toIsoDate(b.slotDate) >= addDays(today, -7); // Q8 b
      if (!(reserved && b.noShowCandidateAt) && !recent) return bad();
      Object.assign(data, { status: "CHECKED_IN", checkedInAt: a.now }); // Q8 a: now
    }
    const after = await tx.booking.update({ where: { id: b.id }, data });
    await trail(tx, a, b, EVENT[kind], snap(b), snap(after));
    return done({ name: await patientName(tx, b.patientId) });
  });
}

const patientName = async (db: Db, id: string) => {
  const p = await db.patient.findUniqueOrThrow({ where: { id }, select: { familyName: true, givenName: true } });
  return `${p.familyName} ${p.givenName}`;
};

// ── event 9 ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const REASONS = ["RECOVERED", "SCHEDULE", "RESCHEDULE", "CLINIC", "OTHER"];

export async function cancelWrite(a: Actor, body: Record<string, unknown>): Promise<Result> {
  const reason = body.reasonCode;
  const channel = body.channel;
  const text = typeof body.reasonText === "string" ? body.reasonText.trim() : "";
  if (!Number.isInteger(body.version)) return bad();
  if ((reason !== "" && reason !== undefined && !REASONS.includes(reason as string)) || (channel !== "" && channel !== undefined && channel !== "PHONE" && channel !== "COUNTER")) return bad();
  if (text.length > 200 || (body.reasonText !== undefined && typeof body.reasonText !== "string")) return bad(); // 4.2 No. 6: ER-02
  const errors = [
    ...(!reason ? [{ field: "reason", code: "SE001", params: { 項目: W3.field.reason } }] : []),
    ...(reason === "OTHER" && !text ? [{ field: "reasonText", code: "SE001", params: { 項目: W3.field.reasonText } }] : []),
    ...(!channel ? [{ field: "channel", code: "SE001", params: { 項目: W3.field.channel } }] : []),
  ];
  if (errors.length) return { ok: false, status: 400, code: errors[0].code, params: errors[0].params, errors };

  const out = await prisma.$transaction(async (tx) => {
    const { head, err } = await headOf(tx, a, body.bookingId);
    if (!head) return { err };
    const cur = await tx.booking.findUniqueOrThrow({ where: { id: head.id } });
    if (cur.version !== body.version) return { err: fail(409, "SE010") }; // 9-3 before the state check
    if (cur.status !== "RESERVED") return { err: bad() };
    const r = await cancelInTx(
      tx, { bookingId: head.id, version: body.version as number, reasonCode: reason as CancelReason, reasonText: text || null },
      { kind: "STAFF", accountId: a.accountId, channel: channel as "PHONE" | "COUNTER" }, { now: a.now },
    );
    if (!r.ok) return { err: fail(409, STAFF_CODE[r.rule]) };
    await audit(tx, { accountId: a.accountId, role: a.role, action: "BOOKING_UPDATE", ip: a.ip, now: a.now, targetType: "booking", targetId: head.id, clinicId: head.clinicId, detail: { event: "CANCELED" } });
    return { notificationId: r.notificationId };
  });
  if (out.err) return out.err;
  await deliverAfterCommit([out.notificationId ?? null]);
  return done();
}

// ── events 15, 16 ───────────────────────────────────────────────────────────────────────────────────────────────────

export async function adjustSend(a: Actor, body: Record<string, unknown>): Promise<Result> {
  const items = body.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > ADJUST_BULK_CAP) return bad();
  const list = items.map((i) => i as { bookingId?: unknown; version?: unknown });
  if (!list.every((i) => isUuid(i.bookingId) && Number.isInteger(i.version)) || new Set(list.map((i) => i.bookingId)).size !== list.length) return bad();
  list.sort((x, y) => String(x.bookingId).localeCompare(String(y.bookingId))); // one lock order for concurrent sends
  const out = await prisma.$transaction(async (tx) => {
    let without = 0;
    const notices: Array<string | null> = [];
    for (const i of list) {
      const { head, err } = await headOf(tx, a, i.bookingId);
      if (!head) throw new Abort(err);
      await lockPerson(tx, head.patientId);
      await lockBooking(tx, head.id);
      const b = await tx.booking.findUniqueOrThrow({ where: { id: head.id } });
      if (b.version !== i.version) throw new Abort(fail(409, "SE010")); // one changed row stops the whole send (Q11)
      if (b.status !== "RESERVED" || !b.adjustRequiredAt) throw new Abort(bad());
      const after = await tx.booking.update({ where: { id: b.id }, data: { adjustNotifiedAt: a.now, version: { increment: 1 } } });
      const nid = await enqueueBookingNotice(tx, b.id, "NT07_ADJUST");
      if (!nid) without++;
      notices.push(nid);
      await trail(tx, a, b, "ADJUST_NOTIFIED", snap(b), snap(after));
    }
    return { n: list.length, m: without, notices };
  }, { timeout: 60_000 }).catch((e) => (e instanceof Abort ? e.result : Promise.reject(e)));
  if ("ok" in out) return out;
  await deliverAfterCommit(out.notices);
  return done({ n: out.n, m: out.m });
}

// ── event 13 ────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function openDialog(a: Actor, body: Record<string, unknown>): Promise<Result> {
  const own = a.role === "DOCTOR" ? await doctorOf(a.accountId) : null;
  if (a.role === "DOCTOR" && !own) return fail(403, "SE091");
  const { head, err } = await headOf(prisma, a, body.bookingId);
  if (!head) return err;
  if (own && head.doctorId !== own.id) return fail(403, "SE091"); // 13-2: no dialog, no audit row
  const b = await prisma.booking.findUniqueOrThrow({
    where: { id: head.id }, include: { questionnaire: true, patient: true, visitType: true, department: true },
  });
  await audit(prisma, { accountId: a.accountId, role: a.role, action: "QUESTIONNAIRE_VIEW", ip: a.ip, now: a.now, targetType: "booking", targetId: b.id, clinicId: b.clinicId });
  const name = `${b.patient.familyName} ${b.patient.givenName}`;
  const q = b.questionnaire;
  return done({
    heading: q ? w3(W3.qTitle, { name, type: b.visitType.nameJa, dept: b.department.nameJa }) : w3(W3.notesTitle, { name }), // Q13 b
    language: q ? w3(W3.answerLang, { lang: q.language.toLowerCase() }) : null,
    answers: q ? answerRows(decryptJson(q.answers)) : [],
    notes: b.notes ? decryptText(b.notes) : null,
  });
}

export { showNo };
