// spec-screen: P10
// Data of the clinic information screen (抽出1–6), assembled for the page. The page only draws it.
import { todayJst } from "@/lib/datetime";
import type { Lang } from "@/lib/i18n";
import { buildClosures, closureRange } from "./closures";
import {
  activeClinicByCode, activeClinics, closureSources, clinicDoctors, departmentsByClinic, hourRowsOf, todayBands,
} from "./clinics";
import { buildHoursTable, joinBands } from "./hours";
import { clinicAddress, doctorName, nameOf, pick, titleLabel } from "./text";

/** item 13-2: only these titles are written in front of the departments (Q-015 answer: 非常勤医師 not shown) */
const TITLES_SHOWN = new Set(["DIRECTOR", "VICE_DIRECTOR"]);

/** `/clinics`: with one active clinic its page opens (1-3), with none ER-01 (Q9 b), else the cards of state ① */
export async function loadClinicIndex(lang: Lang, now = new Date()) {
  const clinics = await activeClinics();
  if (clinics.length === 0) return { kind: "none" as const };
  if (clinics.length === 1) return { kind: "redirect" as const, code: clinics[0].code };
  const today = todayJst(now);
  const bands = await todayBands(clinics.map((c) => c.id), today);
  return {
    kind: "list" as const,
    cards: clinics.map((c) => {
      const open = bands.get(c.id) ?? [];
      return {
        code: c.code,
        name: nameOf(c, lang),
        // card address: no postcode (image)
        address: clinicAddress(c, lang),
        phone: c.phone,
        todayText: open.length ? joinBands(open, lang) : null,
      };
    }),
  };
}

/** `/clinics/{code}`: null → ER-01 (unknown, inactive or malformed code) */
export async function loadClinicPage(code: string, lang: Lang, now = new Date()) {
  const clinic = await activeClinicByCode(code);
  if (!clinic) return null;
  const today = todayJst(now);
  const [all, hours, sources, depts, doctors] = await Promise.all([
    activeClinics(),
    hourRowsOf([clinic.id]),
    closureSources(clinic.id, today),
    departmentsByClinic([clinic.id]),
    clinicDoctors(clinic.id, today),
  ]);
  const clinicDepts = depts.get(clinic.id) ?? [];
  const clinicDeptIds = new Set(clinicDepts.map((d) => d.id));
  return {
    clinic: {
      code: clinic.code,
      name: nameOf(clinic, lang),
      postcode: clinic.postcode,
      address: clinicAddress(clinic, lang),
      phone: clinic.phone,
      access: pick(lang, clinic.accessJa, clinic.accessEn, clinic.accessVi),
      mapUrl: clinic.mapUrl,
      notice: pick(lang, clinic.noticeJa ?? "", clinic.noticeEn, clinic.noticeVi).trim(),
    },
    // item 1: the tabs are hidden with one active clinic (Q7 a)
    tabs: all.length > 1 ? all.map((c) => ({ code: c.code, name: nameOf(c, lang) })) : [],
    hours: buildHoursTable(hours.get(clinic.id) ?? []),
    closures: buildClosures({ ...closureRange(today), ...sources, lang }),
    departments: clinicDepts.map((d) => nameOf(d, lang)),
    doctors: doctors.map((d) => {
      const own = d.departments
        .map((x) => x.department)
        .filter((x) => x.isActive && clinicDeptIds.has(x.id))
        .sort((a, b) => a.displayOrder - b.displayOrder || (a.code < b.code ? -1 : 1))
        .map((x) => nameOf(x, lang));
      // 13-2 + 13-3 in front of each other with 「・」 (image: 院長・内科)
      const sub = [...(TITLES_SHOWN.has(d.title) ? [titleLabel(d.title, lang)] : []), ...own].join("・");
      return { id: d.id, name: doctorName(d, lang), sub };
    }),
  };
}
