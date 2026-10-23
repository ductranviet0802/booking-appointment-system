// F13-04 formats. Business dates are "YYYY-MM-DD" and times "H:MM" / "HH:MM" in Asia/Tokyo (03 §0); no Intl, so the
// output does not depend on the ICU build of the runtime.
import { weekdayOf } from "@/lib/datetime";
import type { Lang } from "./index";

const WEEKDAY: Record<Lang, string[]> = {
  ja: ["日", "月", "火", "水", "木", "金", "土"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  vi: ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"],
};
const MONTH_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_EN_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(isoDate: string) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return { y, m, d, wd: weekdayOf(isoDate) };
}

/** Full style: ja 2026年10月20日(火) · en Tue, 20 Oct 2026 · vi Thứ Ba, 20/10/2026 */
export function formatDate(isoDate: string, lang: Lang) {
  const { y, m, d, wd } = parts(isoDate);
  if (lang === "ja") return `${y}年${m}月${d}日(${WEEKDAY.ja[wd]})`;
  if (lang === "en") return `${WEEKDAY.en[wd]}, ${d} ${MONTH_EN_SHORT[m - 1]} ${y}`;
  return `${WEEKDAY.vi[wd]}, ${d}/${m}/${y}`;
}

/** Short style (calendar, chosen date, sticky bar): ja 10月20日(火) · en Tue, 20 Oct · vi Thứ Ba, 20/10 */
export function formatDateShort(isoDate: string, lang: Lang) {
  const { m, d, wd } = parts(isoDate);
  if (lang === "ja") return `${m}月${d}日(${WEEKDAY.ja[wd]})`;
  if (lang === "en") return `${WEEKDAY.en[wd]}, ${d} ${MONTH_EN_SHORT[m - 1]}`;
  return `${WEEKDAY.vi[wd]}, ${d}/${m}`;
}

/** Month heading: ja 2026年10月 · en October 2026 · vi Tháng 10/2026 */
export function formatMonthHeading(year: number, month: number, lang: Lang) {
  if (lang === "ja") return `${year}年${month}月`;
  if (lang === "en") return `${MONTH_EN[month - 1]} ${year}`;
  return `Tháng ${month}/${year}`;
}

/** "09:00" → "9:00" */
export function formatTime(hhmm: string) {
  const [h, m] = hhmm.split(":");
  return `${Number(h)}:${m}`;
}

/** ja 9:00〜9:30 · en / vi 9:00–9:30 */
export function formatTimeRange(from: string, to: string, lang: Lang) {
  return `${formatTime(from)}${lang === "ja" ? "〜" : "–"}${formatTime(to)}`;
}

/** ja 4,000円 · en ¥4,000 · vi 4.000 yên */
export function formatPrice(yen: number, lang: Lang) {
  const digits = String(Math.trunc(yen));
  const group = (sep: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  if (lang === "ja") return `${group(",")}円`;
  if (lang === "en") return `¥${group(",")}`;
  return `${group(".")} yên`;
}

/** First weekday of a calendar row, 0 = Sunday: en Sunday, vi Monday (ja: Sunday first, F4-02) */
export function firstWeekday(lang: Lang) {
  return lang === "vi" ? 1 : 0;
}

/** An instant as Asia/Tokyo full date + time, e.g. ja 2026年10月21日(水) 6:00 (date inside a message text, F13-04) */
export function formatDateTime(instant: Date, lang: Lang) {
  const jst = new Date(instant.getTime() + 9 * 3600 * 1000).toISOString();
  return `${formatDate(jst.slice(0, 10), lang)} ${formatTime(jst.slice(11, 16))}`;
}
