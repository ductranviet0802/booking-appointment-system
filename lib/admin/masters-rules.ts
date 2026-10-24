// spec-screen: A03
// Input checks of A03 §4.2 (items 5-32): one module for the blur checks of the form and the server re-check of event 5.
// Pure (no database): uniqueness (SE051), the shift check (SE054) and the offered ids are the server's.
import { KATAKANA, type FieldError } from "@/lib/auth/validate";

export const TITLES = ["DIRECTOR", "VICE_DIRECTOR", "DOCTOR", "PART_TIME"] as const;
export const TITLE_LABEL: Record<string, string> = { DIRECTOR: "院長", VICE_DIRECTOR: "副院長", DOCTOR: "医師", PART_TIME: "非常勤医師" };
export const CATEGORIES = ["FIRST", "REPEAT", "SELF_PAY"] as const;
export const CATEGORY_LABEL: Record<string, string> = { FIRST: "初診", REPEAT: "再診", SELF_PAY: "自費" };

export type Kind = "doctor" | "department" | "visitType";
export const KINDS: readonly Kind[] = ["doctor", "department", "visitType"];
/** {項目} of SE051 / SW050 / SW052 */
export const KIND_LABEL: Record<Kind, string> = { doctor: "医師", department: "診療科", visitType: "診療区分" };

export type DoctorValues = {
  code: string; familyName: string; givenName: string; familyNameKana: string; givenNameKana: string; nameRomaji: string;
  title: string; photoUrl: string | null; departmentIds: string[]; primaryClinicId: string;
  langJa: boolean; langEn: boolean; langVi: boolean; langOther: string;
  profileJa: string; profileEn: string; profileVi: string; qualJa: string; qualEn: string; qualVi: string; displayOrder: string;
};
export type DepartmentValues = {
  code: string; nameJa: string; nameEn: string; nameVi: string; nameKana: string; displayOrder: string;
  /** 21-1 / 21-2 of the session clinic (the other clinics are read-only) */
  offered: boolean; clinicOrder: string;
};
export type VisitTypeValues = {
  departmentId: string; code: string; category: string; nameJa: string; nameEn: string; nameVi: string; durationFrames: string;
  priceYen: string; webBookable: boolean; noticeJa: string; noticeEn: string; noticeVi: string; displayOrder: string;
};

