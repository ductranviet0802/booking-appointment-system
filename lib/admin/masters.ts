// spec-screen: A03
// A03 医師・診療科・診療区分マスタ: the reads (抽出2-8), the saves (更新1-3, event 5), 有効/無効 (更新4, events 6 / 11), the
// delete (更新5, events 7 / 8) and the MASTER_UPDATE audit (更新7). Every write is one transaction with its audit rows.
import type { Prisma } from "@prisma/client";
import {
  bad, changedColumns, done, fail, fieldFail, isUniqueViolation, isUuid, masterAudit, type Actor, type Db,
} from "@/lib/admin/common";
import {
  CATEGORIES, KINDS, languagesOf, TITLES, toInt, validateDepartment, validateDoctor, validateVisitType,
  type DepartmentValues, type DoctorValues, type Kind, type VisitTypeValues,
} from "@/lib/admin/masters-rules";
import { fileOfUrl, photoExists } from "@/lib/admin/photo-store";
import type { Result } from "@/lib/auth/service";
import { fullWidthSpaces } from "@/lib/auth/validate";
import { dbDate, todayJst } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";

// ── what the screen reads ──────────────────────────────────────────────────────────────────────────────────────────

export type DoctorRow = { id: string; code: string; familyName: string; givenName: string; title: string; clinicName: string; displayOrder: number; isActive: boolean };
export type DepartmentRow = { id: string; code: string; nameJa: string; displayOrder: number; isActive: boolean; clinicNames: string[] };
export type VisitTypeRow = {
  id: string; code: string; nameJa: string; departmentName: string; category: string; priceYen: number | null;
  webBookable: boolean; displayOrder: number; isActive: boolean;
};
export type MasterLists = {
  doctors: DoctorRow[]; departments: DepartmentRow[]; visitTypes: VisitTypeRow[];
  choices: {
    /** every department, in display order (11 shows the active ones and the linked ones) */
    departments: { id: string; nameJa: string; isActive: boolean }[];
    /** active clinics (12, 21) */
    clinics: { id: string; nameJa: string }[];
    /** departments offered at the session clinic, by clinic_departments.display_order (24) */
    offeredDepartmentIds: string[];
    frameMinutes: number;
    clinicId: string;
  };
};
export type DoctorDetail = DoctorValues & { id: string; isActive: boolean; hasAccount: boolean };
export type DepartmentDetail = DepartmentValues & { id: string; isActive: boolean; links: { clinicId: string; displayOrder: number }[] };
export type VisitTypeDetail = VisitTypeValues & { id: string; isActive: boolean };
export type MasterDetail = DoctorDetail | DepartmentDetail | VisitTypeDetail;

export async function loadLists(clinicId: string): Promise<MasterLists> {
  const [doctors, departments, visitTypes, clinics, policy] = await Promise.all([
    prisma.doctor.findMany({ include: { primaryClinic: { select: { nameJa: true } } }, orderBy: [{ displayOrder: "asc" }, { code: "asc" }] }),
    prisma.department.findMany({
      include: { clinicDepartments: { include: { clinic: { select: { nameJa: true, displayOrder: true } } } } },
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
    }),
    prisma.visitType.findMany({ where: { clinicId }, include: { department: { select: { nameJa: true, displayOrder: true } } } }),
    prisma.clinic.findMany({ where: { isActive: true }, orderBy: { displayOrder: "asc" } }),
    prisma.bookingPolicy.findUnique({ where: { clinicId } }),
  ]);
  const offered = await prisma.clinicDepartment.findMany({ where: { clinicId }, orderBy: { displayOrder: "asc" } });
  return {
    doctors: doctors.map((d) => ({
      id: d.id, code: d.code, familyName: d.familyName, givenName: d.givenName, title: d.title, clinicName: d.primaryClinic.nameJa,
      displayOrder: d.displayOrder, isActive: d.isActive,
    })),
    departments: departments.map((d) => ({
      id: d.id, code: d.code, nameJa: d.nameJa, displayOrder: d.displayOrder, isActive: d.isActive,
      clinicNames: d.clinicDepartments.sort((x, y) => x.clinic.displayOrder - y.clinic.displayOrder).map((c) => c.clinic.nameJa),
    })),
    visitTypes: visitTypes
      .sort((x, y) => x.department.displayOrder - y.department.displayOrder || x.displayOrder - y.displayOrder || (x.code < y.code ? -1 : x.code > y.code ? 1 : 0))
      .map((v) => ({
        id: v.id, code: v.code, nameJa: v.nameJa, departmentName: v.department.nameJa, category: v.category, priceYen: v.priceYen,
        webBookable: v.webBookable, displayOrder: v.displayOrder, isActive: v.isActive,
      })),
    choices: {
      departments: departments.map((d) => ({ id: d.id, nameJa: d.nameJa, isActive: d.isActive })),
      clinics: clinics.map((c) => ({ id: c.id, nameJa: c.nameJa })),
      offeredDepartmentIds: offered.map((o) => o.departmentId),
      frameMinutes: policy?.frameMinutes ?? 15,
      clinicId,
    },
  };
}

