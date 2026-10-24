// spec-screen: P11
// Read side of P11 / P12 / P13 (抽出1–10 of P11, 抽出1–2 of P12, 抽出2–3 of P13). Nothing here writes. Free start times
// follow the core's rule (lib/booking/core.ts runOf): `duration_frames` consecutive frames of one doctor, each OPEN with
// reserved_count < capacity; in change mode the booking's own frames count as free (Q7 A); today only from now + cut-off.
import { Prisma, type Relation, type VisitCategory } from "@prisma/client";
import { policyOf } from "@/lib/booking/policy";
import { decryptText } from "@/lib/crypto/field";
import { addDays, jstInstant, todayJst, toHhmm, toIsoDate } from "@/lib/datetime";
import type { Lang } from "@/lib/i18n";
import { prisma } from "@/lib/prisma";
import { doctorName, nameOf, pick, titleLabel } from "@/lib/public/text";

type NameRow = { familyName: string; givenName: string; nameType: "JP" | "ROMAJI" };
/** ja 姓 名; romaji names given-family in en / vi (04 §6.1, _common item 11) */
export const personName = (p: NameRow, lang: Lang) => (p.nameType === "ROMAJI" && lang !== "ja" ? `${p.givenName} ${p.familyName}` : `${p.familyName} ${p.givenName}`);

export type Person = { id: string; name: string; relation: Relation };

/** 抽出1: SELF first, then family by created_at (Q15 A); merged / anonymised rows are not bookable */
export async function personsOf(accountId: string, lang: Lang): Promise<Person[]> {
  const rows = await prisma.patient.findMany({
    where: { accountId, mergedIntoId: null, anonymizedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, familyName: true, givenName: true, nameType: true, relation: true },
  });
  return rows
    .sort((a, b) => Number(b.relation === "SELF") - Number(a.relation === "SELF"))
    .map((p) => ({ id: p.id, name: personName(p, lang), relation: p.relation ?? "OTHER" }));
}

/** the person may book: a non-merged patient of the account */
export const ownPerson = async (accountId: string, patientId: unknown) =>
  typeof patientId === "string" && UUID.test(patientId) &&
  (await prisma.patient.count({ where: { id: patientId, accountId, mergedIntoId: null, anonymizedAt: null } })) === 1;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 抽出2 */
export async function clinicsOf(lang: Lang) {
  const rows = await prisma.clinic.findMany({ where: { isActive: true }, orderBy: { displayOrder: "asc" } });
  return rows.map((c) => ({ id: c.id, code: c.code, name: nameOf(c, lang), phone: c.phone }));
}

/** 抽出3 */
export async function departmentsOf(clinicId: string, lang: Lang) {
  const rows = await prisma.clinicDepartment.findMany({
    where: { clinicId, department: { isActive: true }, clinic: { isActive: true } }, orderBy: { displayOrder: "asc" }, include: { department: true },
  });
  return rows.map((r) => ({ id: r.department.id, code: r.department.code, name: nameOf(r.department, lang) }));
}

export type VisitTypeOption = {
  id: string; name: string; category: VisitCategory; priceYen: number | null; notice: string | null; durationFrames: number;
};

/** 抽出4 (change mode: the booking's own type only, `only`) */
export async function visitTypesOf(clinicId: string, departmentId: string, lang: Lang, only?: string): Promise<VisitTypeOption[]> {
  const rows = await prisma.visitType.findMany({
    where: only ? { id: only } : { clinicId, departmentId, webBookable: true, isActive: true }, orderBy: { displayOrder: "asc" },
  });
  return rows.map((v) => ({
    id: v.id, name: nameOf(v, lang), category: v.category, priceYen: v.priceYen,
    notice: pick(lang, v.noticeJa ?? "", v.noticeEn, v.noticeVi) || null, durationFrames: v.durationFrames,
  }));
}

/** 抽出5 (F2-05, Q14 / Q28 A): no 診察券 and no CHECKED_IN booking at the clinic → 初診, else 再診; the first type of it */
export async function preselectOf(patientId: string, clinicId: string, types: VisitTypeOption[]) {
  const seen = (await prisma.patientCard.count({ where: { patientId, clinicId } })) > 0 ||
    (await prisma.booking.count({ where: { patientId, clinicId, status: "CHECKED_IN" } })) > 0;
  return types.find((t) => t.category === (seen ? "REPEAT" : "FIRST"))?.id ?? null;
}

