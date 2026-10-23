// spec-screen: A05
// A05 スタッフアカウント管理: the reads (抽出2-5), 作成 / 編集 (更新1, 2), パスワード発行 (更新3), 無効化 / 有効化 / ロック解除
// (更新4-6), the session revocation (更新7) and the MASTER_UPDATE audit (更新8). Password, hash and session code are the auth
// service's (lib/auth/service.ts); nothing here stores or logs a clear password.
import type { AccountStatus, Prisma } from "@prisma/client";
import { bad, changedColumns, done, fail, fieldFail, isUniqueViolation, isUuid, masterAudit, type Actor, type Db } from "@/lib/admin/common";
import { STAFF_ROLES, validateStaff, type AccountState, type StaffRole, type StaffValues } from "@/lib/admin/staff-rules";
import { hashPassword, newInitialPassword, revokeAccountSessions, type Result } from "@/lib/auth/service";
import { prisma } from "@/lib/prisma";

export type StaffRow = {
  id: string; displayName: string; email: string; role: StaffRole; state: AccountState; lockedHhmm: string | null;
  clinics: string; lastLogin: string; own: boolean;
  /** ⑧: the account has all_clinics and the viewer has not: shown as ②, no action */
  locked8: boolean;
};
export type StaffLists = {
  rows: StaffRow[];
  /** 抽出4: the clinics item 8 offers */
  clinics: { id: string; nameJa: string }[];
  /** 抽出5: active doctors without an account */
  doctors: { id: string; label: string }[];
  viewerAllClinics: boolean;
};
export type StaffDetail = StaffValues & {
  id: string; state: AccountState; lockedHhmm: string | null; own: boolean; locked8: boolean;
  linkedDoctor: { id: string; label: string } | null;
};

const CREATE_COLS = ["display_name", "email", "role", "status", "password_hash", "must_change_password", "all_clinics", "language"];
const STAFF_CLINIC_COLS = ["account_id", "clinic_id"];