const nz = (v: string | null) => v ?? "";

/** 抽出3 / 5 / 7: one record for the form; null = no such record (a visit type of another clinic included) */
export async function loadDetail(kind: Kind, id: string, clinicId: string): Promise<MasterDetail | null> {
  if (!isUuid(id)) return null;
  if (kind === "doctor") {
    const d = await prisma.doctor.findUnique({ where: { id }, include: { departments: true } });
    if (!d) return null;
    return {
      id: d.id, isActive: d.isActive, hasAccount: d.accountId !== null, code: d.code, familyName: d.familyName, givenName: d.givenName,
      familyNameKana: d.familyNameKana, givenNameKana: d.givenNameKana, nameRomaji: d.nameRomaji, title: d.title, photoUrl: d.photoUrl,
      departmentIds: d.departments.map((x) => x.departmentId), primaryClinicId: d.primaryClinicId,
      langJa: d.languages.includes("ja"), langEn: d.languages.includes("en"), langVi: d.languages.includes("vi"),
      langOther: d.languages.find((l) => !["ja", "en", "vi"].includes(l)) ?? "",
      profileJa: d.profileJa, profileEn: nz(d.profileEn), profileVi: nz(d.profileVi),
      qualJa: nz(d.qualificationsJa), qualEn: nz(d.qualificationsEn), qualVi: nz(d.qualificationsVi), displayOrder: String(d.displayOrder),
    };
  }
  if (kind === "department") {
    const d = await prisma.department.findUnique({ where: { id }, include: { clinicDepartments: true } });
    if (!d) return null;
    const mine = d.clinicDepartments.find((c) => c.clinicId === clinicId);
    return {
      id: d.id, isActive: d.isActive, code: d.code, nameJa: d.nameJa, nameEn: nz(d.nameEn), nameVi: nz(d.nameVi), nameKana: d.nameKana,
      displayOrder: String(d.displayOrder), offered: !!mine, clinicOrder: mine ? String(mine.displayOrder) : "",
      links: d.clinicDepartments.map((c) => ({ clinicId: c.clinicId, displayOrder: c.displayOrder })),
    };
  }
  const v = await prisma.visitType.findFirst({ where: { id, clinicId } });
  if (!v) return null;
  return {
    id: v.id, isActive: v.isActive, departmentId: v.departmentId, code: v.code, category: v.category, nameJa: v.nameJa,
    nameEn: nz(v.nameEn), nameVi: nz(v.nameVi), durationFrames: String(v.durationFrames), priceYen: v.priceYen === null ? "" : String(v.priceYen),
    webBookable: v.webBookable, noticeJa: nz(v.noticeJa), noticeEn: nz(v.noticeEn), noticeVi: nz(v.noticeVi), displayOrder: String(v.displayOrder),
  };
}

