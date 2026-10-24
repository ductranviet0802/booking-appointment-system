// spec-screen: A02
// A02 医師シフト: the reads (抽出2-8), the dry run (event 5, 抽出10), the save (event 6, 更新1 / 2 / 3 / 4) and the doctor scope of
// 抽出1. Every write is one transaction with its audit rows; B2 (EVENT) runs after the commit, once per clinic the save changes (Q2).
import type { Band, Prisma } from "@prisma/client";
import { bad, changedColumns, done, fail, fieldFail, isUuid, masterAudit, type Actor, type Db } from "@/lib/admin/common";
import { isoDateOk } from "@/lib/admin/calendar-rules";
import {
  EXC_KINDS, findOverlap, overlapError, TITLE_SHORT, validateException, validatePattern,
  type BandHours, type ExceptionValues, type ExcKind, type PatternRef, type PatternValues,
} from "@/lib/admin/shifts-rules";
import type { FieldError } from "@/lib/auth/validate";
import type { Result } from "@/lib/auth/service";
import { adjustRequiredCount, dailyRange, daysBetween, generateClinic, openBandsForDate, openBandsOn } from "@/lib/batch/b2-frames";
import { runJob } from "@/lib/batch/runner";
import { addDays, dbDate, dbTime, todayJst, toHhmm, toIsoDate, weekdayOf } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";

// ── what the screen reads ──────────────────────────────────────────────────────────────────────────────────────────

export type DoctorItem = { id: string; name: string; sub: string };
export type PatternRow = {
  id: string; clinicId: string; clinicName: string; departmentId: string; departmentName: string; weekday: number; band: "AM" | "PM";
  start: string; end: string; validFrom: string; validTo: string | null;
};
export type ExceptionRow = {
  id: string; date: string; kind: ExcKind; band: "AM" | "PM" | null; departmentId: string | null; clinicName: string | null; departmentName: string | null;
  start: string | null; end: string | null; substituteName: string | null; note: string | null;
};
export type ShiftDetail = {
  doctorId: string;
  doctorName: string;
  patterns: PatternRow[];
  exceptions: ExceptionRow[];
  choices: { clinicId: string; clinicName: string; departments: Array<{ id: string; name: string }>; substitutes: Array<{ id: string; name: string }>; hours: Array<{ weekday: number; band: "AM" | "PM"; open: string; close: string }> };
};
export type WeekView = { start: string; days: string[]; rows: Array<{ doctorId: string; name: string; cells: string[] }> };

const fullName = (d: { familyName: string; givenName: string }) => `${d.familyName} ${d.givenName}`;
export const mondayOf = (isoDate: string) => addDays(isoDate, -((weekdayOf(isoDate) + 6) % 7));

/** 抽出2: the doctors offered for the session clinic; a DOCTOR account sees only itself (抽出1) */
export async function listDoctors(clinicId: string, role: string, accountId: string): Promise<DoctorItem[]> {
  const doctors = await prisma.doctor.findMany({
    where: role === "DOCTOR"
      ? { accountId }
      : { isActive: true, departments: { some: { department: { clinicDepartments: { some: { clinicId } } } } } },
    include: { departments: { include: { department: { include: { clinicDepartments: { where: { clinicId } } } } } } },
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
  });
  return doctors.map((d) => {
    const depts = d.departments
      .filter((x) => x.department.clinicDepartments.length > 0)
      .sort((x, y) => x.department.clinicDepartments[0].displayOrder - y.department.clinicDepartments[0].displayOrder)
      .map((x) => x.department.nameJa);
    return { id: d.id, name: fullName(d), sub: [TITLE_SHORT[d.title], depts.join("、")].filter(Boolean).join("・") };
  });
}

/** the doctor of a request: a Result when it is not allowed (403 SE091) or does not exist (ER-02) */
export async function resolveDoctor(a: Actor, doctorId: unknown): Promise<{ doctor: DoctorItem } | { result: Result }> {
  if (!isUuid(doctorId)) return { result: bad() };
  const list = await listDoctors(a.clinicId, a.role, a.accountId);
  const found = list.find((d) => d.id === doctorId);
  if (found) return { doctor: found };
  return { result: (await prisma.doctor.count({ where: { id: doctorId } })) > 0 ? fail(403, "SE091") : bad() };
}