// ── frames ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Frame = { doctor_id: string; date: string; start: string; end: string; capacity: number; reserved: number; status: string; own: boolean };
export type Scope = { clinicId: string; departmentId: string; doctorId: string | null; changeBookingId: string | null };

export async function frameRows(s: Scope, from: string, to: string): Promise<Frame[]> {
  const own = s.changeBookingId
    ? Prisma.sql`EXISTS (SELECT 1 FROM booking_slots bs WHERE bs.slot_id = s.id AND bs.booking_id = ${s.changeBookingId}::uuid)`
    : Prisma.sql`false`;
  return prisma.$queryRaw<Frame[]>`
    SELECT s.doctor_id::text, to_char(s.slot_date, 'YYYY-MM-DD') AS date, to_char(s.start_time, 'HH24:MI') AS start,
           to_char(s.end_time, 'HH24:MI') AS "end", s.capacity, s.reserved_count AS reserved, s.status::text AS status, ${own} AS own
      FROM slots s JOIN doctors d ON d.id = s.doctor_id AND d.is_active
     WHERE s.clinic_id = ${s.clinicId}::uuid AND s.department_id = ${s.departmentId}::uuid
       AND s.slot_date BETWEEN ${from}::date AND ${to}::date
       ${s.doctorId ? Prisma.sql`AND s.doctor_id = ${s.doctorId}::uuid` : Prisma.empty}
     ORDER BY s.doctor_id, s.slot_date, s.start_time`;
}

export const isFree = (f: Frame) => f.status === "OPEN" && f.reserved - (f.own ? 1 : 0) < f.capacity;

/** the run of n consecutive frames from `start` in one doctor's frames of one date (sorted), or null */
export function runAt(list: Frame[], start: string, n: number): Frame[] | null {
  const i = list.findIndex((f) => f.start === start);
  if (i < 0) return null;
  const run = list.slice(i, i + n);
  return run.length === n && run.every((f, k) => k === 0 || f.start === run[k - 1].end) ? run : null;
}

/** doctor → date → frames, in the order of frameRows */
export function group(rows: Frame[]) {
  const out = new Map<string, Map<string, Frame[]>>();
  for (const f of rows) {
    const byDate = out.get(f.doctor_id) ?? out.set(f.doctor_id, new Map()).get(f.doctor_id)!;
    (byDate.get(f.date) ?? byDate.set(f.date, []).get(f.date)!).push(f);
  }
  return out;
}

export type Mark = "free" | "few" | "full" | "closed";
export type Day = { mark: Mark; starts: string[] };

/**
 * 抽出7 / 抽出8 for the frames of one doctor or all doctors (指名なし: union, each start once, Q13 A). Q10 A: free = a
 * bookable start of the visit type exists; △ = bookable starts ≤ 20 % of the date's frames; × = OPEN frames, none
 * bookable; — = no OPEN frame (no frames of the doctor, or every frame CLOSED).
 */
export function daysOf(rows: Frame[], n: number, o: { today: string; now: Date; cutoffMinutes: number }): Record<string, Day> {
  const limit = o.now.getTime() + o.cutoffMinutes * 60_000;
  const acc = new Map<string, { starts: Set<string>; frames: number; open: number }>();
  for (const byDate of group(rows).values()) {
    for (const [date, list] of byDate) {
      const a = acc.get(date) ?? acc.set(date, { starts: new Set(), frames: 0, open: 0 }).get(date)!;
      a.frames += list.length;
      a.open += list.filter((f) => f.status === "OPEN").length;
      for (const f of list) {
        if (date === o.today && jstInstant(date, f.start).getTime() < limit) continue;
        if (runAt(list, f.start, n)?.every(isFree)) a.starts.add(f.start);
      }
    }
  }
  const out: Record<string, Day> = {};
  for (const [date, a] of acc) {
    const starts = [...a.starts].sort();
    const mark: Mark = a.open === 0 ? "closed" : starts.length === 0 ? "full" : starts.length <= a.frames * 0.2 ? "few" : "free";
    out[date] = { mark, starts };
  }
  return out;
}