function jstParts(d: Date) {
  const f = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  return Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value])) as Record<string, string>;
}
const hhmm = (d: Date) => `${jstParts(d).hour}:${jstParts(d).minute}`;
const stamp = (d: Date | null) => {
  if (!d) return "—";
  const p = jstParts(d);
  return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}`;
};

/** 4-4 / 11: 無効 > ロック中 > 初回パスワード変更待ち > 有効 */
export function stateOf(a: { status: AccountStatus; lockedUntil: Date | null; mustChangePassword: boolean }, now: Date): AccountState {
  if (a.status === "DISABLED") return "disabled";
  if (a.status === "LOCKED" || (a.lockedUntil !== null && a.lockedUntil > now)) return "locked";
  return a.mustChangePassword ? "firstChange" : "active";
}

/** 抽出1: the clinics the viewer holds (the scope of the list, Q1) */
const viewerClinicIds = async (a: Actor) =>
  (await prisma.staffClinic.findMany({ where: { accountId: a.accountId }, select: { clinicId: true } })).map((c) => c.clinicId);

/** 抽出4 */
const offeredClinics = async (a: Actor, held: string[]) =>
  prisma.clinic.findMany({
    where: { isActive: true, ...(!a.allClinics && { id: { in: held } }) }, orderBy: { displayOrder: "asc" }, select: { id: true, nameJa: true },
  });

const inScope = (a: Actor, held: string[], acc: { role: string; staffClinics: { clinicId: string }[] }) =>
  a.allClinics || acc.role === "DOCTOR" || acc.staffClinics.some((c) => held.includes(c.clinicId));

const doctorLabel = (d: { familyName: string; givenName: string }) => `${d.familyName} ${d.givenName}`;

export async function loadStaff(a: Actor): Promise<StaffLists> {
  const held = await viewerClinicIds(a);
  const [accounts, clinics, doctors] = await Promise.all([
    prisma.account.findMany({
      where: {
        role: { in: [...STAFF_ROLES] },
        ...(!a.allClinics && { OR: [{ role: "DOCTOR" }, { staffClinics: { some: { clinicId: { in: held } } } }] }),
      },
      include: { staffClinics: { include: { clinic: { select: { nameJa: true, displayOrder: true } } } } },
    }),
    offeredClinics(a, held),
    prisma.doctor.findMany({ where: { accountId: null, isActive: true }, orderBy: [{ displayOrder: "asc" }, { code: "asc" }] }),
  ]);
  const rows = accounts.map((x): StaffRow => {
    const state = stateOf(x, a.now);
    return {
      id: x.id, displayName: x.displayName ?? "", email: x.email, role: x.role as StaffRole, state,
      lockedHhmm: state === "locked" && x.lockedUntil ? hhmm(x.lockedUntil) : null,
      clinics: x.allClinics ? "全クリニック" : x.role === "DOCTOR" ? "シフトから"
        : x.staffClinics.sort((p, q) => p.clinic.displayOrder - q.clinic.displayOrder).map((c) => c.clinic.nameJa).join("・"),
      lastLogin: stamp(x.lastLoginAt), own: x.id === a.accountId, locked8: x.allClinics && !a.allClinics,
    };
  });
  // 無効 rows last, then display_name, then email (Q11 a)
  rows.sort((p, q) => Number(p.state === "disabled") - Number(q.state === "disabled") || p.displayName.localeCompare(q.displayName, "ja") || (p.email < q.email ? -1 : 1));
  return { rows, clinics, doctors: doctors.map((d) => ({ id: d.id, label: doctorLabel(d) })), viewerAllClinics: a.allClinics };
}

type Loaded = Prisma.AccountGetPayload<{ include: { staffClinics: true; doctor: true } }>;

/** the account of a request: an unknown id or a patient → SE090; outside the viewer's scope → 403 SE091 */
async function target(a: Actor, id: unknown): Promise<Loaded | Result> {
  if (!isUuid(id)) return bad();
  const acc = await prisma.account.findFirst({ where: { id, role: { in: [...STAFF_ROLES] } }, include: { staffClinics: true, doctor: true } });
  if (!acc) return bad();
  if (!inScope(a, await viewerClinicIds(a), acc)) return fail(403, "SE091");
  return acc;
}
const isResult = (v: Loaded | Result): v is Result => "ok" in v;

export async function loadStaffDetail(a: Actor, id: string): Promise<Result> {
  const acc = await target(a, id);
  if (isResult(acc)) return acc;
  const offered = (await offeredClinics(a, await viewerClinicIds(a))).map((c) => c.id);
  const state = stateOf(acc, a.now);
  const detail: StaffDetail = {
    id: acc.id, displayName: acc.displayName ?? "", email: acc.email, role: acc.role, allClinics: acc.allClinics,
    clinicIds: acc.staffClinics.map((c) => c.clinicId).filter((c) => offered.includes(c)), doctorId: acc.doctor?.id ?? "",
    state, lockedHhmm: state === "locked" && acc.lockedUntil ? hhmm(acc.lockedUntil) : null, own: acc.id === a.accountId,
    locked8: acc.allClinics && !a.allClinics, linkedDoctor: acc.doctor ? { id: acc.doctor.id, label: doctorLabel(acc.doctor) } : null,
  };
  return done({ detail });
}

// ── events 5 / 6: 保存する ─────────────────────────────────────────────────────────────────────────────────────────────

class Tampered extends Error {}
const must = (ok: boolean) => {
  if (!ok) throw new Tampered();
};

function readValues(body: Record<string, unknown>): StaffValues {
  const s = (k: string) => {
    const v = body[k] ?? "";
    must(typeof v === "string");
    return v as string;
  };
  const ids = body.clinicIds ?? [];
  must(Array.isArray(ids) && ids.every(isUuid) && typeof (body.allClinics ?? false) === "boolean");
  return {
    displayName: s("displayName"), email: s("email"), role: s("role"), clinicIds: [...new Set(ids as string[])],
    allClinics: body.allClinics === true, doctorId: s("doctorId"),
  };
}

/** create (no id) or edit (id) */
export async function saveStaff(a: Actor, body: Record<string, unknown>): Promise<Result> {
  try {
    return await saveStaffUnchecked(a, body);
  } catch (e) {
    if (e instanceof Tampered) return bad();
    if (isUniqueViolation(e)) return fieldFail([{ field: "email", code: "SE070" }]);
    throw e;
  }
}

async function saveStaffUnchecked(a: Actor, body: Record<string, unknown>): Promise<Result> {
  const v = readValues(body);
  must(v.role === "" || (STAFF_ROLES as readonly string[]).includes(v.role));
  const held = await viewerClinicIds(a);
  const offered = (await offeredClinics(a, held)).map((c) => c.id);
  must(v.clinicIds.every((c) => offered.includes(c)));
  must(!v.allClinics || a.allClinics); // all_clinics set by an administrator without it

  let existing: Loaded | null = null;
  if (body.id !== undefined && body.id !== null) {
    const t = await target(a, body.id);
    if (isResult(t)) return t;
    existing = t;
    must(t.status !== "DISABLED" && !(t.allClinics && !a.allClinics));
    if (t.id === a.accountId) {
      // the own account: role, clinics and all_clinics cannot be changed (state ⑦)
      const mine = t.staffClinics.map((c) => c.clinicId).filter((c) => offered.includes(c)).sort().join();
      must(v.role === t.role && v.allClinics === t.allClinics && v.clinicIds.slice().sort().join() === mine);
    }
  }
  const errors = validateStaff(v);
  if (errors.length > 0) return fieldFail(errors);

  const role = v.role as StaffRole;
  const email = v.email.trim().toLowerCase();
  if (await prisma.account.count({ where: { email, status: { not: "WITHDRAWN" }, ...(existing && { id: { not: existing.id } }) } })) {
    return fieldFail([{ field: "email", code: "SE070" }]);
  }
  // 9: only for 管理者, and only an administrator who has it may set it; an unchanged value of the viewer-without-it stays
  const allClinics = role === "ADMIN" && (a.allClinics ? v.allClinics : (existing?.allClinics ?? false));
  const boxes = role === "DOCTOR" ? [] : v.clinicIds;

  let doctor: { id: string; accountId: string | null; isActive: boolean } | null = null;
  if (role === "DOCTOR") {
    doctor = await prisma.doctor.findUnique({ where: { id: v.doctorId }, select: { id: true, accountId: true, isActive: true } });
    must(doctor !== null && (doctor.accountId === null ? doctor.isActive : doctor.accountId === existing?.id));
  }

  return prisma.$transaction(async (tx) => {
    const data = { displayName: v.displayName.trim(), email, role, allClinics };
    if (!existing) {
      const password = newInitialPassword();
      const acc = await tx.account.create({
        data: { ...data, status: "ACTIVE", passwordHash: await hashPassword(password), mustChangePassword: true, language: "JA" },
      });
      if (boxes.length > 0) await tx.staffClinic.createMany({ data: boxes.map((clinicId) => ({ accountId: acc.id, clinicId })) });
      await masterAudit(tx, a, "accounts", acc.id, CREATE_COLS);
      await masterAudit(tx, a, "staff_clinics", acc.id, boxes.length > 0 ? STAFF_CLINIC_COLS : []);
      if (doctor) {
        await tx.doctor.update({ where: { id: doctor.id }, data: { accountId: acc.id } });
        await masterAudit(tx, a, "doctors", doctor.id, ["account_id"]);
      }
      return done({ id: acc.id, password });
    }

    // staff_clinics inside the viewer's scope only; rows outside it stay (Q1 c); a doctor holds none
    const current = existing.staffClinics.map((c) => c.clinicId);
    const add = boxes.filter((c) => !current.includes(c));
    const remove = role === "DOCTOR" ? current : current.filter((c) => offered.includes(c) && !boxes.includes(c));
    // doctors.account_id: cleared on the doctor formerly linked, set on the chosen one (Q8)
    const old = existing.doctor;
    const clear = old && old.id !== doctor?.id ? old : null;
    const link = doctor && doctor.accountId !== existing.id ? doctor : null;

    if (clear) await tx.doctor.update({ where: { id: clear.id }, data: { accountId: null } });
    const changed = changedColumns(
      { displayName: "display_name", email: "email", role: "role", allClinics: "all_clinics" }, existing, data,
    );
    if (changed.length > 0) await tx.account.update({ where: { id: existing.id }, data });
    if (changed.includes("role")) await revokeAccountSessions(tx, existing.id, a.now); // event 6: a role change ends the logins
    if (remove.length > 0) await tx.staffClinic.deleteMany({ where: { accountId: existing.id, clinicId: { in: remove } } });
    if (add.length > 0) await tx.staffClinic.createMany({ data: add.map((clinicId) => ({ accountId: existing.id, clinicId })) });
    if (link) await tx.doctor.update({ where: { id: link.id }, data: { accountId: existing.id } });

    await masterAudit(tx, a, "accounts", existing.id, changed);
    await masterAudit(tx, a, "staff_clinics", existing.id, add.length + remove.length > 0 ? STAFF_CLINIC_COLS : []);
    // one row per table: the doctor id, or the account id when two doctor rows change (Q9)
    if (clear && link) await masterAudit(tx, a, "doctors", existing.id, ["account_id"]);
    else if (clear || link) await masterAudit(tx, a, "doctors", (clear ?? link)!.id, ["account_id"]);
    return done({ id: existing.id });
  });
}

// ── events 7-10 ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** the account for an action; the own account, a disabled one where it must not be, ⑧ → SE090 */
async function actionTarget(a: Actor, body: Record<string, unknown>, ok: (acc: Loaded) => boolean): Promise<Loaded | Result> {
  const t = await target(a, body.id);
  if (isResult(t)) return t;
  return (t.allClinics && !a.allClinics) || !ok(t) ? bad() : t;
}

/** event 7 パスワード発行 */
export async function issuePassword(a: Actor, body: Record<string, unknown>): Promise<Result> {
  const acc = await actionTarget(a, body, (x) => x.status !== "DISABLED" && x.id !== a.accountId);
  if (isResult(acc)) return acc;
  const password = newInitialPassword();
  const passwordHash = await hashPassword(password);
  return prisma.$transaction(async (tx: Db) => {
    await tx.account.update({ where: { id: acc.id }, data: { passwordHash, mustChangePassword: true } });
    await revokeAccountSessions(tx, acc.id, a.now);
    await masterAudit(tx, a, "accounts", acc.id, acc.mustChangePassword ? ["password_hash"] : ["password_hash", "must_change_password"]);
    return done({ password });
  });
}

/** event 8 無効化する (the dialog is the client's; the own account → SE071, a banner) */
export async function disableAccount(a: Actor, body: Record<string, unknown>): Promise<Result> {
  const acc = await actionTarget(a, body, () => true);
  if (isResult(acc)) return acc;
  if (acc.id === a.accountId) return fail(409, "SE071");
  if (acc.status === "DISABLED") return done({ unchanged: true });
  return prisma.$transaction(async (tx) => {
    await tx.account.update({ where: { id: acc.id }, data: { status: "DISABLED" } });
    await revokeAccountSessions(tx, acc.id, a.now);
    await masterAudit(tx, a, "accounts", acc.id, ["status"]);
    return done();
  });
}

/** event 9 有効化する: DISABLED accounts only */
export async function enableAccount(a: Actor, body: Record<string, unknown>): Promise<Result> {
  const acc = await actionTarget(a, body, (x) => x.status === "DISABLED");
  if (isResult(acc)) return acc;
  return prisma.$transaction(async (tx) => {
    await tx.account.update({ where: { id: acc.id }, data: { status: "ACTIVE" } });
    await masterAudit(tx, a, "accounts", acc.id, ["status"]);
    return done();
  });
}

/** event 10 ロック解除: a locked account that is not disabled */
export async function unlockAccount(a: Actor, body: Record<string, unknown>): Promise<Result> {
  const acc = await actionTarget(a, body, (x) => stateOf(x, a.now) === "locked");
  if (isResult(acc)) return acc;
  return prisma.$transaction(async (tx) => {
    await tx.account.update({ where: { id: acc.id }, data: { status: "ACTIVE", lockedUntil: null, failedLoginCount: 0 } });
    const cols = [
      ...(acc.status !== "ACTIVE" ? ["status"] : []), ...(acc.lockedUntil ? ["locked_until"] : []),
      ...(acc.failedLoginCount !== 0 ? ["failed_login_count"] : []),
    ];
    await masterAudit(tx, a, "accounts", acc.id, cols);
    return done();
  });
}