/** 抽出3-6 for one doctor */
export async function loadDetail(a: Pick<Actor, "clinicId" | "now">, doctor: DoctorItem): Promise<ShiftDetail> {
  const today = todayJst(a.now);
  const [patterns, exceptions, clinic, hours, offered, doctorDepts, subs] = await Promise.all([
    prisma.doctorShiftPattern.findMany({ where: { doctorId: doctor.id }, include: { clinic: true, department: true } }),
    prisma.doctorShiftException.findMany({ where: { doctorId: doctor.id }, include: { clinic: true, department: true, substituteDoctor: true } }),
    prisma.clinic.findUniqueOrThrow({ where: { id: a.clinicId } }),
    prisma.clinicBusinessHour.findMany({ where: { clinicId: a.clinicId } }),
    prisma.clinicDepartment.findMany({ where: { clinicId: a.clinicId }, include: { department: true }, orderBy: { displayOrder: "asc" } }),
    prisma.doctorDepartment.findMany({ where: { doctorId: doctor.id } }),
    prisma.doctor.findMany({
      where: { isActive: true, id: { not: doctor.id }, departments: { some: { department: { clinicDepartments: { some: { clinicId: a.clinicId } } } } } },
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
    }),
  ]);
  const mine = new Set(doctorDepts.map((d) => d.departmentId));
  const ended = (p: { validTo: Date | null }) => p.validTo !== null && toIsoDate(p.validTo) < today;
  const sorted = [...patterns].sort((x, y) =>
    Number(ended(x)) - Number(ended(y))
    || Number(y.clinicId === a.clinicId) - Number(x.clinicId === a.clinicId)
    || x.clinic.displayOrder - y.clinic.displayOrder
    || ((x.weekday + 6) % 7) - ((y.weekday + 6) % 7)
    || (x.band === y.band ? 0 : x.band === "AM" ? -1 : 1)
    || toIsoDate(x.validFrom).localeCompare(toIsoDate(y.validFrom)),
  );
  const future = exceptions.filter((x) => toIsoDate(x.shiftDate) >= today).sort((x, y) => toIsoDate(x.shiftDate).localeCompare(toIsoDate(y.shiftDate)));
  const past = exceptions.filter((x) => toIsoDate(x.shiftDate) < today).sort((x, y) => toIsoDate(y.shiftDate).localeCompare(toIsoDate(x.shiftDate)));
  return {
    doctorId: doctor.id,
    doctorName: doctor.name,
    patterns: sorted.map((p) => ({
      id: p.id, clinicId: p.clinicId, clinicName: p.clinic.nameJa, departmentId: p.departmentId, departmentName: p.department.nameJa, weekday: p.weekday,
      band: p.band, start: toHhmm(p.startTime), end: toHhmm(p.endTime), validFrom: toIsoDate(p.validFrom), validTo: p.validTo ? toIsoDate(p.validTo) : null,
    })),
    exceptions: [...future, ...past].map((x) => ({
      id: x.id, date: toIsoDate(x.shiftDate), kind: x.kind, band: x.band, departmentId: x.departmentId, clinicName: x.clinic?.nameJa ?? null, departmentName: x.department?.nameJa ?? null,
      start: x.startTime ? toHhmm(x.startTime) : null, end: x.endTime ? toHhmm(x.endTime) : null, substituteName: x.substituteDoctor ? fullName(x.substituteDoctor) : null, note: x.note,
    })),
    choices: {
      clinicId: a.clinicId,
      clinicName: clinic.nameJa,
      departments: offered.filter((o) => mine.has(o.departmentId)).map((o) => ({ id: o.departmentId, name: o.department.nameJa })),
      substitutes: subs.map((d) => ({ id: d.id, name: fullName(d) })),
      hours: hours.map((h) => ({ weekday: h.weekday, band: h.band, open: toHhmm(h.openTime), close: toHhmm(h.closeTime) })),
    },
  };
}