// ── the audit column lists (更新7: INSERT and DELETE name every column of the row, UPDATE the changed ones; DELETE vs Q13 (a): 質疑 Q-014) ──

const T = ["created_at", "updated_at"];
const DOCTOR_COLS = [
  "id", "code", "family_name", "given_name", "family_name_kana", "given_name_kana", "name_romaji", "title", "photo_url", "profile_ja",
  "profile_en", "profile_vi", "qualifications_ja", "qualifications_en", "qualifications_vi", "languages", "primary_clinic_id",
  "account_id", "display_order", "is_active", ...T,
];
const DEPARTMENT_COLS = ["id", "code", "name_ja", "name_en", "name_vi", "name_kana", "display_order", "is_active", ...T];
const VISIT_TYPE_COLS = [
  "id", "clinic_id", "department_id", "code", "category", "name_ja", "name_en", "name_vi", "duration_frames", "price_yen", "web_bookable",
  "questionnaire_required", "notice_ja", "notice_en", "notice_vi", "display_order", "is_active", ...T,
];
const DOCTOR_DEPARTMENT_COLS = ["doctor_id", "department_id", ...T];
const CLINIC_DEPARTMENT_COLS = ["clinic_id", "department_id", "display_order", ...T];

const DOCTOR_NAMES = {
  code: "code", familyName: "family_name", givenName: "given_name", familyNameKana: "family_name_kana", givenNameKana: "given_name_kana",
  nameRomaji: "name_romaji", title: "title", photoUrl: "photo_url", profileJa: "profile_ja", profileEn: "profile_en", profileVi: "profile_vi",
  qualificationsJa: "qualifications_ja", qualificationsEn: "qualifications_en", qualificationsVi: "qualifications_vi",
  languages: "languages", primaryClinicId: "primary_clinic_id", displayOrder: "display_order",
};
const DEPARTMENT_NAMES = {
  nameJa: "name_ja", nameEn: "name_en", nameVi: "name_vi", nameKana: "name_kana", displayOrder: "display_order",
};
const VISIT_TYPE_NAMES = {
  departmentId: "department_id", code: "code", category: "category", nameJa: "name_ja", nameEn: "name_en", nameVi: "name_vi",
  durationFrames: "duration_frames", priceYen: "price_yen", webBookable: "web_bookable", questionnaireRequired: "questionnaire_required",
  noticeJa: "notice_ja", noticeEn: "notice_en", noticeVi: "notice_vi", displayOrder: "display_order",
};

// ── reading the request ────────────────────────────────────────────────────────────────────────────────────────────

/** a value the UI cannot produce (wrong type, option outside the offered ones, unknown id) → ER-02 (SE090), nothing written */
class Tampered extends Error {}
const must = (ok: boolean) => {
  if (!ok) throw new Tampered();
};
const text = (b: Record<string, unknown>, k: string) => {
  const v = b[k] ?? "";
  must(typeof v === "string");
  return v as string;
};
const flag = (b: Record<string, unknown>, k: string) => {
  must(typeof b[k] === "boolean");
  return b[k] as boolean;
};
const optId = (b: Record<string, unknown>, k: string) => {
  const v = b[k];
  if (v === undefined || v === null) return null;
  must(isUuid(v));
  return v as string;
};
const empty = (v: string) => (v.trim() === "" ? null : v.trim());

/** runs a write; Tampered → 400 SE090, a UNIQUE violation at write time (race) → SE051 under `uniqueField` */
async function guarded(uniqueField: string, run: () => Promise<Result>): Promise<Result> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof Tampered) return bad();
    if (isUniqueViolation(e)) return fieldFail([{ field: uniqueField, code: "SE051" }]);
    throw e;
  }
}

/** 抽出11: a current shift pattern (valid_to null or today and later) uses the link */
const usedByShift = (tx: Db, where: Prisma.DoctorShiftPatternWhereInput, now: Date) =>
  tx.doctorShiftPattern.count({
    where: { ...where, OR: [{ validTo: null }, { validTo: { gte: dbDate(todayJst(now)) } }] },
  });

