// spec-screen: A01
// A01 §4.2 input checks (rows 1-27): one pure module for the blur / press checks of the page and the server re-check of
// events 4, 5 and 8. Times are strict HH:MM (Q11 a); order errors are SE002 with the item name (Q11 b).
import { KATAKANA, type FieldError } from "@/lib/auth/validate";

export type BandCode = "AM" | "PM";
export const BANDS: BandCode[] = ["AM", "PM"];
/** rows of the 診療時間 table: Monday to Sunday (stored 1…6, 0) */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
export const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;
export const BAND_JA: Record<BandCode, string> = { AM: "午前", PM: "午後" };

export type HoursCellValues = { weekday: number; band: BandCode; on: boolean; open: string; close: string; reception: string };

export const DAY_KINDS = ["NORMAL", "CLOSED", "AM_CLOSED", "PM_CLOSED", "SPECIAL_OPEN"] as const;
export type DayKind = (typeof DAY_KINDS)[number];
export const KIND_JA: Record<DayKind, string> = { NORMAL: "通常", CLOSED: "休診", AM_CLOSED: "午前休診", PM_CLOSED: "午後休診", SPECIAL_OPEN: "臨時診療" };
export type DayValues = {
  date: string; kind: DayKind; amOpen: string; amClose: string; pmOpen: string; pmClose: string; noteJa: string; noteEn: string; noteVi: string;
};

export type ClinicValues = {
  nameJa: string; nameEn: string; nameVi: string; nameKana: string; postcode: string; prefecture: string; city: string; addressLine: string;
  addressEn: string; phone: string; accessJa: string; accessEn: string; accessVi: string; mapUrl: string; noticeJa: string; noticeEn: string;
  noticeVi: string;
};
export const CLINIC_KEYS: Array<keyof ClinicValues> = [
  "nameJa", "nameEn", "nameVi", "nameKana", "postcode", "prefecture", "city", "addressLine", "addressEn", "phone", "accessJa", "accessEn",
  "accessVi", "mapUrl", "noticeJa", "noticeEn", "noticeVi",
];

export const blank = (v: string) => v.replace(/[\s　]/g, "") === "";
/** HH:MM 00:00–23:59, half-width, no tolerance (Q11 a) */
export const timeOk = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export const isoDateOk = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
/** full-width katakana, ー and space (Q11 d, S-02) */