/** 抽出7: the saved frames of the displayed week as the cell texts of item 18 (Q7) */
export async function loadWeek(a: Pick<Actor, "clinicId">, doctors: DoctorItem[], start: string): Promise<WeekView> {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const dbDays = days.map(dbDate);
  const ids = doctors.map((d) => d.id);
  const [slots, excs, hours, calDays, holidays, names] = await Promise.all([
    prisma.slot.findMany({ where: { clinicId: a.clinicId, slotDate: { in: dbDays }, doctorId: { in: ids } } }),
    prisma.doctorShiftException.findMany({ where: { kind: "SUBSTITUTE", shiftDate: { in: dbDays }, OR: [{ doctorId: { in: ids } }, { substituteDoctorId: { in: ids } }] } }),
    prisma.clinicBusinessHour.findMany({ where: { clinicId: a.clinicId } }),
    prisma.clinicCalendarDay.findMany({ where: { clinicId: a.clinicId, calDate: { in: dbDays } } }),
    prisma.holiday.findMany({ where: { holidayDate: { in: dbDays }, isActive: true } }),
    prisma.doctor.findMany({ select: { id: true, familyName: true, givenName: true } }),
  ]);
  const nameOf = new Map(names.map((d) => [d.id, fullName(d)]));
  const hourRows = hours.map((h) => ({ weekday: h.weekday, band: h.band, open: toHhmm(h.openTime), close: toHhmm(h.closeTime), reception: null }));
  const holidaySet = new Set(holidays.map((h) => toIsoDate(h.holidayDate)));
  const openOf = new Map(days.map((d) => {
    const c = calDays.find((x) => toIsoDate(x.calDate) === d);
    const cal = c && { kind: c.kind, amOpen: c.amOpen ? toHhmm(c.amOpen) : null, amClose: c.amClose ? toHhmm(c.amClose) : null, pmOpen: c.pmOpen ? toHhmm(c.pmOpen) : null, pmClose: c.pmClose ? toHhmm(c.pmClose) : null };
    return [d, openBandsOn(d, hourRows, cal ?? null, holidaySet.has(d))] as const;
  }));
  const bandOfSlot = (date: string, time: string): "AM" | "PM" =>
    openOf.get(date)?.find((b) => time >= b.open && time < b.close)?.band ?? (time < "13:00" ? "AM" : "PM");
  const label = { AM: "午前", PM: "午後" };

  return {
    start, days,
    rows: doctors.map((d) => ({
      doctorId: d.id, name: d.name,
      cells: days.map((date) => {
        const mine = slots.filter((s) => s.doctorId === d.id && toIsoDate(s.slotDate) === date);
        const open = new Set(mine.filter((s) => s.status === "OPEN").map((s) => bandOfSlot(date, toHhmm(s.startTime))));
        const subs = excs.filter((x) => toIsoDate(x.shiftDate) === date);
        const given = new Map(subs.filter((x) => x.doctorId === d.id && x.band).map((x) => [x.band as Band, nameOf.get(x.substituteDoctorId ?? "") ?? ""]));
        const received = new Set(subs.filter((x) => x.substituteDoctorId === d.id && x.band).map((x) => x.band as Band));
        const parts: string[] = [];
        for (const band of ["AM", "PM"] as const) {
          if (given.has(band)) parts.push(`代診→${given.get(band)}・${label[band]}`);
          else if (open.has(band)) parts.push(`${label[band]}${received.has(band) ? "(代診)" : ""}`);
        }
        if (parts.length > 0) return parts.join(parts.some((p) => p.startsWith("代診→")) ? " / " : "・");
        const closedDay = mine.length > 0 && mine.every((s) => s.status === "CLOSED" && (s.closedReason === "HOLIDAY" || s.closedReason === "CLINIC_CLOSED") && s.reservedCount === 0);
        return closedDay ? "休診" : "—";
      }),
    })),
  };
}