const CODE = /^[A-Za-z0-9_-]+$/;
const ROMAJI = /^[A-Za-z' -]+$/;
const ISO639 = /^[a-z]{2}$/;
export const FILE_NAME = /^[0-9a-f-]{36}\.(jpg|png)$/;

/** blank-only (half- and full-width spaces) counts as empty */
const blank = (v: string) => v.replace(/[\s　]/g, "") === "";

type Rule = { required?: boolean; max?: number; pattern?: RegExp };
function text(errors: FieldError[], field: string, name: string, raw: string, r: Rule) {
  const v = raw.trim();
  if (blank(v)) {
    if (r.required) errors.push({ field, code: "SE001", params: { 項目: name } });
    return;
  }
  if (r.pattern && !r.pattern.test(v)) errors.push({ field, code: "SE002", params: { 項目: name } });
  else if (r.max && v.length > r.max) errors.push({ field, code: "SE003", params: { 項目: name, n: r.max } });
}

/** half-width digits, an integer in min..max; empty → SE001 when required, anything else wrong → SE002 */
function integer(errors: FieldError[], field: string, name: string, raw: string, min: number, max: number, required = true) {
  const v = raw.trim();
  if (blank(v)) {
    if (required) errors.push({ field, code: "SE001", params: { 項目: name } });
    return;
  }
  if (!/^\d{1,10}$/.test(v) || Number(v) < min || Number(v) > max) errors.push({ field, code: "SE002", params: { 項目: name } });
}

export const toInt = (v: string) => Number(v.trim());

/** 13-1…13-4 → the array stored in doctors.languages (ja, en, vi, then the other code) */
export function languagesOf(v: Pick<DoctorValues, "langJa" | "langEn" | "langVi" | "langOther">) {
  const codes: string[] = [];
  if (v.langJa) codes.push("ja");
  if (v.langEn) codes.push("en");
  if (v.langVi) codes.push("vi");
  const other = v.langOther.trim();
  if (other && !codes.includes(other)) codes.push(other);
  return codes;
}

export function validateDoctor(v: DoctorValues): FieldError[] {
  const e: FieldError[] = [];
  text(e, "code", "医師コード", v.code, { required: true, pattern: CODE, max: 20 });
  text(e, "familyName", "姓", v.familyName, { required: true, max: 50 });
  text(e, "givenName", "名", v.givenName, { required: true, max: 50 });
  text(e, "familyNameKana", "セイ", v.familyNameKana, { required: true, pattern: KATAKANA, max: 50 });
  text(e, "givenNameKana", "メイ", v.givenNameKana, { required: true, pattern: KATAKANA, max: 50 });
  text(e, "nameRomaji", "ローマ字氏名", v.nameRomaji, { required: true, pattern: ROMAJI, max: 100 });
  if (!v.title) e.push({ field: "title", code: "SE001", params: { 項目: "役職" } });
  if (v.departmentIds.length === 0) e.push({ field: "departmentIds", code: "SE001", params: { 項目: "診療科" } });
  if (!v.primaryClinicId) e.push({ field: "primaryClinicId", code: "SE001", params: { 項目: "主な勤務クリニック" } });
  text(e, "langOther", "対応言語", v.langOther, { pattern: ISO639 });
  if (languagesOf(v).length === 0 && !e.some((x) => x.field === "langOther")) {
    e.push({ field: "languages", code: "SE001", params: { 項目: "対応言語" } });
  }
  text(e, "profileJa", "経歴", v.profileJa, { required: true });
  integer(e, "displayOrder", "表示順", v.displayOrder, 0, 32767);
  return e;
}

export function validateDepartment(v: DepartmentValues, isNew: boolean): FieldError[] {
  const e: FieldError[] = [];
  if (isNew) text(e, "code", "診療科コード", v.code, { required: true, pattern: CODE, max: 20 });
  text(e, "nameJa", "診療科名", v.nameJa, { required: true, max: 50 });
  text(e, "nameEn", "診療科名（英語）", v.nameEn, { max: 50 });
  text(e, "nameVi", "診療科名（ベトナム語）", v.nameVi, { max: 50 });
  text(e, "nameKana", "診療科名カナ", v.nameKana, { required: true, pattern: KATAKANA, max: 50 });
  if (v.offered) integer(e, "clinicOrder", "提供クリニックの表示順", v.clinicOrder, 0, 32767);
  integer(e, "displayOrder", "表示順", v.displayOrder, 0, 32767);
  return e;
}

/** `serverRules` adds the price rule SE052 (event 5 only: the UI disables 29 for 初診 / 再診, 4.2 row 51) */
export function validateVisitType(v: VisitTypeValues, serverRules: boolean): FieldError[] {
  const e: FieldError[] = [];
  if (!v.departmentId) e.push({ field: "departmentId", code: "SE001", params: { 項目: "診療科（区分）" } });
  text(e, "code", "区分コード", v.code, { required: true, pattern: CODE, max: 20 });
  if (!v.category) e.push({ field: "category", code: "SE001", params: { 項目: "区分" } });
  text(e, "nameJa", "名称", v.nameJa, { required: true, max: 50 });
  text(e, "nameEn", "名称（英語）", v.nameEn, { max: 50 });
  text(e, "nameVi", "名称（ベトナム語）", v.nameVi, { max: 50 });
  integer(e, "durationFrames", "所要枠数", v.durationFrames, 1, 8);
  const hasPrice = !blank(v.priceYen);
  if (hasPrice) integer(e, "priceYen", "料金（税込）", v.priceYen, 0, 2147483647, false);
  if (serverRules && !e.some((x) => x.field === "priceYen") && (v.category === "SELF_PAY") !== hasPrice && v.category) {
    e.push({ field: "priceYen", code: "SE052" });
  }
  integer(e, "displayOrder", "表示順", v.displayOrder, 0, 32767);
  return e;
}