export type Ctx = { clinicId: string; departmentId: string; visitTypeId: string; changeBookingId: string | null; now: Date };

/** the visit type when it is still offered at the clinic × department (change mode: the booking's own type) */
async function visitTypeIn(c: Ctx) {
  const vt = await prisma.visitType.findUnique({ where: { id: c.visitTypeId } });
  if (!vt || vt.clinicId !== c.clinicId || vt.departmentId !== c.departmentId) return null;
  return c.changeBookingId || (vt.isActive && vt.webBookable) ? vt : null;
}

async function windowOf(c: Ctx) {
  const policy = await policyOf(c.clinicId);
  const today = todayJst(c.now);
  return { policy, today, max: addDays(today, policy.bookingWindowDays) };
}

/** 抽出6 (Q13 A): active doctors with a bookable start of the visit type in the window, by display_order */
export async function doctorsOf(c: Ctx, lang: Lang) {
  const vt = await visitTypeIn(c);
  if (!vt) return [];
  const w = await windowOf(c);
  const rows = await frameRows({ ...c, doctorId: null }, w.today, w.max);
  const ids = [...group(rows).keys()].filter((id) =>
    Object.values(daysOf(rows.filter((f) => f.doctor_id === id), vt.durationFrames, { today: w.today, now: c.now, cutoffMinutes: w.policy.sameDayCutoffMinutes }))
      .some((d) => d.starts.length > 0));
  const docs = await prisma.doctor.findMany({ where: { id: { in: ids } }, orderBy: { displayOrder: "asc" } });
  return docs.map((d) => ({ id: d.id, name: doctorName(d, lang), title: titleLabel(d.title, lang) }));
}

/** 抽出7 + 抽出8 + 抽出9 over the whole window: the client switches months, dates and 次の空き without another request */
export async function calendarOf(c: Ctx & { doctorId: string | null }, lang: Lang) {
  const w = await windowOf(c);
  const vt = await visitTypeIn(c);
  const rows = vt ? await frameRows(c, w.today, w.max) : [];
  const days = daysOf(rows, vt?.durationFrames ?? 1, { today: w.today, now: c.now, cutoffMinutes: w.policy.sameDayCutoffMinutes });
  const [holidays, calendar] = await Promise.all([
    prisma.holiday.findMany({ where: { isActive: true, holidayDate: { gte: new Date(`${w.today}T00:00:00Z`), lte: new Date(`${w.max}T00:00:00Z`) } } }),
    prisma.clinicCalendarDay.findMany({ where: { clinicId: c.clinicId, calDate: { gte: new Date(`${w.today}T00:00:00Z`), lte: new Date(`${w.max}T00:00:00Z`) } } }),
  ]);
  const holidayNames = Object.fromEntries(holidays.map((h) => [toIsoDate(h.holidayDate), nameOf(h, lang)]));
  const notes: Record<string, string> = {};
  for (const d of calendar) {
    const text = pick(lang, d.noteJa ?? "", d.noteEn, d.noteVi);
    if (text) notes[toIsoDate(d.calDate)] = text;
  }
  // item 16 (Q25 d): the holiday name for a national holiday without a note
  for (const [date, name] of Object.entries(holidayNames)) notes[date] ??= name;
  return { min: w.today, max: w.max, days, holidays: Object.keys(holidayNames), notes };
}

// ── change mode (抽出10) ─────────────────────────────────────────────────────────────────────────────────────────────

/** the booking when it belongs to the account's patients, else null (ER-01, no disclosure) */
export async function ownBooking(bookingId: string, accountId: string) {
  if (!UUID.test(bookingId)) return null;
  return prisma.booking.findFirst({
    where: { id: bookingId, patient: { accountId } },
    include: { patient: true, clinic: true, department: true, visitType: true, doctor: true, questionnaire: { select: { submittedAt: true } } },
  });
}
export type OwnBooking = NonNullable<Awaited<ReturnType<typeof ownBooking>>>;

export const bookingNotes = (b: { notes: Uint8Array | null }) => (b.notes ? decryptText(b.notes) : "");
export const startOf = (b: { startTime: Date }) => toHhmm(b.startTime);
