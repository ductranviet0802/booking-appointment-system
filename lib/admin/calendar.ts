// spec-screen: A01
// A01 診療カレンダー・休診日: the reads (抽出2-10), the dry run (event 4, 抽出11), the save (events 5, 更新1 / 2 / 3 / 6),
// the clinic profile (event 8, 更新5 / 6) and the B3 manual start (event 6, 更新4). Every write is one transaction with its audit rows.
import type { Prisma } from "@prisma/client";
import { bad, changedColumns, done, fail, fieldFail, masterAudit, type Actor, type Db } from "@/lib/admin/common";
import {
  BANDS, CLINIC_KEYS, DAY_KINDS, isoDateOk, MAX_DAYS_PER_SAVE, specialBands, validateClinic, validateDay, validateHours, WEEK_ORDER,
  type BandCode, type ClinicValues, type DayKind, type DayValues, type HoursCellValues,
} from "@/lib/admin/calendar-rules";
import type { Result } from "@/lib/auth/service";
import { fullWidthSpaces } from "@/lib/auth/validate";
import { adjustRequiredCount, dailyRange, daysBetween, generateClinic } from "@/lib/batch/b2-frames";
import { runJob } from "@/lib/batch/runner";
import { dbDate, dbTime, todayJst, toHhmm, toIsoDate, weekdayOf } from "@/lib/datetime";
import { log } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

// ── what the screen reads ──────────────────────────────────────────────────────────────────────────────────────────

export type RunInfo = { id: string; status: string; startedAt: string; endedAt: string | null; written: number; message: string | null };
export type CalendarState = {
  today: string;
  ym: string;
  hours: HoursCellValues[];
  days: DayValues[];
  holidays: Array<{ date: string; nameJa: string }>;
  holidayList: Array<{ date: string; nameJa: string; isActive: boolean }>;
  b2: RunInfo | null;
  b3: RunInfo | null;
  adjustCount: number;
};

const hm = (d: Date | null) => (d ? toHhmm(d) : "");
const runInfo = (r: { id: string; status: string; startedAt: Date; endedAt: Date | null; writtenCount: number; message: string | null } | null): RunInfo | null =>
  r && { id: r.id, status: r.status, startedAt: r.startedAt.toISOString(), endedAt: r.endedAt?.toISOString() ?? null, written: r.writtenCount, message: r.message };

export function monthBounds(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return { first: `${ym}-01`, last: toIsoDate(new Date(Date.UTC(y, m, 0))) };
}
export const ymOk = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** items 3-5 as 14 cells, Monday first, 午前 before 午後 (抽出3) */
export async function loadHours(clinicId: string): Promise<HoursCellValues[]> {
  const rows = await prisma.clinicBusinessHour.findMany({ where: { clinicId } });
  return WEEK_ORDER.flatMap((weekday) =>
    BANDS.map((band) => {
      const r = rows.find((x) => x.weekday === weekday && x.band === band);
      return { weekday, band, on: !!r, open: r ? toHhmm(r.openTime) : "", close: r ? toHhmm(r.closeTime) : "", reception: r ? hm(r.receptionEndTime) : "" };
    }),
  );
}

const dayValues = (c: Prisma.ClinicCalendarDayGetPayload<object>): DayValues => ({
  date: toIsoDate(c.calDate), kind: c.kind, amOpen: hm(c.amOpen), amClose: hm(c.amClose), pmOpen: hm(c.pmOpen), pmClose: hm(c.pmClose),
  noteJa: c.noteJa ?? "", noteEn: c.noteEn ?? "", noteVi: c.noteVi ?? "",
});