/** events 2 / 12 and the refresh after a save: the answers of the read routes (DOCTOR: own data only, another doctor → 403 SE091) */
export async function readDetail(a: Actor, doctorId: unknown): Promise<Result> {
  const d = await resolveDoctor(a, doctorId);
  if ("result" in d) return d.result;
  return done({ detail: await loadDetail(a, d.doctor) });
}
export async function readWeek(a: Actor, start: unknown): Promise<Result> {
  if (typeof start !== "string" || !isoDateOk(start)) return bad();
  const doctors = await listDoctors(a.clinicId, a.role, a.accountId);
  return done({ week: await loadWeek(a, doctors, mondayOf(start)), adjustCount: a.role === "DOCTOR" ? 0 : await adjustRequiredCount(prisma, a.clinicId) });
}
/** 抽出5 for the hold check of an exception (event 10): the open bands of a date at the session clinic */
export async function readHours(a: Actor, date: unknown): Promise<Result> {
  if (typeof date !== "string" || !isoDateOk(date)) return bad();
  const bands = await openBandsForDate(prisma, a.clinicId, date);
  return done({ bands: bands.map((b) => ({ band: b.band, open: b.open, close: b.close })) });
}

// ── reading the request ────────────────────────────────────────────────────────────────────────────────────────────

/** a value the UI cannot produce → ER-02 (SE090), nothing written */
class Tampered extends Error {}
function must(ok: boolean): asserts ok {
  if (!ok) throw new Tampered();
}
const str = (v: unknown, max = 400) => {
  must(typeof v === "string" && v.length <= max);
  return v as string;
};

type HeldPattern = PatternValues & { key: string; delete: boolean };
type Held = { patterns: HeldPattern[]; add: ExceptionValues[]; remove: string[] };

function parseHeld(body: Record<string, unknown>): Held {
  must(Array.isArray(body.patterns) && body.patterns.length <= 200 && Array.isArray(body.exceptionsAdd) && body.exceptionsAdd.length <= 200
    && Array.isArray(body.exceptionsDelete) && body.exceptionsDelete.length <= 200);
  const patterns = (body.patterns as Record<string, unknown>[]).map((p) => {
    must(!!p && typeof p === "object" && (p.id === null || isUuid(p.id)) && typeof p.delete === "boolean");
    const band = p.band;
    must(band === "AM" || band === "PM" || band === "");
    const weekday = str(p.weekday, 2);
    must(weekday === "" || /^[0-6]$/.test(weekday));
    return {
      key: str(p.key, 40), id: p.id as string | null, delete: p.delete as boolean, departmentId: str(p.departmentId, 40), weekday, band: band as PatternValues["band"],
      start: str(p.start, 20), end: str(p.end, 20), validFrom: str(p.validFrom, 20), validTo: str(p.validTo, 20),
    };
  });
  must(new Set(patterns.map((p) => p.key)).size === patterns.length);
  const add = (body.exceptionsAdd as Record<string, unknown>[]).map((x) => {
    must(!!x && typeof x === "object" && (x.kind === "" || (EXC_KINDS as readonly unknown[]).includes(x.kind)) && ["", "ALL", "AM", "PM"].includes(x.band as string));
    return {
      date: str(x.date, 20), kind: x.kind as ExceptionValues["kind"], band: x.band as ExceptionValues["band"], departmentId: str(x.departmentId, 40), start: str(x.start, 20),
      end: str(x.end, 20), substituteDoctorId: str(x.substituteDoctorId, 40), note: str(x.note, 2_000),
    };
  });
  must(Array.isArray(body.exceptionsDelete) && (body.exceptionsDelete as unknown[]).every(isUuid));
  return { patterns, add, remove: [...new Set(body.exceptionsDelete as string[])] };
}

// ── what a save changes ────────────────────────────────────────────────────────────────────────────────────────────

