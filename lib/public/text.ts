// Master texts in the UI language (F13-06: an empty en / vi text shows ja), names, titles and language labels of the public screens.
import type { Lang } from "@/lib/i18n";
import { label, type LabelKey } from "@/lib/i18n/labels";

/** value of the UI language, ja when it is empty (null, "" or spaces only) */
export function pick(lang: Lang, ja: string, en: string | null | undefined, vi: string | null | undefined) {
  const v = lang === "en" ? en : lang === "vi" ? vi : ja;
  return v && v.trim() ? v : ja;
}

type Named = { nameJa: string; nameEn: string | null; nameVi: string | null };
export const nameOf = (m: Named, lang: Lang) => pick(lang, m.nameJa, m.nameEn, m.nameVi);

/** ja 「姓 名」, en / vi name_romaji; no title and no 様 (EV-55) */
export function doctorName(d: { familyName: string; givenName: string; nameRomaji: string }, lang: Lang) {
  return lang === "ja" ? `${d.familyName} ${d.givenName}` : d.nameRomaji;
}

export type DoctorTitleCode = "DIRECTOR" | "VICE_DIRECTOR" | "DOCTOR" | "PART_TIME";
export const titleLabel = (title: DoctorTitleCode, lang: Lang) => label(`title${title}` as LabelKey, lang);

/** ja / en / vi first in this order, then the other codes sorted (P08 Q6 A) */
export function sortLanguageCodes(codes: Iterable<string>) {
  const rank = (c: string) => ["ja", "en", "vi"].indexOf(c);
  return [...new Set(codes)].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra >= 0 || rb >= 0) return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

const OWN_NAME: Record<string, string> = { ja: "日本語", en: "English", vi: "Tiếng Việt" };
/** a language in its own language (P08 item 4, P09 item 6); other codes: the upper-case code (P08 Q6 A) */
export const languageName = (code: string) => OWN_NAME[code] ?? code.toUpperCase();

/** P10 item 4 / P01 item 8: ja 都道府県 市区町村 番地 without separators; en / vi address_en, ja address when null (P10 Q10 a) */
export function clinicAddress(c: { prefecture: string; city: string; addressLine: string; addressEn: string | null }, lang: Lang) {
  const ja = `${c.prefecture}${c.city}${c.addressLine}`;
  return lang === "ja" ? ja : c.addressEn && c.addressEn.trim() ? c.addressEn : ja;
}

/** 〒100-0005 + the address (P10 item 4, clinic page) */
export const postcodeText = (postcode: string) => `〒${postcode.slice(0, 3)}-${postcode.slice(3)}`;