/** events 1 / 10 / refresh after a save: everything of the page except the clinic profile */
export async function loadState(clinicId: string, ym: string, now = new Date()): Promise<CalendarState> {
  const today = todayJst(now);
  const { first, last } = monthBounds(ym);
  const year = Number(today.slice(0, 4));
  const [hours, days, holidays, list, b2, b3, adjustCount] = await Promise.all([
    loadHours(clinicId),
    prisma.clinicCalendarDay.findMany({ where: { clinicId, calDate: { gte: dbDate(first), lte: dbDate(last) } }, orderBy: { calDate: "asc" } }),
    prisma.holiday.findMany({ where: { holidayDate: { gte: dbDate(first), lte: dbDate(last) }, isActive: true }, orderBy: { holidayDate: "asc" } }),
    prisma.holiday.findMany({ where: { holidayDate: { gte: dbDate(`${year}-01-01`), lte: dbDate(`${year + 1}-12-31`) } }, orderBy: { holidayDate: "asc" } }),
    prisma.batchRun.findFirst({ where: { jobCode: "B2", OR: [{ clinicId }, { clinicId: null }] }, orderBy: { startedAt: "desc" } }),
    prisma.batchRun.findFirst({ where: { jobCode: "B3" }, orderBy: { startedAt: "desc" } }),
    adjustRequiredCount(prisma, clinicId),
  ]);
  return {
    today, ym, hours, days: days.map(dayValues),
    holidays: holidays.map((h) => ({ date: toIsoDate(h.holidayDate), nameJa: h.nameJa })),
    holidayList: list.map((h) => ({ date: toIsoDate(h.holidayDate), nameJa: h.nameJa, isActive: h.isActive })),
    b2: runInfo(b2), b3: runInfo(b3), adjustCount,
  };
}

export type ClinicProfile = ClinicValues & { code: string };
export async function loadClinic(clinicId: string): Promise<ClinicProfile | null> {
  const c = await prisma.clinic.findUnique({ where: { id: clinicId } });
  if (!c) return null;
  return {
    code: c.code, nameJa: c.nameJa, nameEn: c.nameEn ?? "", nameVi: c.nameVi ?? "", nameKana: c.nameKana, postcode: c.postcode, prefecture: c.prefecture,
    city: c.city, addressLine: c.addressLine, addressEn: c.addressEn ?? "", phone: c.phone, accessJa: c.accessJa, accessEn: c.accessEn ?? "",
    accessVi: c.accessVi ?? "", mapUrl: c.mapUrl ?? "", noticeJa: c.noticeJa ?? "", noticeEn: c.noticeEn ?? "", noticeVi: c.noticeVi ?? "",
  };
}

/** 抽出9 (event 2): booked frames of the date; a date that does not exist → ER-02 */
export async function bookedFrames(clinicId: string, date: unknown): Promise<Result> {
  if (typeof date !== "string" || !isoDateOk(date)) return bad();
  const n = await prisma.slot.count({ where: { clinicId, slotDate: dbDate(date), status: "OPEN", reservedCount: { gt: 0 } } });
  return done({ n });
}

// ── reading the request ────────────────────────────────────────────────────────────────────────────────────────────

/** a value the UI cannot produce → ER-02 (SE090), nothing written */
class Tampered extends Error {}
const must = (ok: boolean) => {
  if (!ok) throw new Tampered();
};
const str = (v: unknown, max = 2_000) => {
  must(typeof v === "string" && v.length <= max);
  return v as string;
};

type Held = { hours: HoursCellValues[]; days: DayValues[] };

function parseHeld(body: Record<string, unknown>): Held {
  must(Array.isArray(body.hours) && body.hours.length === 14 && Array.isArray(body.days) && body.days.length <= MAX_DAYS_PER_SAVE);
  const hours = (body.hours as Record<string, unknown>[]).map((c) => {
    must(!!c && typeof c === "object" && Number.isInteger(c.weekday) && (c.weekday as number) >= 0 && (c.weekday as number) <= 6);
    must(c.band === "AM" || c.band === "PM");
    must(typeof c.on === "boolean");
    return { weekday: c.weekday as number, band: c.band as BandCode, on: c.on as boolean, open: str(c.open, 20), close: str(c.close, 20), reception: str(c.reception, 20) };
  });
  must(new Set(hours.map((c) => `${c.weekday}${c.band}`)).size === 14);
  const days = (body.days as Record<string, unknown>[]).map((d) => {
    must(!!d && typeof d === "object" && typeof d.date === "string" && isoDateOk(d.date));
    must((DAY_KINDS as readonly unknown[]).includes(d.kind));
    return {
      date: d.date as string, kind: d.kind as DayKind, amOpen: str(d.amOpen, 20), amClose: str(d.amClose, 20), pmOpen: str(d.pmOpen, 20), pmClose: str(d.pmClose, 20),
      noteJa: str(d.noteJa), noteEn: str(d.noteEn), noteVi: str(d.noteVi),
    };
  });
  must(new Set(days.map((d) => d.date)).size === days.length);
  return { hours, days };
}

// ── what a save changes ────────────────────────────────────────────────────────────────────────────────────────────