const PATTERN_COLS = ["id", "doctor_id", "clinic_id", "department_id", "weekday", "band", "start_time", "end_time", "valid_from", "valid_to", "created_at", "updated_at"];
const EXCEPTION_COLS = ["id", "doctor_id", "shift_date", "kind", "clinic_id", "department_id", "band", "start_time", "end_time", "substitute_doctor_id", "note", "created_by", "created_at", "updated_at"];
const PATTERN_NAMES = { departmentId: "department_id", weekday: "weekday", band: "band", start: "start_time", end: "end_time", validFrom: "valid_from", validTo: "valid_to" };

type SavePlan = {
  patternIns: HeldPattern[]; patternUpd: Array<{ row: HeldPattern; data: Prisma.DoctorShiftPatternUncheckedUpdateInput }>; patternDel: string[];
  excIns: ExceptionValues[]; excDel: string[];
  patternColumns: string[]; excColumns: string[];
  /** clinic → dates the save changes (Q2, Q10) */
  runs: Map<string, Set<string>>;
};
type Checked = { plan: SavePlan } | { result: Result };

/** parse, check (§4.2 rows 1-23, rules of 4-3) and diff the held rows against the stored ones; nothing is written */
async function prepare(db: Db, a: Actor, doctor: DoctorItem, body: Record<string, unknown>): Promise<Checked> {
  let held: Held;
  try {
    held = parseHeld(body);
  } catch (e) {
    if (e instanceof Tampered) return { result: bad() };
    throw e;
  }
  const today = todayJst(a.now);
  const detail = await loadDetail(a, doctor);
  const stored = new Map(detail.patterns.map((p) => [p.id, p]));
  const storedExc = new Map(detail.exceptions.map((x) => [x.id, x]));
  const offered = new Set(detail.choices.departments.map((d) => d.id));
  const hoursOf = (weekday: number, band: "AM" | "PM"): BandHours => {
    const h = detail.choices.hours.find((x) => x.weekday === weekday && x.band === band);
    return h ? { open: h.open, close: h.close } : null;
  };
  const errors: FieldError[] = [];
  const plan: SavePlan = { patternIns: [], patternUpd: [], patternDel: [], excIns: [], excDel: [], patternColumns: [], excColumns: [], runs: new Map() };
  const patternCols = new Set<string>();
  const excCols = new Set<string>();
  const mark = (clinicId: string, dates: Iterable<string>) => {
    const set = plan.runs.get(clinicId) ?? new Set<string>();
    for (const d of dates) set.add(d);
    plan.runs.set(clinicId, set);
  };
  const final: Array<{ key: string; v: PatternValues; ref: PatternRef; held: boolean }> = detail.patterns.map((p) => ({
    key: p.id, held: false, v: { id: p.id, departmentId: p.departmentId, weekday: String(p.weekday), band: p.band, start: p.start, end: p.end, validFrom: p.validFrom, validTo: p.validTo ?? "" },
    ref: { weekday: p.weekday, start: p.start, end: p.end, validFrom: p.validFrom, validTo: p.validTo, clinicName: p.clinicName },
  }));
  // the dates of the next 190 days (more than any booking window + 7) on the weekday inside the validity ranges; each clinic's own range prunes them below
  const horizon = daysBetween(today, addDays(today, 190));
  const touched = (p: { weekday: number | string }, ranges: Array<[string, string | null]>, clinicId: string) =>
    mark(clinicId, horizon.filter((d) => weekdayOf(d) === Number(p.weekday) && ranges.some(([f, t]) => d >= f && (t === null || d <= t))));

  for (const p of held.patterns) {
    const s = p.id ? stored.get(p.id) : undefined;
    must(p.id === null || !!s);
    if (s) {
      must(s.clinicId === a.clinicId && !(s.validTo !== null && s.validTo < today)); // another clinic's rows and ended rows are never written
      if (p.delete) {
        must(s.validFrom > today); // 削除 only for a row that starts after today
        plan.patternDel.push(s.id);
        PATTERN_COLS.forEach((c) => patternCols.add(c));
        final.splice(final.findIndex((x) => x.key === s.id), 1);
        touched(s, [[s.validFrom, s.validTo]], s.clinicId);
        continue;
      }
      const inEffect = s.validFrom <= today;
      const next: PatternValues = inEffect
        ? { id: s.id, departmentId: s.departmentId, weekday: String(s.weekday), band: s.band, start: s.start, end: s.end, validFrom: s.validFrom, validTo: p.validTo }
        : { ...p };
      if (inEffect) must(p.departmentId === s.departmentId && p.weekday === String(s.weekday) && p.band === s.band && p.start === s.start && p.end === s.end && p.validFrom === s.validFrom);
      const errs = validatePattern(next, p.key, { today, hours: hoursOf, only: inEffect ? "validTo" : undefined });
      errors.push(...errs);
      const entry = final.find((x) => x.key === s.id)!;
      entry.held = true;
      entry.v = next;
      if (errs.length === 0) {
        entry.ref = { ...entry.ref, weekday: Number(next.weekday), start: next.start.trim(), end: next.end.trim(), validFrom: next.validFrom.trim(), validTo: next.validTo.trim() || null };
        must(inEffect || offered.has(next.departmentId));
        const cols = changedColumns(PATTERN_NAMES, { departmentId: s.departmentId, weekday: String(s.weekday), band: s.band, start: s.start, end: s.end, validFrom: s.validFrom, validTo: s.validTo ?? "" },
          { departmentId: next.departmentId, weekday: next.weekday, band: next.band, start: next.start.trim(), end: next.end.trim(), validFrom: next.validFrom.trim(), validTo: next.validTo.trim() });
        if (cols.length > 0) {
          plan.patternUpd.push({
            row: p, data: inEffect ? { validTo: next.validTo.trim() ? dbDate(next.validTo.trim()) : null } : {
              departmentId: next.departmentId, weekday: Number(next.weekday), band: next.band as Band, startTime: dbTime(next.start.trim()), endTime: dbTime(next.end.trim()),
              validFrom: dbDate(next.validFrom.trim()), validTo: next.validTo.trim() ? dbDate(next.validTo.trim()) : null,
            },
          });
          cols.forEach((c) => patternCols.add(c));
          touched(s, [[s.validFrom, s.validTo]], s.clinicId);
          touched({ weekday: next.weekday }, [[next.validFrom.trim(), next.validTo.trim() || null]], s.clinicId);
        }
      }
    } else {
      must(!p.delete);
      errors.push(...validatePattern(p, p.key, { today, hours: hoursOf }));
      must(p.departmentId === "" || offered.has(p.departmentId));
      const ok = !errors.some((x) => x.field.startsWith(`p.${p.key}.`));
      final.push({
        key: p.key, held: true, v: p,
        ref: { weekday: Number(p.weekday), start: p.start.trim(), end: p.end.trim(), validFrom: p.validFrom.trim(), validTo: p.validTo.trim() || null, clinicName: detail.choices.clinicName },
      });
      if (ok) {
        plan.patternIns.push(p);
        PATTERN_COLS.forEach((c) => patternCols.add(c));
        touched({ weekday: p.weekday }, [[p.validFrom.trim(), p.validTo.trim() || null]], a.clinicId);
      }
    }
  }
  // row 12: each held row against every other row of the doctor, at any clinic
  for (const entry of final.filter((x) => x.held)) {
    if (errors.some((x) => x.field.startsWith(`p.${entry.key}.`))) continue;
    const hit = findOverlap(entry.v, final.filter((x) => x !== entry).map((x) => x.ref));
    if (hit) errors.push(overlapError(`p.${entry.key}.row`, hit));
  }

  // exceptions: INSERT and DELETE only (更新2)
  const dates = [...new Set(held.add.map((x) => x.date.trim()).filter(isoDateOk))];
  const bandsOn = new Map(await Promise.all(dates.map(async (d) => [d, await openBandsForDate(db, a.clinicId, d)] as const)));
  const exHours = (date: string, band: "AM" | "PM"): BandHours => {
    const b = bandsOn.get(date)?.find((x) => x.band === band);
    return b ? { open: b.open, close: b.close } : null;
  };
  const subs = new Set(detail.choices.substitutes.map((x) => x.id));
  for (const x of held.add) {
    errors.push(...validateException(x, { today, hours: exHours }));
    must(x.kind !== "" && x.band !== "");
    must(x.band !== "ALL" || x.kind === "OFF");
    if (x.kind === "OFF") must(x.departmentId === "" && x.start === "" && x.end === "" && x.substituteDoctorId === "");
    else must(offered.has(x.departmentId));
    if (x.kind !== "EXTRA") must(x.start === "" && x.end === "");
    if (x.kind === "SUBSTITUTE") must(subs.has(x.substituteDoctorId));
    else must(x.substituteDoctorId === "");
    must(isoDateOk(x.date.trim()));
  }
  for (const id of held.remove) {
    const s = storedExc.get(id);
    must(!!s && s.date >= today);
    plan.excDel.push(id);
    EXCEPTION_COLS.forEach((c) => excCols.add(c));
    await markException(db, doctor.id, { date: s.date, kind: s.kind, clinicId: s.kind === "OFF" ? null : a.clinicId }, a.clinicId, mark);
  }
  if (errors.length > 0) return { result: fieldFail(errors) };
  for (const x of held.add) {
    plan.excIns.push(x);
    EXCEPTION_COLS.forEach((c) => excCols.add(c));
    await markException(db, doctor.id, { date: x.date.trim(), kind: x.kind as ExcKind, clinicId: x.kind === "OFF" ? null : a.clinicId }, a.clinicId, mark);
  }
  plan.patternColumns = [...patternCols];
  plan.excColumns = [...excCols];
  // only dates in each clinic's daily range are planned (B2 would skip the rest)
  for (const [clinicId, set] of plan.runs) {
    const range = await dailyRange(db, clinicId, a.now);
    const kept = [...set].filter((d) => d >= range.from && d <= range.to).sort();
    if (kept.length === 0) plan.runs.delete(clinicId);
    else plan.runs.set(clinicId, new Set(kept));
  }
  return { plan };
}