export function addDaysIso(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** cap: exception dates in one A01 save (Q-024: 2,000 accepted; the server refuses more) */
export const MAX_DAYS_PER_SAVE = 2_000;
/** every date of start…end (both ISO, start ≤ end) */
export function daysInRange(start: string, end: string) {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

export const cellField = (weekday: number, band: BandCode, box: "open" | "close" | "reception") => `h.${weekday}.${band}.${box}`;
export const dayField = (date: string, part: string) => `day.${date}.${part}`;

const e1 = (field: string, 項目: string): FieldError => ({ field, code: "SE001", params: { 項目 } });
const e2 = (field: string, 項目: string): FieldError => ({ field, code: "SE002", params: { 項目 } });
const e3 = (field: string, 項目: string, n: number): FieldError => ({ field, code: "SE003", params: { 項目, n } });
const at = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** rows 1-5: every checked cell needs open < close (HH:MM), 受付終了 empty or ≤ close, AM close ≤ PM open */
export function validateHours(cells: HoursCellValues[]): FieldError[] {
  const errors: FieldError[] = [];
  const get = (wd: number, band: BandCode) => cells.find((c) => c.weekday === wd && c.band === band);
  for (const wd of WEEK_ORDER) {
    for (const band of BANDS) {
      const c = get(wd, band);
      if (!c || !c.on) continue;
      const open = c.open.trim();
      const close = c.close.trim();
      const rec = c.reception.trim();
      const before = errors.length;
      for (const [box, v, name] of [["open", open, "開始"], ["close", close, "終了"]] as const) {
        if (blank(v)) errors.push(e1(cellField(wd, band, box), name));
        else if (!timeOk(v)) errors.push(e2(cellField(wd, band, box), name));
      }
      if (errors.length === before && at(close) <= at(open)) errors.push(e2(cellField(wd, band, "close"), "終了"));
      if (!blank(rec) && (!timeOk(rec) || (timeOk(close) && at(rec) > at(close)))) errors.push(e2(cellField(wd, band, "reception"), "受付終了"));
    }
    const am = get(wd, "AM");
    const pm = get(wd, "PM");
    if (am?.on && pm?.on && timeOk(am.close.trim()) && timeOk(pm.open.trim()) && at(am.close.trim()) > at(pm.open.trim())
      && !errors.some((x) => x.field === cellField(wd, "PM", "open"))) {
      errors.push(e2(cellField(wd, "PM", "open"), "開始"));
    }
  }
  return errors;
}

/** 臨時診療 bands as stored: a band with both times (a band with one time counts as missing, row 7) */
export function specialBands(d: Pick<DayValues, "amOpen" | "amClose" | "pmOpen" | "pmClose">) {
  const band = (o: string, c: string) => (!blank(o) && !blank(c) ? { open: o.trim(), close: c.trim() } : null);
  return { am: band(d.amOpen, d.amClose), pm: band(d.pmOpen, d.pmClose) };
}

/** rows 6-10 of one held date; `today` = Asia/Tokyo today ("YYYY-MM-DD") */
export function validateDay(d: DayValues, today: string): FieldError[] {
  if (d.date < today) return [{ field: dayField(d.date, "date"), code: "SE043" }];
  if (d.kind === "NORMAL") return [];
  const errors: FieldError[] = [];
  if (d.kind === "SPECIAL_OPEN") {
    const times = dayField(d.date, "times");
    const name = "臨時診療の時間";
    let complete = 0;
    const done: Array<{ open: string; close: string }> = [];
    for (const [o, c] of [[d.amOpen.trim(), d.amClose.trim()], [d.pmOpen.trim(), d.pmClose.trim()]] as const) {
      if (blank(o) && blank(c)) continue;
      const bad = (!blank(o) && !timeOk(o)) || (!blank(c) && !timeOk(c));
      if (bad) errors.push(e2(times, name));
      else if (!blank(o) && !blank(c)) {
        if (at(o) >= at(c)) errors.push(e2(times, name));
        else {
          complete++;
          done.push({ open: o, close: c });
        }
      }
    }
    if (done.length === 2 && at(done[0].close) > at(done[1].open)) errors.push(e2(times, name));
    if (complete === 0 && errors.length === 0) errors.push(e1(times, name));
  }
  for (const part of ["noteJa", "noteEn", "noteVi"] as const) {
    if (d[part].length > 200) errors.push(e3(dayField(d.date, part), "患者向けお知らせ", 200));
  }
  return errors.filter((x, i) => errors.findIndex((y) => y.field === x.field && y.code === x.code) === i);
}

/** 12-1 / 12-2 (events 14): empty → SE001, not a date or end before start → SE002, past → SE043; the dialog stays open */
export function validateRange(start: string, end: string, today: string, heldDates: string[] = []): FieldError[] {
  const errors: FieldError[] = [];
  if (blank(start)) errors.push(e1("range.start", "開始日"));
  else if (!isoDateOk(start)) errors.push(e2("range.start", "開始日"));
  if (blank(end)) errors.push(e1("range.end", "終了日"));
  else if (!isoDateOk(end) || (isoDateOk(start) && end < start)) errors.push(e2("range.end", "終了日"));
  if (errors.length === 0 && start < today) errors.push({ field: "range.start", code: "SE043" });
  // Q-024 answer: more than MAX_DAYS_PER_SAVE dates in one save → a message in the dialog (TMP-Q024), not ER-02
  if (errors.length === 0) {
    const span = (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1;
    if (span > MAX_DAYS_PER_SAVE || new Set([...heldDates, ...daysInRange(start, end)]).size > MAX_DAYS_PER_SAVE) {
      errors.push({ field: "range.end", code: "TMP-Q024" });
    }
  }
  return errors;
}

/** rows 13-27 (events 3 / 8) */
export function validateClinic(v: ClinicValues): FieldError[] {
  const errors: FieldError[] = [];
  const f = (key: keyof ClinicValues) => v[key].trim();
  const req = (key: keyof ClinicValues, name: string) => {
    if (blank(v[key])) {
      errors.push(e1(`clinic.${key}`, name));
      return false;
    }
    return true;
  };
  const max = (key: keyof ClinicValues, name: string, n: number) => {
    if (f(key).length > n) errors.push(e3(`clinic.${key}`, name, n));
  };
  if (req("nameJa", "クリニック名")) max("nameJa", "クリニック名", 100);
  max("nameEn", "クリニック名", 100);
  max("nameVi", "クリニック名", 100);
  if (req("nameKana", "クリニック名カナ")) {
    if (!KATAKANA.test(f("nameKana"))) errors.push(e2("clinic.nameKana", "クリニック名カナ"));
    else max("nameKana", "クリニック名カナ", 100);
  }
  if (req("postcode", "郵便番号") && !/^\d{7}$/.test(f("postcode"))) errors.push(e2("clinic.postcode", "郵便番号"));
  for (const [key, n] of [["prefecture", 10], ["city", 50], ["addressLine", 200]] as const) {
    if (req(key, "住所")) max(key, "住所", n);
  }
  max("addressEn", "住所（英語表記）", 300);
  if (req("phone", "電話番号") && !/^\d{10,11}$/.test(f("phone"))) errors.push(e2("clinic.phone", "電話番号"));
  req("accessJa", "アクセス");
  const url = f("mapUrl");
  if (url !== "") {
    if (!/^https:\/\/\S+$/.test(url)) errors.push(e2("clinic.mapUrl", "地図URL"));
    else max("mapUrl", "地図URL", 500);
  }
  return errors;
}