const HOURS_COLS = ["clinic_id", "weekday", "band", "open_time", "close_time", "reception_end_time", "created_at", "updated_at"];
const DAY_COLS = [
  "clinic_id", "cal_date", "kind", "am_open", "am_close", "pm_open", "pm_close", "note_ja", "note_en", "note_vi", "created_by", "created_at", "updated_at",
];
const nullIfBlank = (v: string) => (v.trim() === "" ? null : v.trim());

type SavePlan = {
  hoursIns: HoursCellValues[]; hoursUpd: HoursCellValues[]; hoursDel: HoursCellValues[];
  daysIns: DayValues[]; daysUpd: DayValues[]; daysDel: DayValues[];
  hoursColumns: string[]; dayColumns: string[]; dates: string[];
};

/** the rows stored for the held cells / dates against the held values (抽出10): inserts, updates, deletes and the affected dates (Q1 b) */
async function planSave(db: Db, clinicId: string, held: Held, now: Date): Promise<SavePlan> {
  const [storedHours, storedDays, range] = await Promise.all([
    db.clinicBusinessHour.findMany({ where: { clinicId } }),
    db.clinicCalendarDay.findMany({ where: { clinicId, calDate: { in: held.days.map((d) => dbDate(d.date)) } } }),
    dailyRange(db, clinicId, now),
  ]);
  const p: SavePlan = { hoursIns: [], hoursUpd: [], hoursDel: [], daysIns: [], daysUpd: [], daysDel: [], hoursColumns: [], dayColumns: [], dates: [] };
  const hoursCols = new Set<string>();
  const dayCols = new Set<string>();
  const weekdays = new Set<number>();
  for (const c of held.hours) {
    const s = storedHours.find((x) => x.weekday === c.weekday && x.band === c.band);
    if (!c.on) {
      if (s) {
        p.hoursDel.push(c);
        HOURS_COLS.forEach((x) => hoursCols.add(x));
        weekdays.add(c.weekday);
      }
    } else if (!s) {
      p.hoursIns.push(c);
      HOURS_COLS.forEach((x) => hoursCols.add(x));
      weekdays.add(c.weekday);
    } else {
      const cols = changedColumns(
        { open: "open_time", close: "close_time", reception: "reception_end_time" },
        { open: toHhmm(s.openTime), close: toHhmm(s.closeTime), reception: hm(s.receptionEndTime) },
        { open: c.open.trim(), close: c.close.trim(), reception: c.reception.trim() },
      );
      if (cols.length > 0) {
        p.hoursUpd.push(c);
        cols.forEach((x) => hoursCols.add(x));
        weekdays.add(c.weekday);
      }
    }
  }
  const dates = new Set<string>();
  for (const d of held.days) {
    const s = storedDays.find((x) => toIsoDate(x.calDate) === d.date);
    if (d.kind === "NORMAL") {
      if (s) {
        p.daysDel.push(d);
        DAY_COLS.forEach((x) => dayCols.add(x));
        dates.add(d.date);
      }
      continue;
    }
    if (!s) {
      p.daysIns.push(d);
      DAY_COLS.forEach((x) => dayCols.add(x));
      dates.add(d.date);
      continue;
    }
    const want = dayData(d);
    const before = dayData(dayValues(s));
    const cols = changedColumns(
      { kind: "kind", amOpen: "am_open", amClose: "am_close", pmOpen: "pm_open", pmClose: "pm_close", noteJa: "note_ja", noteEn: "note_en", noteVi: "note_vi" },
      before, want,
    );
    if (cols.length > 0) {
      p.daysUpd.push(d);
      cols.forEach((x) => dayCols.add(x));
      dates.add(d.date);
    }
  }
  for (const date of daysBetween(range.from, range.to)) if (weekdays.has(weekdayOf(date))) dates.add(date);
  p.hoursColumns = [...hoursCols];
  p.dayColumns = [...dayCols];
  p.dates = [...dates].filter((d) => d >= range.from).sort();
  return p;
}

/** the columns of a held date as stored: times only for 臨時診療 (a band with one time is dropped), notes null when empty */
function dayData(d: DayValues) {
  const sp = d.kind === "SPECIAL_OPEN" ? specialBands(d) : { am: null, pm: null };
  return {
    kind: d.kind, amOpen: sp.am?.open ?? null, amClose: sp.am?.close ?? null, pmOpen: sp.pm?.open ?? null, pmClose: sp.pm?.close ?? null,
    noteJa: nullIfBlank(d.noteJa), noteEn: nullIfBlank(d.noteEn), noteVi: nullIfBlank(d.noteVi),
  };
}

