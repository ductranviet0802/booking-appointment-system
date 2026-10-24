// spec-screen: A06
// A06 §4.2 checks (client inline and server re-check): the period of 予約日 is read only when 出力種別 is 予約 or 両方 (Q4 e).
import { dbDate, toIsoDate } from "@/lib/datetime";
import { blank, type FieldError } from "@/lib/auth/validate";
import { MAX_PERIOD_DAYS, periodDays } from "@/lib/batch/b6-dates";

export const KINDS = ["PATIENTS", "BOOKINGS", "BOTH"] as const;
export type ExportKindValue = (typeof KINDS)[number];
export const isKind = (v: unknown): v is ExportKindValue => (KINDS as readonly unknown[]).includes(v);

const ITEM = { 項目: "予約日 期間" };
const SLASH = /^\d{4}\/\d{2}\/\d{2}$/;

/** "2026/10/20" → "2026-10-20"; null when not a real calendar date */
export function parseSlashDate(s: string): string | null {
  if (!SLASH.test(s)) return null;
  const iso = s.replaceAll("/", "-");
  const d = dbDate(iso);
  return !Number.isNaN(d.getTime()) && toIsoDate(d) === iso ? iso : null; // (month 13 is an Invalid Date)
}

/** items 3-1 / 3-2 (fields `from` / `to`): SE001 empty, SE002 invalid or 3-2 before 3-1, SE080 over 31 days (inclusive count) */
export function checkPeriod(kind: ExportKindValue, from: string, to: string): FieldError[] {
  if (kind === "PATIENTS") return [];
  const errors: FieldError[] = [];
  const iso: Record<string, string | null> = {};
  for (const [field, raw] of [["from", from], ["to", to]] as const) {
    if (blank(raw)) errors.push({ field, code: "SE001", params: ITEM });
    else if ((iso[field] = parseSlashDate(raw.trim())) === null) errors.push({ field, code: "SE002", params: ITEM });
  }
  if (errors.length === 0 && iso.from && iso.to) {
    if (iso.to < iso.from) errors.push({ field: "to", code: "SE002", params: ITEM });
    else if (periodDays(iso.from, iso.to) > MAX_PERIOD_DAYS) errors.push({ field: "to", code: "SE080" });
  }
  return errors;
}
