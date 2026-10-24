// spec-screen: P01
// Data of the top page (抽出1–3), assembled for the page. The page only draws it.
import { todayJst } from "@/lib/datetime";
import { getSettings } from "@/lib/frame/data";
import { parseJstSetting } from "@/lib/frame/settings";
import { t, type Lang } from "@/lib/i18n";
import { formatDateTime } from "@/lib/i18n/format";
import { activeClinics, departmentsByClinic, pinOf, todayBands } from "./clinics";
import { joinBands } from "./hours";
import { clinicAddress, nameOf, pick } from "./text";

const WEEK_MS = 7 * 24 * 3600 * 1000;

/** 抽出3 / item 1: PI093 text while now is in [maintenance_from − 7 × 24 h, maintenance_to] (Q2 a: exact instant); a key empty or not a date → null (Q2 b) */
export function maintenanceNotice(settings: Record<string, string>, lang: Lang, now = new Date()) {
  const from = parseJstSetting(settings.maintenance_from);
  const to = parseJstSetting(settings.maintenance_to);
  if (!from || !to) return null;
  if (now.getTime() < from.getTime() - WEEK_MS || now > to) return null;
  const start = formatDateTime(from, lang);
  const end = formatDateTime(to, lang);
  // Q1 = A: full date and time for both ends; PI093 names the params 開始日時 / 終了日時 in ja, start / end in en / vi
  return t("PI093", lang, { 開始日時: start, 終了日時: end, start, end });
}

export async function loadHome(lang: Lang, now = new Date()) {
  const [clinics, settings] = await Promise.all([activeClinics(), getSettings()]);
  const ids = clinics.map((c) => c.id);
  const [bands, depts] = await Promise.all([todayBands(ids, todayJst(now)), departmentsByClinic(ids)]);
  return {
    maintenance: maintenanceNotice(settings, lang, now),
    // Q3: shown while the text is not empty; en / vi empty → ja; line breaks become spaces
    notices: clinics
      .map((c) => ({ code: c.code, name: nameOf(c, lang), text: pick(lang, c.noticeJa ?? "", c.noticeEn, c.noticeVi).replace(/\s*[\r\n]+\s*/g, " ").trim() }))
      .filter((n) => n.text),
    cards: clinics.map((c) => {
      const open = bands.get(c.id) ?? [];
      return {
        code: c.code,
        name: nameOf(c, lang),
        address: clinicAddress(c, lang),
        phone: c.phone,
        todayText: open.length ? joinBands(open, lang) : null,
        departments: (depts.get(c.id) ?? []).map((d) => nameOf(d, lang)),
        pin: pinOf(c),
      };
    }),
  };
}
