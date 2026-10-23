// Business-hours rules shared by P01 item 10 and P10 (items 8, 8-1…8-5, 9). Pure: times are "HH:MM", dates "YYYY-MM-DD".
import type { Lang } from "@/lib/i18n";
import { formatTimeRange } from "@/lib/i18n/format";

export type BandCode = "AM" | "PM";
export type HourRow = { weekday: number; band: BandCode; open: string; close: string; reception: string | null };
export type CalendarKind = "CLOSED" | "AM_CLOSED" | "PM_CLOSED" | "SPECIAL_OPEN";
export type CalendarRow = { kind: CalendarKind; amOpen: string | null; amClose: string | null; pmOpen: string | null; pmClose: string | null };
export type OpenBand = { band: BandCode; open: string; close: string };

/** Monday first (P10 Q10 f); weekday 0 = Sunday is the last column (日・祝) */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/**
 * The bands a clinic is open on a day (P01 抽出2, P10 1-2 / Q1): a calendar row of the day decides first —
 * CLOSED closed; AM_CLOSED / PM_CLOSED the other band of the weekday; SPECIAL_OPEN the times of the row (F3-03);
 * with no row an active holiday closes the clinic; else the weekday rows. [] = closed all day. Bands AM then PM.
 */
export function openBandsOfDay(o: { weekday: number; hours: HourRow[]; calendar: CalendarRow | null; isHoliday: boolean }): OpenBand[] {
  const regular = o.hours
    .filter((h) => h.weekday === o.weekday)
    .map((h) => ({ band: h.band, open: h.open, close: h.close }));
  const cal = o.calendar;
  let bands: OpenBand[];
  if (cal) {
    if (cal.kind === "CLOSED") bands = [];
    else if (cal.kind === "AM_CLOSED") bands = regular.filter((b) => b.band === "PM");
    else if (cal.kind === "PM_CLOSED") bands = regular.filter((b) => b.band === "AM");
    else {
      bands = [];
      if (cal.amOpen && cal.amClose) bands.push({ band: "AM", open: cal.amOpen, close: cal.amClose });
      if (cal.pmOpen && cal.pmClose) bands.push({ band: "PM", open: cal.pmOpen, close: cal.pmClose });
    }
  } else bands = o.isHoliday ? [] : regular;
  return bands.sort((a, b) => (a.band === b.band ? 0 : a.band === "AM" ? -1 : 1));
}

/** 「9:00〜12:00 / 15:00〜18:00」 (en / vi 9:00–12:00) */
export const joinBands = (bands: OpenBand[], lang: Lang) => bands.map((b) => formatTimeRange(b.open, b.close, lang)).join(" / ");

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** the most frequent value, a tie goes to the first in the given order (Monday first) */
function mostFrequent<T>(items: T[], key: (t: T) => string): T | null {
  const count = new Map<string, number>();
  for (const i of items) count.set(key(i), (count.get(key(i)) ?? 0) + 1);
  let best: T | null = null;
  let bestN = 0;
  for (const i of items) {
    const n = count.get(key(i)) ?? 0;
    if (n > bestN) {
      best = i;
      bestN = n;
    }
  }
  return best;
}

export type HoursCell = { kind: "closed" } | { kind: "usual" } | { kind: "own"; open: string; close: string };
export type HoursTable = {
  /** only the bands that have at least one row (P10 Q2) */
  bands: Array<{ band: BandCode; open: string; close: string }>;
  cell: (weekday: number, band: BandCode) => HoursCell;
  /** item 9: reception end per band (bands without a value left out), and the 「診療終了のN分前」 minutes when equal everywhere */
  reception: { items: Array<{ band: BandCode; time: string }>; minutesBefore: number | null } | null;
};

/** P10 抽出3 → items 8-1 … 8-3 and 9 (Q2, Q3) */
export function buildHoursTable(rows: HourRow[]): HoursTable {
  const bands: HoursTable["bands"] = [];
  const reception: Array<{ band: BandCode; time: string }> = [];
  const diffs: number[] = [];
  for (const band of ["AM", "PM"] as const) {
    const ofBand = WEEK_ORDER.flatMap((wd) => rows.filter((r) => r.weekday === wd && r.band === band));
    const usual = mostFrequent(ofBand, (r) => `${r.open}-${r.close}`);
    if (!usual) continue;
    bands.push({ band, open: usual.open, close: usual.close });
    const same = ofBand.filter((r) => r.open === usual.open && r.close === usual.close && r.reception);
    const rec = mostFrequent(same, (r) => r.reception as string);
    if (rec) {
      reception.push({ band, time: rec.reception as string });
      for (const r of same) diffs.push(toMin(r.close) - toMin(r.reception as string));
    }
  }
  const usualOf = (band: BandCode) => bands.find((b) => b.band === band);
  return {
    bands,
    cell: (weekday, band) => {
      const row = rows.find((r) => r.weekday === weekday && r.band === band);
      const usual = usualOf(band);
      if (!row || !usual) return { kind: "closed" };
      return row.open === usual.open && row.close === usual.close ? { kind: "usual" } : { kind: "own", open: row.open, close: row.close };
    },
    reception: reception.length ? { items: reception, minutesBefore: diffs.length && diffs.every((d) => d === diffs[0]) ? diffs[0] : null } : null,
  };
}