// ── event 5: 保存する ───────────────────────────────────────────────────────────────────────────────────────────────

export function saveDoctor(a: Actor, body: Record<string, unknown>): Promise<Result> {
  return guarded("code", async () => {
    const id = optId(body, "id");
    const ids = body.departmentIds;
    must(Array.isArray(ids) && ids.every(isUuid));
    const photo = body.photoUrl === null || body.photoUrl === undefined || body.photoUrl === "" ? null : body.photoUrl;
    const v: DoctorValues = {
      code: text(body, "code"), familyName: text(body, "familyName"), givenName: text(body, "givenName"),
      familyNameKana: text(body, "familyNameKana"), givenNameKana: text(body, "givenNameKana"), nameRomaji: text(body, "nameRomaji"),
      title: text(body, "title"), photoUrl: null, departmentIds: [...new Set(ids as string[])], primaryClinicId: text(body, "primaryClinicId"),
      langJa: flag(body, "langJa"), langEn: flag(body, "langEn"), langVi: flag(body, "langVi"), langOther: text(body, "langOther"),
      profileJa: text(body, "profileJa"), profileEn: text(body, "profileEn"), profileVi: text(body, "profileVi"),
      qualJa: text(body, "qualJa"), qualEn: text(body, "qualEn"), qualVi: text(body, "qualVi"), displayOrder: text(body, "displayOrder"),
    };
    must(v.title === "" || (TITLES as readonly string[]).includes(v.title));
    if (photo !== null) {
      const file = fileOfUrl(photo);
      must(file !== null && (await photoExists(file)));
      v.photoUrl = photo as string;
    }

    const before = id ? await prisma.doctor.findUnique({ where: { id }, include: { departments: true } }) : null;
    must(!id || before !== null);
    const linked = before?.departments.map((d) => d.departmentId) ?? [];
    if (v.departmentIds.length > 0) {
      const found = await prisma.department.findMany({ where: { id: { in: v.departmentIds } } });
      must(found.length === v.departmentIds.length && found.every((d) => d.isActive || linked.includes(d.id)));
    }
    if (v.primaryClinicId) must((await prisma.clinic.count({ where: { id: v.primaryClinicId, isActive: true } })) === 1);

    const errors = validateDoctor(v);
    if (errors.length > 0) return fieldFail(errors);

    const data = {
      code: v.code.trim(), familyName: v.familyName.trim(), givenName: v.givenName.trim(), familyNameKana: fullWidthSpaces(v.familyNameKana.trim()),
      givenNameKana: fullWidthSpaces(v.givenNameKana.trim()), nameRomaji: v.nameRomaji.trim(), title: v.title as (typeof TITLES)[number], photoUrl: v.photoUrl,
      profileJa: v.profileJa.trim(), profileEn: empty(v.profileEn), profileVi: empty(v.profileVi),
      qualificationsJa: empty(v.qualJa), qualificationsEn: empty(v.qualEn), qualificationsVi: empty(v.qualVi),
      languages: languagesOf(v), primaryClinicId: v.primaryClinicId, displayOrder: toInt(v.displayOrder),
    };
    if (await prisma.doctor.count({ where: { code: data.code, ...(id && { id: { not: id } }) } })) {
      return fieldFail([{ field: "code", code: "SE051" }]);
    }
    const added = v.departmentIds.filter((d) => !linked.includes(d));
    const removed = linked.filter((d) => !v.departmentIds.includes(d));
    return prisma.$transaction(async (tx) => {
      if (id && removed.length > 0 && (await usedByShift(tx, { doctorId: id, departmentId: { in: removed } }, a.now)) > 0) {
        return fieldFail([{ field: "departmentIds", code: "SE054" }]);
      }
      if (!before) {
        const created = await tx.doctor.create({ data: { ...data, isActive: true } });
        await tx.doctorDepartment.createMany({ data: added.map((departmentId) => ({ doctorId: created.id, departmentId })) });
        await masterAudit(tx, a, "doctors", created.id, DOCTOR_COLS);
        await masterAudit(tx, a, "doctor_departments", created.id, added.length > 0 ? DOCTOR_DEPARTMENT_COLS : []);
        return done({ id: created.id });
      }
      const changed = changedColumns(DOCTOR_NAMES, before, data);
      if (changed.length > 0) await tx.doctor.update({ where: { id: before.id }, data });
      if (removed.length > 0) await tx.doctorDepartment.deleteMany({ where: { doctorId: before.id, departmentId: { in: removed } } });
      if (added.length > 0) await tx.doctorDepartment.createMany({ data: added.map((departmentId) => ({ doctorId: before.id, departmentId })) });
      await masterAudit(tx, a, "doctors", before.id, changed);
      await masterAudit(tx, a, "doctor_departments", before.id, added.length + removed.length > 0 ? DOCTOR_DEPARTMENT_COLS : []);
      return done({ id: before.id });
    });
  });
}

