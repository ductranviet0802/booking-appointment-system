// spec-screen: A02
// A02 §4.2 input checks (rows 1-23) and the overlap rule (row 12, Q11): one pure module for the checks of the page (events 3, 4, 10) and
// the server re-check of events 5 and 6. Times are strict HH:MM (Q12 a); order errors are SE002 (Q12 a); SE042 names the band and
// its hours without a leading zero (Q12 c), 「休診」 when the band is closed (Q12 b).
import { blank, isoDateOk, timeOk, WEEKDAY_JA, WEEK_ORDER, type BandCode } from "@/lib/admin/calendar-rules";
import type { FieldError } from "@/lib/auth/validate";

export { WEEKDAY_JA, WEEK_ORDER };
export const BAND_LABEL: Record<BandCode, string> = { AM: "午前", PM: "午後" };
export const EXC_KINDS = ["OFF", "EXTRA", "SUBSTITUTE"] as const;
export type ExcKind = (typeof EXC_KINDS)[number];
export const EXC_LABEL: Record<ExcKind, string> = { OFF: "休み", EXTRA: "追加勤務", SUBSTITUTE: "代診" };
/** exception band as the page holds it: 終日 only for 休み */
export type ExcBand = "ALL" | BandCode;
export const TITLE_SHORT: Record<string, string> = { DIRECTOR: "院長", VICE_DIRECTOR: "副院長", PART_TIME: "非常勤", DOCTOR: "" };

/** a pattern row as the page holds it and as the request carries it (`id` null = new) */
export type PatternValues = {
  id: string | null; departmentId: string; weekday: string; band: BandCode | ""; start: string; end: string; validFrom: string; validTo: string;
};
/** the other rows of the doctor for the overlap check (any clinic) */
export type PatternRef = { weekday: number; start: string; end: string; validFrom: string; validTo: string | null; clinicName: string };
export type ExceptionValues = {
  date: string; kind: ExcKind | ""; band: ExcBand | ""; departmentId: string; start: string; end: string; substituteDoctorId: string; note: string;
};
/** 診療時間 of one band: null = closed */
export type BandHours = { open: string; close: string } | null;

const at = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const e = (field: string, code: string, params?: Record<string, string | number>): FieldError => ({ field, code, ...(params && { params }) });
/** 「9:00」 (no leading zero, Q12 c) */
const short = (t: string) => `${Number(t.slice(0, 2))}:${t.slice(3, 5)}`;
export const hoursText = (h: BandHours) => (h ? `${short(h.open)}〜${short(h.close)}` : "休診");

/** SE042 when [start, end) is not inside the band hours; the caller has checked both times */
function outside(field: string, band: BandCode, hours: BandHours, start: string, end: string): FieldError | null {
  if (hours && at(start) >= at(hours.open) && at(end) <= at(hours.close)) return null;
  return e(field, "SE042", { 時間帯: BAND_LABEL[band], 診療時間: hoursText(hours) });
}

/** the two time boxes of a row (rows 5-8 / 19-21); `field` = the field id prefix */
function checkTimes(errors: FieldError[], field: string, start: string, end: string, band: BandCode | "", hours: BandHours, outsideCheck: boolean) {
  const s = start.trim();
  const t = end.trim();
  let ok = true;
  for (const [box, v, name] of [["start", s, "開始"], ["end", t, "終了"]] as const) {
    if (blank(v)) { errors.push(e(`${field}.${box}`, "SE001", { 項目: name })); ok = false; }
    else if (!timeOk(v)) { errors.push(e(`${field}.${box}`, "SE002", { 項目: name })); ok = false; }
  }
  if (!ok) return;
  if (at(t) <= at(s)) errors.push(e(`${field}.end`, "SE002", { 項目: "終了" }));
  else if (outsideCheck && band) {
    const x = outside(`${field}.start`, band, hours, s, t);
    if (x) errors.push(x);
  }
}

/**
 * Rows 1-11 of one pattern row. `today` = Asia/Tokyo today; `hours` = the hours of the weekday × band of the session clinic.
 * `editable`: which parts the row lets the user change (a row in effect: only 終了日, Q4 / 4-3).
 */
