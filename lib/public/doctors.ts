// spec-screen: P08
// Doctor search (抽出1–4) and the query string of P08. Data is small (a group of 2–3 clinics): the doctors are read
// once and filtered / paged here, because the keyword is matched on NFKC / kana-folded text that SQL cannot do.
import { prisma } from "@/lib/prisma";
import { dbDate, todayJst } from "@/lib/datetime";
import type { Lang } from "@/lib/i18n";
import { KEYWORD_MAX, keywordWords, matchesKeyword, trimKeyword } from "./keyword";
import { doctorName, nameOf, sortLanguageCodes, titleLabel, type DoctorTitleCode } from "./text";
import { activeClinics } from "./clinics";

export const PAGE_SIZE = 12;

export type DoctorQuery = { keyword: string; clinic: string; department: string; language: string; page: number };
export const EMPTY_QUERY: DoctorQuery = { keyword: "", clinic: "", department: "", language: "", page: 1 };

type Raw = Record<string, string | string[] | undefined>;
export type Options = Awaited<ReturnType<typeof loadOptions>>;

/** 抽出2–4: active clinics, active departments (with the clinics offering each, in clinic_departments order) and the language codes of active doctors */
export async function loadOptions(lang: Lang) {
  const [clinics, departments, links, doctors] = await Promise.all([
    activeClinics(),
    prisma.department.findMany({ where: { isActive: true }, orderBy: [{ displayOrder: "asc" }, { code: "asc" }] }),
    prisma.clinicDepartment.findMany({ orderBy: [{ displayOrder: "asc" }] }),
    prisma.doctor.findMany({ where: { isActive: true }, select: { languages: true } }),
  ]);
  const clinicCode = new Map(clinics.map((c) => [c.id, c.code]));
  const orderIn = new Map<string, Map<string, number>>(); // clinic code → department id → clinic_departments.display_order
  for (const l of links) {
    const code = clinicCode.get(l.clinicId);
    if (code) orderIn.set(code, (orderIn.get(code) ?? new Map()).set(l.departmentId, l.displayOrder));
  }
  return {
    clinics: clinics.map((c) => ({ code: c.code, name: nameOf(c, lang) })),
    /** `clinicOrder`: clinic code → position in that clinic's department list (item 3 order when a clinic is chosen) */
    departments: departments.map((d) => ({
      code: d.code,
      name: nameOf(d, lang),
      clinicOrder: Object.fromEntries([...orderIn].filter(([, m]) => m.has(d.id)).map(([c, m]) => [c, m.get(d.id) as number])),
    })),
    languages: sortLanguageCodes(doctors.flatMap((d) => d.languages)),
  };
}

/** The departments the select offers for a clinic (all when none; event 3, Q13 order) */
export function departmentsFor(options: Options, clinic: string) {
  if (!clinic) return options.departments;
  return options.departments
    .filter((d) => clinic in d.clinicOrder)
    .sort((a, b) => a.clinicOrder[clinic] - b.clinicOrder[clinic]);
}

/**
 * The server re-check of 4.2 rows 3–5: null = ER-02 (keyword over 50 characters, a code that is no option, `page` not a positive integer,
 * a parameter given twice). A department that is active but not offered by the chosen clinic is accepted (it only narrows the result; Q-014).
 */
export function parseDoctorQuery(raw: Raw, options: Options): DoctorQuery | null {
  for (const k of Object.keys(raw)) if (Array.isArray(raw[k])) return null;
  const str = (k: string) => raw[k] as string | undefined;
  const keyword = trimKeyword(str("keyword") ?? "");
  if (Array.from(keyword).length > KEYWORD_MAX) return null;
  const code = (k: string, valid: string[]) => {
    const v = str(k);
    return v === undefined ? "" : valid.includes(v) ? v : null;
  };
  const clinic = code("clinic", options.clinics.map((c) => c.code));
  const department = code("department", options.departments.map((d) => d.code));
  const language = code("language", options.languages);
  if (clinic === null || department === null || language === null) return null;
  const p = str("page");
  if (p !== undefined && !/^[1-9]\d{0,8}$/.test(p)) return null;
  return { keyword, clinic, department, language, page: p === undefined ? 1 : Number(p) };
}

/** query string of a state: parameters left out when empty / すべて / page 1 (event 2 table) */
export function doctorQueryString(q: Partial<DoctorQuery>) {
  const sp = new URLSearchParams();
  if (q.keyword) sp.set("keyword", q.keyword);
  if (q.clinic) sp.set("clinic", q.clinic);
  if (q.department) sp.set("department", q.department);
  if (q.language) sp.set("language", q.language);
  if (q.page && q.page > 1) sp.set("page", String(q.page));
  return sp.toString();
}

/** 抽出1. A page beyond the last page shows the last page (Q5 reading A, 質疑 Q-012). */
export async function searchDoctors(q: DoctorQuery, lang: Lang, now = new Date()) {
  const day = dbDate(todayJst(now));
  const [rows, clinicDoctorIds] = await Promise.all([
    prisma.doctor.findMany({
      where: {
        isActive: true,
        ...(q.language ? { languages: { has: q.language } } : {}),
        ...(q.department ? { departments: { some: { department: { code: q.department, isActive: true } } } } : {}),
      },
      include: { departments: { include: { department: true } }, primaryClinic: true },
      orderBy: [{ displayOrder: "asc" }, { familyNameKana: "asc" }, { givenNameKana: "asc" }, { code: "asc" }],
    }),
    q.clinic
      ? prisma.doctorShiftPattern
          .findMany({
            where: { clinic: { code: q.clinic }, OR: [{ validTo: null }, { validTo: { gte: day } }] },
            select: { doctorId: true },
          })
          .then((r) => new Set(r.map((x) => x.doctorId)))
      : Promise.resolve(null),
  ]);
  const words = keywordWords(q.keyword);
  const hits = rows.filter((d) => {
    if (clinicDoctorIds && !clinicDoctorIds.has(d.id)) return false;
    if (!words.length) return true;
    const depts = d.departments.map((x) => x.department).filter((x) => x.isActive);
    return matchesKeyword(words, [
      d.familyName, d.givenName, d.familyNameKana, d.givenNameKana, d.nameRomaji,
      ...depts.flatMap((x) => [x.nameJa, x.nameKana, x.nameEn, x.nameVi]),
    ]);
  });
  const total = hits.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(q.page, pages);
  return {
    total,
    pages,
    page,
    from: (page - 1) * PAGE_SIZE + 1,
    to: Math.min(page * PAGE_SIZE, total),
    cards: hits.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((d) => ({
      id: d.id,
      name: doctorName(d, lang),
      title: titleLabel(d.title as DoctorTitleCode, lang),
      photoUrl: d.photoUrl,
      departments: d.departments
        .map((x) => x.department)
        .filter((x) => x.isActive)
        .sort((a, b) => a.displayOrder - b.displayOrder || (a.code < b.code ? -1 : 1))
        .map((x) => nameOf(x, lang)),
      clinic: nameOf(d.primaryClinic, lang),
      languages: sortLanguageCodes(d.languages),
    })),
  };
}