/** the clinics an exception changes: a 休み every clinic where the doctor has a pattern or a frame that day; 追加勤務 / 代診 its own clinic */
async function markException(
  db: Db, doctorId: string, x: { date: string; kind: ExcKind; clinicId: string | null }, sessionClinic: string,
  mark: (clinicId: string, dates: Iterable<string>) => void,
) {
  if (x.kind !== "OFF") return mark(x.clinicId ?? sessionClinic, [x.date]);
  const wd = weekdayOf(x.date);
  const [patterns, slots] = await Promise.all([
    db.doctorShiftPattern.findMany({ where: { doctorId, weekday: wd, validFrom: { lte: dbDate(x.date) }, OR: [{ validTo: null }, { validTo: { gte: dbDate(x.date) } }] }, select: { clinicId: true } }),
    db.slot.findMany({ where: { doctorId, slotDate: dbDate(x.date) }, select: { clinicId: true }, distinct: ["clinicId"] }),
  ]);
  for (const id of new Set([sessionClinic, ...patterns.map((p) => p.clinicId), ...slots.map((s) => s.clinicId)])) mark(id, [x.date]);
}

async function apply(db: Db, a: Actor, doctorId: string, plan: SavePlan) {
  if (plan.patternDel.length > 0) await db.doctorShiftPattern.deleteMany({ where: { id: { in: plan.patternDel }, doctorId } });
  for (const u of plan.patternUpd) await db.doctorShiftPattern.update({ where: { id: u.row.id as string }, data: u.data });
  if (plan.patternIns.length > 0) {
    await db.doctorShiftPattern.createMany({
      data: plan.patternIns.map((p) => ({
        doctorId, clinicId: a.clinicId, departmentId: p.departmentId, weekday: Number(p.weekday), band: p.band as Band, startTime: dbTime(p.start.trim()), endTime: dbTime(p.end.trim()),
        validFrom: dbDate(p.validFrom.trim()), validTo: p.validTo.trim() ? dbDate(p.validTo.trim()) : null,
      })),
    });
  }
  if (plan.excDel.length > 0) await db.doctorShiftException.deleteMany({ where: { id: { in: plan.excDel }, doctorId } });
  if (plan.excIns.length > 0) {
    await db.doctorShiftException.createMany({
      data: plan.excIns.map((x) => ({
        doctorId, shiftDate: dbDate(x.date.trim()), kind: x.kind as ExcKind, clinicId: x.kind === "OFF" ? null : a.clinicId, departmentId: x.kind === "OFF" ? null : x.departmentId,
        band: x.band === "ALL" ? null : (x.band as Band), startTime: x.kind === "EXTRA" ? dbTime(x.start.trim()) : null, endTime: x.kind === "EXTRA" ? dbTime(x.end.trim()) : null,
        substituteDoctorId: x.kind === "SUBSTITUTE" ? x.substituteDoctorId : null, note: x.note.trim() === "" ? null : x.note.trim(), createdBy: a.accountId,
      })),
    });
  }
}

