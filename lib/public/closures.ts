// P10 items 10, 10-1 … 10-3 (Q4): closed days and special openings from today to the same day two months later.
import { dbDate, toIsoDate } from "@/lib/datetime";
import type { Lang } from "@/lib/i18n";
import { formatDateShort } from "@/lib/i18n/format";
import { label, type LabelKey } from "@/lib/i18n/labels";
import { joinBands, type CalendarKind, type OpenBand } from "./hours";
import { pick } from "./text";

/** the same day N calendar months later; a day the month does not have gives its last day (Dec 31 + 2 → Feb 28/29) */
export function addMonths(isoDate: string, months: number) {
  const d = dbDate(isoDate);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return toIsoDate(d);
}

export type ClosureCalendar = {
  date: string; kind: CalendarKind; amOpen: string | null; amClose: string | null; pmOpen: string | null; pmClose: string | null;
  noteJa: string | null; noteEn: string | null; noteVi: string | null;
};
export type ClosureHoliday = { date: string; nameJa: string; nameEn: string | null; nameVi: string | null };
export type ClosureRow = { date: string; dateText: string; badge: string; kind: "closed" | "special"; content: string };

/** ja 10月25日(日) with 「・祝」 inside the parenthesis for an active holiday; en / vi: the short style + a holiday mark */
export function closureDate(isoDate: string, holiday: boolean, lang: Lang) {
  const short = formatDateShort(isoDate, lang);
  if (!holiday) return short;
  return lang === "ja" ? short.replace(/\)$/, `・${label("holidayMark", lang)})`) : `${short} (${label("holidayMark", lang)})`;
}

export function buildClosures(o: { from: string; to: string; calendar: ClosureCalendar[]; holidays: ClosureHoliday[]; lang: Lang }): ClosureRow[] {
  const { lang } = o;
  const dates = [...new Set([...o.calendar.map((c) => c.date), ...o.holidays.map((h) => h.date)])]
    .filter((d) => d >= o.from && d <= o.to)
    .sort();
  return dates.map((date) => {
    const cal = o.calendar.find((c) => c.date === date);
    const hol = o.holidays.find((h) => h.date === date);
    const dateText = closureDate(date, !!hol, lang);
    if (!cal) {
      const h = hol as ClosureHoliday;
      return { date, dateText, badge: label("badgeHoliday", lang), kind: "closed", content: pick(lang, h.nameJa, h.nameEn, h.nameVi) };
    }
    const note = pick(lang, cal.noteJa ?? "", cal.noteEn, cal.noteVi).trim();
    if (cal.kind === "SPECIAL_OPEN") {
      const bands: OpenBand[] = [];
      if (cal.amOpen && cal.amClose) bands.push({ band: "AM", open: cal.amOpen, close: cal.amClose });
      if (cal.pmOpen && cal.pmClose) bands.push({ band: "PM", open: cal.pmOpen, close: cal.pmClose });
      return { date, dateText, badge: label("badgeSpecial", lang), kind: "special", content: [joinBands(bands, lang), note].filter(Boolean).join(" ") };
    }
    const badge = { CLOSED: "badgeClosed", PM_CLOSED: "badgeAmOnly", AM_CLOSED: "badgePmOnly" }[cal.kind] as LabelKey;
    const fallback = { CLOSED: "", PM_CLOSED: label("notePmClosed", lang), AM_CLOSED: label("noteAmClosed", lang) }[cal.kind];
    return { date, dateText, badge: label(badge, lang), kind: "closed", content: note || fallback };
  });
}

export const closureRange = (today: string) => ({ from: today, to: addMonths(today, 2) });