async function applySave(db: Db, a: Actor, p: SavePlan) {
  const key = (c: HoursCellValues) => ({ clinicId_weekday_band: { clinicId: a.clinicId, weekday: c.weekday, band: c.band } });
  const hourData = (c: HoursCellValues) => ({ openTime: dbTime(c.open.trim()), closeTime: dbTime(c.close.trim()), receptionEndTime: c.reception.trim() ? dbTime(c.reception.trim()) : null });
  const time = (v: string | null) => (v ? dbTime(v) : null);
  const dayWrite = (d: DayValues) => {
    const x = dayData(d);
    return { kind: x.kind as Exclude<DayKind, "NORMAL">, amOpen: time(x.amOpen), amClose: time(x.amClose), pmOpen: time(x.pmOpen), pmClose: time(x.pmClose), noteJa: x.noteJa, noteEn: x.noteEn, noteVi: x.noteVi };
  };
  for (const c of p.hoursDel) await db.clinicBusinessHour.delete({ where: key(c) });
  for (const c of p.hoursUpd) await db.clinicBusinessHour.update({ where: key(c), data: hourData(c) });
  if (p.hoursIns.length > 0) {
    await db.clinicBusinessHour.createMany({ data: p.hoursIns.map((c) => ({ clinicId: a.clinicId, weekday: c.weekday, band: c.band, ...hourData(c) })) });
  }
  const dayKey = (d: DayValues) => ({ clinicId_calDate: { clinicId: a.clinicId, calDate: dbDate(d.date) } });
  for (const d of p.daysDel) await db.clinicCalendarDay.delete({ where: dayKey(d) });
  for (const d of p.daysUpd) await db.clinicCalendarDay.update({ where: dayKey(d), data: dayWrite(d) });
  if (p.daysIns.length > 0) {
    await db.clinicCalendarDay.createMany({ data: p.daysIns.map((d) => ({ clinicId: a.clinicId, calDate: dbDate(d.date), createdBy: a.accountId, ...dayWrite(d) })) });
  }
}

class Rollback extends Error {
  constructor(readonly value: number) {
    super("rollback");
  }
}

/** parse + check one held set; a Result when something is wrong, else the held values */
function checkHeld(body: Record<string, unknown>, today: string): { held: Held } | { result: Result } {
  let held: Held;
  try {
    held = parseHeld(body);
  } catch (e) {
    if (e instanceof Tampered) return { result: bad() };
    throw e;
  }
  const errors = [...validateHours(held.hours), ...held.days.flatMap((d) => validateDay(d, today))];
  return errors.length > 0 ? { result: fieldFail(errors) } : { held };
}

/** event 4 (抽出10, 抽出11): the held values applied inside a transaction that is rolled back, B2 planned as a dry run → n = frames with bookings that would close */
export async function checkSave(a: Actor, body: Record<string, unknown>): Promise<Result> {
  const c = checkHeld(body, todayJst(a.now));
  if ("result" in c) return c.result;
  try {
    await prisma.$transaction(async (tx) => {
      const plan = await planSave(tx, a.clinicId, c.held, a.now);
      await applySave(tx, a, plan);
      const { counts } = await generateClinic(tx, { clinicId: a.clinicId, dates: plan.dates, runId: null, now: a.now, dryRun: true });
      throw new Rollback(counts.closedWithBookings);
    }, { timeout: 60_000 });
  } catch (e) {
    if (e instanceof Rollback) return done({ n: e.value });
    throw e;
  }
  return done({ n: 0 });
}

/** event 5: 更新1 / 2 / 6 in one transaction, then B2 (EVENT) for the affected dates (更新3); a failed run keeps the saved rows (Q7 a) */
export async function saveCalendar(a: Actor, body: Record<string, unknown>): Promise<Result> {
  const c = checkHeld(body, todayJst(a.now));
  if ("result" in c) return c.result;
  const plan = await prisma.$transaction(async (tx) => {
    const p = await planSave(tx, a.clinicId, c.held, a.now);
    await applySave(tx, a, p);
    await masterAudit(tx, a, "clinic_business_hours", a.clinicId, p.hoursColumns);
    await masterAudit(tx, a, "clinic_calendar_days", a.clinicId, p.dayColumns);
    return p;
  }, { timeout: 60_000 });
  if (plan.dates.length === 0) return done({ unchanged: plan.hoursColumns.length + plan.dayColumns.length === 0, code: "SI040", params: { n: await adjustRequiredCount(prisma, a.clinicId) } });
  return afterB2(await runJob("B2", { trigger: "EVENT", clinicId: a.clinicId, params: { dates: plan.dates } }), a.clinicId);
}