/** thrown to roll the dry-run transaction back; carries the answer */
class Rollback extends Error {
  constructor(readonly answer: Result) {
    super("rollback");
  }
}

async function load(a: Actor, body: Record<string, unknown>) {
  const r = await resolveDoctor(a, body.doctorId);
  return "result" in r ? r : { doctor: r.doctor };
}

/** event 5 (抽出10): the held rows applied inside a transaction that is rolled back, B2 planned as a dry run for each clinic → n = frames with bookings that would close */
export async function checkSave(a: Actor, body: Record<string, unknown>): Promise<Result> {
  const d = await load(a, body);
  if ("result" in d) return d.result;
  try {
    await prisma.$transaction(async (tx) => {
      const c = await prepare(tx, a, d.doctor, body);
      if ("result" in c) throw new Rollback(c.result);
      await apply(tx, a, d.doctor.id, c.plan);
      let n = 0;
      for (const [clinicId, dates] of c.plan.runs) {
        n += (await generateClinic(tx, { clinicId, dates: [...dates], runId: null, now: a.now, dryRun: true })).counts.closedWithBookings;
      }
      throw new Rollback(done({ n }));
    }, { timeout: 60_000 });
  } catch (e) {
    if (e instanceof Rollback) return e.answer;
    if (e instanceof Tampered) return bad();
    throw e;
  }
  return done({ n: 0 });
}

