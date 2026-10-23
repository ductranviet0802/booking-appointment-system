// Business dates (DATE) and times (TIME(0)) are Asia/Tokyo values (03 §0). Prisma maps them to JS Dates at UTC:
// DATE 2026-10-23 ↔ 2026-10-23T00:00:00Z, TIME 09:30 ↔ 1970-01-01T09:30:00Z. Japan has no DST.
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** "2026-10-23" → value for a DATE column */
export function dbDate(isoDate: string) {
  return new Date(`${isoDate}T00:00:00Z`);
}

/** "09:30" → value for a TIME(0) column */
export function dbTime(hhmm: string) {
  return new Date(`1970-01-01T${hhmm}:00Z`);
}

/** DATE column value → "2026-10-23" */
export function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

/** TIME column value → "09:30" */
export function toHhmm(value: Date) {
  return value.toISOString().slice(11, 16);
}

/** today in Asia/Tokyo, "2026-10-23" */
export function todayJst(now = new Date()) {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number) {
  const d = dbDate(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/** 0 (Sun) … 6 (Sat), as clinic_business_hours.weekday */
export function weekdayOf(isoDate: string) {
  return dbDate(isoDate).getUTCDay();
}

/** JST date + time → instant (e.g. to compare a frame start with now) */
export function jstInstant(isoDate: string, hhmm: string) {
  return new Date(`${isoDate}T${hhmm}:00+09:00`);
}