export function saveDepartment(a: Actor, body: Record<string, unknown>): Promise<Result> {
  return guarded("code", async () => {
    const id = optId(body, "id");
    const v: DepartmentValues = {
      code: text(body, "code"), nameJa: text(body, "nameJa"), nameEn: text(body, "nameEn"), nameVi: text(body, "nameVi"),
      nameKana: text(body, "nameKana"), displayOrder: text(body, "displayOrder"), offered: flag(body, "offered"), clinicOrder: text(body, "clinicOrder"),
    };
    const before = id ? await prisma.department.findUnique({ where: { id }, include: { clinicDepartments: { where: { clinicId: a.clinicId } } } }) : null;
    must(!id || before !== null);
    const errors = validateDepartment(v, !before);
    if (errors.length > 0) return fieldFail(errors);

    const data = {
      nameJa: v.nameJa.trim(), nameEn: empty(v.nameEn), nameVi: empty(v.nameVi), nameKana: fullWidthSpaces(v.nameKana.trim()), displayOrder: toInt(v.displayOrder),
    };
    const code = v.code.trim();
    if (!before && (await prisma.department.count({ where: { code } }))) return fieldFail([{ field: "code", code: "SE051" }]);
    const link = before?.clinicDepartments[0] ?? null;
    const order = v.offered ? toInt(v.clinicOrder) : 0;
    return prisma.$transaction(async (tx) => {
      if (before && link && !v.offered && (await usedByShift(tx, { clinicId: a.clinicId, departmentId: before.id }, a.now)) > 0) {
        return fieldFail([{ field: "offered", code: "SE054" }]);
      }
      let deptId: string;
      if (!before) {
        deptId = (await tx.department.create({ data: { ...data, code, isActive: true } })).id;
        await masterAudit(tx, a, "departments", deptId, DEPARTMENT_COLS);
      } else {
        deptId = before.id;
        const changed = changedColumns(DEPARTMENT_NAMES, before, data);
        if (changed.length > 0) await tx.department.update({ where: { id: deptId }, data });
        await masterAudit(tx, a, "departments", deptId, changed);
      }
      const where = { clinicId_departmentId: { clinicId: a.clinicId, departmentId: deptId } };
      if (v.offered && !link) {
        await tx.clinicDepartment.create({ data: { clinicId: a.clinicId, departmentId: deptId, displayOrder: order } });
        await masterAudit(tx, a, "clinic_departments", deptId, CLINIC_DEPARTMENT_COLS);
      } else if (v.offered && link && link.displayOrder !== order) {
        await tx.clinicDepartment.update({ where, data: { displayOrder: order } });
        await masterAudit(tx, a, "clinic_departments", deptId, ["display_order"]);
      } else if (!v.offered && link) {
        await tx.clinicDepartment.delete({ where });
        await masterAudit(tx, a, "clinic_departments", deptId, CLINIC_DEPARTMENT_COLS);
      }
      return done({ id: deptId });
    });
  });
}