export function validatePattern(
  v: PatternValues, key: string, o: { today: string; hours: (weekday: number, band: BandCode) => BandHours; only?: "validTo" },
): FieldError[] {
  const f = (name: string) => `p.${key}.${name}`;
  const errors: FieldError[] = [];
  if (o.only !== "validTo") {
    if (blank(v.departmentId)) errors.push(e(f("departmentId"), "SE001", { 項目: "診療科" }));
    if (blank(v.weekday)) errors.push(e(f("weekday"), "SE001", { 項目: "曜日" }));
    if (v.band === "") errors.push(e(f("band"), "SE001", { 項目: "時間帯" }));
    const wd = blank(v.weekday) ? null : Number(v.weekday);
    checkTimes(errors, `p.${key}`, v.start, v.end, v.band, wd !== null && v.band ? o.hours(wd, v.band) : null, wd !== null && v.band !== "");
    // checkTimes names its boxes `.start` / `.end`; the page and the tests use the same names
    if (blank(v.validFrom)) errors.push(e(f("validFrom"), "SE001", { 項目: "開始日" }));
    else if (!isoDateOk(v.validFrom.trim())) errors.push(e(f("validFrom"), "SE002", { 項目: "開始日" }));
    else if (v.id === null && v.validFrom.trim() < o.today) errors.push(e(f("validFrom"), "SE043"));
  }
  const to = v.validTo.trim();
  if (to !== "") {
    if (!isoDateOk(to) || (isoDateOk(v.validFrom.trim()) && to < v.validFrom.trim())) errors.push(e(f("validTo"), "SE002", { 項目: "終了日" }));
    else if (to < o.today) errors.push(e(f("validTo"), "SE043"));
  }
  return errors;
}

/** row 12: another pattern of the doctor (any clinic) with the same weekday, time ranges that intersect (touching is fine) and validity ranges that intersect */
export function findOverlap(v: PatternValues, others: PatternRef[]): PatternRef | null {
  if (blank(v.weekday) || !timeOk(v.start.trim()) || !timeOk(v.end.trim()) || !isoDateOk(v.validFrom.trim())) return null;
  const from = v.validFrom.trim();
  const to = v.validTo.trim() === "" ? null : v.validTo.trim();
  return others.find((o) =>
    o.weekday === Number(v.weekday)
    && at(v.start.trim()) < at(o.end) && at(o.start) < at(v.end.trim())
    && (to === null || o.validFrom <= to) && (o.validTo === null || from <= o.validTo),
  ) ?? null;
}
export const overlapError = (field: string, o: PatternRef): FieldError =>
  e(field, "SE040", { 日時: `${WEEKDAY_JA[o.weekday]} ${o.start}〜${o.end}`, クリニック名: o.clinicName });

/** rows 13-23 of the exception form; `hours` = the open band of the date (SE042) for 追加勤務 */
export function validateException(v: ExceptionValues, o: { today: string; hours: (date: string, band: BandCode) => BandHours }): FieldError[] {
  const errors: FieldError[] = [];
  const date = v.date.trim();
  if (blank(date)) errors.push(e("x.date", "SE001", { 項目: "日付" }));
  else if (!isoDateOk(date)) errors.push(e("x.date", "SE002", { 項目: "日付" }));
  else if (date < o.today) errors.push(e("x.date", "SE043"));
  if (v.kind === "") {
    errors.push(e("x.kind", "SE001", { 項目: "種別" }));
    return errors;
  }
  if (v.band === "") errors.push(e("x.band", "SE001", { 項目: "時間帯" }));
  if (v.kind !== "OFF" && blank(v.departmentId)) errors.push(e("x.departmentId", "SE001", { 項目: "クリニック・診療科" }));
  if (v.kind === "EXTRA") {
    const band = v.band === "AM" || v.band === "PM" ? v.band : "";
    checkTimes(errors, "x", v.start, v.end, band, band && isoDateOk(date) ? o.hours(date, band) : null, band !== "" && isoDateOk(date));
  }
  if (v.kind === "SUBSTITUTE" && blank(v.substituteDoctorId)) errors.push(e("x.substituteDoctorId", "SE001", { 項目: "代診医" }));
  if (v.note.length > 200) errors.push(e("x.note", "SE003", { 項目: "メモ", n: 200 }));
  return errors;
}