/** event 6: 更新1 / 2 / 4 in one transaction, then B2 (EVENT) once per clinic the save changes (更新3); a failed run keeps the saved rows */
export async function saveShifts(a: Actor, body: Record<string, unknown>): Promise<Result> {
  const d = await load(a, body);
  if ("result" in d) return d.result;
  let plan: SavePlan;
  try {
    const out = await prisma.$transaction(async (tx) => {
      const c = await prepare(tx, a, d.doctor, body);
      if ("result" in c) return c;
      await apply(tx, a, d.doctor.id, c.plan);
      await masterAudit(tx, a, "doctor_shift_patterns", d.doctor.id, c.plan.patternColumns);
      await masterAudit(tx, a, "doctor_shift_exceptions", d.doctor.id, c.plan.excColumns);
      return c;
    }, { timeout: 60_000 });
    if ("result" in out) return out.result;
    plan = out.plan;
  } catch (e) {
    if (e instanceof Tampered) return bad();
    throw e;
  }
  let failed = false;
  for (const [clinicId, dates] of [...plan.runs].sort(([x]) => (x === a.clinicId ? -1 : 1))) {
    const r = await runJob("B2", { trigger: "EVENT", clinicId, params: { dates: [...dates] } });
    if (r.result.status === "FAILED" || r.result.status === "PARTIAL" || r.result.message === "実行中のため省略") failed = true;
  }
  if (failed) return fail(409, "SE044");
  return done({ code: "SI040", params: { n: await adjustRequiredCount(prisma, a.clinicId) } });
}