export function saveVisitType(a: Actor, body: Record<string, unknown>): Promise<Result> {
  return guarded("code", async () => {
    const id = optId(body, "id");
    const v: VisitTypeValues = {
      departmentId: text(body, "departmentId"), code: text(body, "code"), category: text(body, "category"), nameJa: text(body, "nameJa"),
      nameEn: text(body, "nameEn"), nameVi: text(body, "nameVi"), durationFrames: text(body, "durationFrames"), priceYen: text(body, "priceYen"),
      webBookable: flag(body, "webBookable"), noticeJa: text(body, "noticeJa"), noticeEn: text(body, "noticeEn"), noticeVi: text(body, "noticeVi"),
      displayOrder: text(body, "displayOrder"),
    };
    must(v.category === "" || (CATEGORIES as readonly string[]).includes(v.category));
    const before = id ? await prisma.visitType.findFirst({ where: { id, clinicId: a.clinicId } }) : null;
    must(!id || before !== null);
    if (v.departmentId) {
      must(isUuid(v.departmentId));
      const offered = await prisma.clinicDepartment.count({ where: { clinicId: a.clinicId, departmentId: v.departmentId, department: { isActive: true } } });
      must(offered === 1 || before?.departmentId === v.departmentId);
    }
    const errors = validateVisitType(v, true);
    if (errors.length > 0) return fieldFail(errors);

    const code = v.code.trim();
    if (await prisma.visitType.count({ where: { clinicId: a.clinicId, code, ...(id && { id: { not: id } }) } })) {
      return fieldFail([{ field: "code", code: "SE051" }]);
    }
    const data = {
      departmentId: v.departmentId, code, category: v.category as (typeof CATEGORIES)[number], nameJa: v.nameJa.trim(), nameEn: empty(v.nameEn),
      nameVi: empty(v.nameVi), durationFrames: toInt(v.durationFrames), priceYen: v.category === "SELF_PAY" ? toInt(v.priceYen) : null,
      webBookable: v.webBookable, questionnaireRequired: v.category === "FIRST", noticeJa: empty(v.noticeJa), noticeEn: empty(v.noticeEn),
      noticeVi: empty(v.noticeVi), displayOrder: toInt(v.displayOrder),
    };
    return prisma.$transaction(async (tx) => {
      if (!before) {
        const created = await tx.visitType.create({ data: { ...data, clinicId: a.clinicId, isActive: true } });
        await masterAudit(tx, a, "visit_types", created.id, VISIT_TYPE_COLS);
        return done({ id: created.id });
      }
      const changed = changedColumns(VISIT_TYPE_NAMES, before, data);
      if (changed.length > 0) await tx.visitType.update({ where: { id: before.id }, data });
      await masterAudit(tx, a, "visit_types", before.id, changed);
      return done({ id: before.id });
    });
  });
}

// ── events 6 / 11: 無効化する / 有効化する (更新4) ─────────────────────────────────────────────────────────────────────

const TABLE: Record<Kind, string> = { doctor: "doctors", department: "departments", visitType: "visit_types" };

function kindAndId(body: Record<string, unknown>): { kind: Kind; id: string } | null {
  const { kind, id } = body;
  return typeof kind === "string" && (KINDS as readonly string[]).includes(kind) && isUuid(id) ? { kind: kind as Kind, id } : null;
}

/** the record exists (a visit type: at the session clinic) */
async function exists(tx: Db, a: Actor, kind: Kind, id: string) {
  if (kind === "doctor") return (await tx.doctor.count({ where: { id } })) === 1;
  if (kind === "department") return (await tx.department.count({ where: { id } })) === 1;
  return (await tx.visitType.count({ where: { id, clinicId: a.clinicId } })) === 1;
}