/** SE044 when the run failed or found the lock taken (Q7 b); else SI040 with the clinic's 要調整 total (Q6) */
export async function afterB2(r: Awaited<ReturnType<typeof runJob>>, clinicId: string): Promise<Result> {
  if (r.result.status === "FAILED" || r.result.status === "PARTIAL" || r.result.message === "実行中のため省略") return fail(409, "SE044");
  return done({ code: "SI040", params: { n: await adjustRequiredCount(prisma, clinicId) } });
}

// ── event 8: the clinic profile ────────────────────────────────────────────────────────────────────────────────────

const CLINIC_COLUMN: Record<keyof ClinicValues, string> = {
  nameJa: "name_ja", nameEn: "name_en", nameVi: "name_vi", nameKana: "name_kana", postcode: "postcode", prefecture: "prefecture", city: "city",
  addressLine: "address_line", addressEn: "address_en", phone: "phone", accessJa: "access_ja", accessEn: "access_en", accessVi: "access_vi",
  mapUrl: "map_url", noticeJa: "notice_ja", noticeEn: "notice_en", noticeVi: "notice_vi",
};

export async function saveClinic(a: Actor, body: Record<string, unknown>): Promise<Result> {
  // `code` (or any other key) sent → ER-02
  if (Object.keys(body).some((k) => !(CLINIC_KEYS as string[]).includes(k)) || CLINIC_KEYS.some((k) => typeof body[k] !== "string")) return bad();
  const v = Object.fromEntries(CLINIC_KEYS.map((k) => [k, body[k] as string])) as ClinicValues;
  const errors = validateClinic(v);
  if (errors.length > 0) return fieldFail(errors);
  const data = {
    nameJa: v.nameJa.trim(), nameEn: nullIfBlank(v.nameEn), nameVi: nullIfBlank(v.nameVi), nameKana: fullWidthSpaces(v.nameKana.trim()), postcode: v.postcode.trim(),
    prefecture: v.prefecture.trim(), city: v.city.trim(), addressLine: v.addressLine.trim(), addressEn: nullIfBlank(v.addressEn), phone: v.phone.trim(),
    accessJa: v.accessJa.trim(), accessEn: nullIfBlank(v.accessEn), accessVi: nullIfBlank(v.accessVi), mapUrl: nullIfBlank(v.mapUrl),
    noticeJa: nullIfBlank(v.noticeJa), noticeEn: nullIfBlank(v.noticeEn), noticeVi: nullIfBlank(v.noticeVi),
  };
  return prisma.$transaction(async (tx) => {
    const before = await tx.clinic.findUniqueOrThrow({ where: { id: a.clinicId } });
    const changed = changedColumns(CLINIC_COLUMN, before, data);
    if (changed.length > 0) {
      await tx.clinic.update({ where: { id: a.clinicId }, data });
      await masterAudit(tx, a, "clinics", a.clinicId, changed);
    }
    return done({ code: "SI042" });
  });
}

// ── event 6: the B3 manual run ──────────────────────────────────────────────────────────────────────────────────────

/**
 * X3 retries once after 10 minutes, which no HTTP request can wait for: the run starts without being awaited and the
 * page polls 抽出7. We wait only until its batch_runs row exists, so the first poll cannot see the previous run.
 * shortcut: in-process background run, single instance only; move to a job queue before running more than one instance
 */
export async function startHolidayImport(_a: Actor, params: Record<string, unknown> = {}): Promise<Result> {
  const since = new Date();
  void runJob("B3", { trigger: "MANUAL", params }).catch((e) => log("error", "B3 manual run failed", { error: e instanceof Error ? e.message : String(e) }));
  for (let i = 0; i < 60; i++) {
    if (await prisma.batchRun.count({ where: { jobCode: "B3", startedAt: { gte: since } } })) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  return done({ since: since.toISOString() });
}