export async function setActive(a: Actor, body: Record<string, unknown>): Promise<Result> {
  const target = kindAndId(body);
  if (!target || typeof body.active !== "boolean") return bad();
  const { kind, id } = target;
  const active = body.active;
  return prisma.$transaction(async (tx) => {
    if (!(await exists(tx, a, kind, id))) return bad();
    const where = { id, isActive: !active };
    const n = kind === "doctor"
      ? (await tx.doctor.updateMany({ where, data: { isActive: active } })).count
      : kind === "department"
        ? (await tx.department.updateMany({ where, data: { isActive: active } })).count
        : (await tx.visitType.updateMany({ where: { ...where, clinicId: a.clinicId }, data: { isActive: active } })).count;
    // already in that state (Q15 d): nothing written, the screen reloads
    if (n === 0) return done({ unchanged: true });
    await masterAudit(tx, a, TABLE[kind], id, ["is_active"]);
    return done();
  });
}

// ── events 7 / 8: 削除する (抽出9, 更新5) ───────────────────────────────────────────────────────────────────────────────

/** 抽出9: used by a booking, a shift (pattern or exception) or a slot; a visit type by a booking only */
async function referenced(tx: Db, kind: Kind, id: string) {
  const counts = kind === "doctor"
    ? [
      tx.booking.count({ where: { doctorId: id } }), tx.doctorShiftPattern.count({ where: { doctorId: id } }),
      tx.doctorShiftException.count({ where: { OR: [{ doctorId: id }, { substituteDoctorId: id }] } }), tx.slot.count({ where: { doctorId: id } }),
    ]
    : kind === "department"
      ? [
        tx.booking.count({ where: { OR: [{ departmentId: id }, { visitType: { departmentId: id } }] } }),
        tx.doctorShiftPattern.count({ where: { departmentId: id } }), tx.doctorShiftException.count({ where: { departmentId: id } }),
        tx.slot.count({ where: { departmentId: id } }),
      ]
      : [tx.booking.count({ where: { visitTypeId: id } })];
  return (await Promise.all(counts)).some((n) => n > 0);
}

/** confirmed false = event 7 / the check before the dialog (SE050 or "may be deleted"); true = event 8 はい */
export async function deleteRecord(a: Actor, body: Record<string, unknown>): Promise<Result> {
  const target = kindAndId(body);
  if (!target || typeof body.confirmed !== "boolean") return bad();
  const { kind, id } = target;
  return prisma.$transaction(async (tx) => {
    if (!(await exists(tx, a, kind, id))) return bad();
    if (await referenced(tx, kind, id)) return fail(409, "SE050");
    if (!body.confirmed) return done({ deletable: true });
    if (kind === "doctor") {
      const links = await tx.doctorDepartment.deleteMany({ where: { doctorId: id } });
      await tx.doctor.delete({ where: { id } });
      await masterAudit(tx, a, "doctors", id, DOCTOR_COLS);
      await masterAudit(tx, a, "doctor_departments", id, links.count > 0 ? DOCTOR_DEPARTMENT_COLS : []);
    } else if (kind === "department") {
      const [dd, cd, vt] = [
        await tx.doctorDepartment.deleteMany({ where: { departmentId: id } }),
        await tx.clinicDepartment.deleteMany({ where: { departmentId: id } }),
        await tx.visitType.deleteMany({ where: { departmentId: id } }),
      ];
      await tx.department.delete({ where: { id } });
      await masterAudit(tx, a, "departments", id, DEPARTMENT_COLS);
      await masterAudit(tx, a, "doctor_departments", id, dd.count > 0 ? DOCTOR_DEPARTMENT_COLS : []);
      await masterAudit(tx, a, "clinic_departments", id, cd.count > 0 ? CLINIC_DEPARTMENT_COLS : []);
      await masterAudit(tx, a, "visit_types", id, vt.count > 0 ? VISIT_TYPE_COLS : []);
    } else {
      await tx.visitType.delete({ where: { id } });
      await masterAudit(tx, a, "visit_types", id, VISIT_TYPE_COLS);
    }
    return done();
  });
}
