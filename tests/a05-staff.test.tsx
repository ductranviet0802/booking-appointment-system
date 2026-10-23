// A05 スタッフアカウント管理: access (RECEPTION / DOCTOR / anonymous), create with the generated password and its first login,
// edit, role change, doctor link, パスワード発行, 無効化 (PE010, sessions gone), 有効化, ロック解除, scope (all_clinics), audit.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveSession } from "@/lib/auth/context";
import { login } from "@/lib/auth/service";
import { pool, prisma } from "@/lib/prisma";
import { cleanupStaff, makeStaff, MARK, request, TEST_IP } from "./a03-helpers";

process.env.PHOTO_DIR = mkdtempSync(path.join(tmpdir(), "a05-"));
const mockJar: { sid?: string } = {};
jest.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sid" && mockJar.sid ? { value: mockJar.sid } : undefined) }),
  headers: async () => ({ get: () => null }),
}));
jest.mock("../app/(staff)/admin/staff/staff.module.css", () => ({}));
jest.mock("@/components/ui/Toast", () => ({ useToast: () => ({ toast: jest.fn() }), useLang: () => "ja" }));
jest.mock("@/lib/client/api", () => ({ useApiFetch: () => jest.fn(), postJson: jest.fn(), openStaffErrorScreen: jest.fn() }));

import { GET as getDetail } from "@/app/api/admin/staff/detail/route";
import { POST as postDisable } from "@/app/api/admin/staff/disable/route";
import { POST as postEnable } from "@/app/api/admin/staff/enable/route";
import { GET as getList } from "@/app/api/admin/staff/list/route";
import { POST as postPassword } from "@/app/api/admin/staff/password/route";
import { POST as postSave } from "@/app/api/admin/staff/save/route";
import { POST as postUnlock } from "@/app/api/admin/staff/unlock/route";
import { StaffClient } from "@/app/(staff)/admin/staff/StaffClient";

jest.setTimeout(120_000);

type Answer = { code?: string; id?: string; password?: string; unchanged?: boolean; errors?: { field: string; code: string }[]; detail?: Record<string, unknown> };
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Answer });
const as = (token: string | undefined) => {
  mockJar.sid = token;
};
const post = async (route: typeof postSave, url: string, body: unknown) => json(await route(request(url, body)));
const save = (body: Record<string, unknown>) => post(postSave, "/api/admin/staff/save", body);
const audits = (targetType: string, targetId: string) =>
  prisma.auditLog.findMany({ where: { action: "MASTER_UPDATE", targetType, targetId }, orderBy: { id: "asc" } });
const loginWith = (email: string, password: string) => login({ email, password, ip: TEST_IP, userAgent: "jest" });

let admin: Awaited<ReturnType<typeof makeStaff>>; // all_clinics
let local: Awaited<ReturnType<typeof makeStaff>>; // honin only
let reception: Awaited<ReturnType<typeof makeStaff>>;
let honin = "";
let ekimae = "";
const testDoctorCode = `${MARK}-doc`;
let seq = 0;
const email = () => `n${++seq}.${Date.now()}.${MARK}@example.jp`;
const body = (o: Record<string, unknown> = {}) => ({
  displayName: "試験 受付", email: email(), role: "RECEPTION", clinicIds: [honin], allClinics: false, doctorId: "", ...o,
});

beforeAll(async () => {
  admin = await makeStaff("ADMIN", { clinics: ["honin", "ekimae"] });
  await prisma.account.update({ where: { id: admin.account.id }, data: { allClinics: true } });
  local = await makeStaff("ADMIN", { clinics: ["honin"] });
  reception = await makeStaff("RECEPTION");
  honin = admin.clinicId;
  ekimae = (await prisma.clinic.findFirstOrThrow({ where: { code: "ekimae" } })).id;
});

afterAll(async () => {
  await prisma.doctor.deleteMany({ where: { code: testDoctorCode } });
  await cleanupStaff();
  await prisma.$disconnect();
  await pool.end();
});

describe("access", () => {
  it("every A05 route answers a RECEPTION session with 403 SE091 and writes nothing", async () => {
    const other = await prisma.account.findFirstOrThrow({ where: { role: "ADMIN" } });
    const accounts = await prisma.account.count();
    const logs = await prisma.auditLog.count({ where: { action: "MASTER_UPDATE" } });
    as(reception.token);
    const results = [
      await post(postSave, "/api/admin/staff/save", body()),
      await post(postSave, "/api/admin/staff/save", { ...body(), id: other.id }),
      await post(postPassword, "/api/admin/staff/password", { id: other.id }),
      await post(postDisable, "/api/admin/staff/disable", { id: other.id }),
      await post(postEnable, "/api/admin/staff/enable", { id: other.id }),
      await post(postUnlock, "/api/admin/staff/unlock", { id: other.id }),
      await json(await getList(request("/api/admin/staff/list"))),
      await json(await getDetail(request(`/api/admin/staff/detail?id=${other.id}`))),
    ];
    for (const r of results) expect(r).toEqual({ status: 403, body: { code: "SE091", params: {} } });
    expect(await prisma.account.count()).toBe(accounts);
    expect(await prisma.auditLog.count({ where: { action: "MASTER_UPDATE" } })).toBe(logs);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: other.id } })).status).toBe(other.status);
  });

  it("no session → 401 PI013; cross-origin → 400 SE090", async () => {
    as(undefined);
    expect((await save(body())).status).toBe(401);
    as(admin.token);
    const r = await json(await postSave(request("/api/admin/staff/save", body(), { headers: { origin: "http://evil.example" } })));
    expect(r).toEqual({ status: 400, body: { code: "SE090", params: {} } });
  });
});

describe("create, first login, edit", () => {
  let id = "";
  let mail = "";
  let pw = "";

  beforeAll(() => as(admin.token));

  it("field errors and values the UI cannot produce write nothing", async () => {
    const e = await save(body({ displayName: " ", email: "nope", role: "RECEPTION", clinicIds: [] }));
    expect(e.status).toBe(400);
    expect(e.body.errors!.map((x) => `${x.field}:${x.code}`).sort()).toEqual(["clinicIds:SE001", "displayName:SE001", "email:SE002"]);
    expect((await save(body({ role: "PATIENT" }))).body.code).toBe("SE090");
    expect((await save(body({ clinicIds: ["00000000-0000-4000-8000-000000000000"] }))).body.code).toBe("SE090");
    as(local.token); // honin only: ekimae is outside the scope, all_clinics cannot be set
    expect((await save(body({ clinicIds: [ekimae] }))).body.code).toBe("SE090");
    expect((await save(body({ role: "ADMIN", allClinics: true, clinicIds: [] }))).body.code).toBe("SE090");
    as(admin.token);
    expect(await prisma.account.count({ where: { email: { contains: `.${MARK}@` }, displayName: " " } })).toBe(0);
  });

  it("creates ACTIVE + must_change_password; the shown password logs in and lands on P05; audit rows; SE070 on a duplicate", async () => {
    mail = email();
    const r = await save(body({ email: mail.toUpperCase() }));
    expect(r.status).toBe(200);
    id = r.body.id!;
    pw = r.body.password!;
    expect(pw).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
    expect(await prisma.account.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "ACTIVE", mustChangePassword: true, language: "JA", email: mail, role: "RECEPTION" });
    expect((await prisma.staffClinic.findMany({ where: { accountId: id } })).map((c) => c.clinicId)).toEqual([honin]);

    const first = await loginWith(mail, pw);
    expect(first).toMatchObject({ ok: true, body: { destination: "/password/change" } });
    expect((await audits("accounts", id)).length).toBe(1);
    expect((await audits("staff_clinics", id)).length).toBe(1);
    const detail = JSON.stringify((await prisma.auditLog.findMany({ where: { targetId: id } })).map((a) => a.detail));
    expect(detail).not.toContain(pw);
    expect(detail).not.toContain("passwordHash");

    expect(await save(body({ email: mail }))).toMatchObject({ status: 400, body: { errors: [{ field: "email", code: "SE070" }] } });
  });

  it("edit: only changed columns; a role change revokes the sessions; clinics outside the viewer's scope stay", async () => {
    const s = await loginWith(mail, pw);
    const token = (s as { session: { token: string } }).session.token;
    expect((await resolveSession(token)).state).toBe("valid");
    // an edit by the honin-only administrator that does not touch the ekimae row
    await prisma.staffClinic.create({ data: { accountId: id, clinicId: ekimae } });
    as(local.token);
    expect((await save({ ...body(), id, email: mail, displayName: "試験 受付2", clinicIds: [honin] })).status).toBe(200);
    expect((await audits("accounts", id)).at(-1)?.detail).toEqual({ columns: ["display_name"] });
    expect((await prisma.staffClinic.count({ where: { accountId: id, clinicId: ekimae } }))).toBe(1);
    expect((await resolveSession(token)).state).toBe("valid"); // no role change: no revocation
    const n = (await prisma.auditLog.count({ where: { targetId: id } }));
    expect((await save({ ...body(), id, email: mail, displayName: "試験 受付2", clinicIds: [honin] })).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { targetId: id } })).toBe(n); // no change, no row

    as(admin.token);
    const r = await save({ ...body(), id, email: mail, displayName: "試験 受付2", role: "ADMIN", clinicIds: [honin, ekimae] });
    expect(r.status).toBe(200);
    expect((await audits("accounts", id)).at(-1)?.detail).toEqual({ columns: ["role"] });
    expect((await resolveSession(token)).state).not.toBe("valid");
  });

  it("the own account: role, clinics and all_clinics cannot change; 無効化 → 409 SE071; パスワード発行 → SE090", async () => {
    const mine = admin.account.id;
    const own = { displayName: "試験 職員", email: admin.account.email, role: "ADMIN", clinicIds: [honin, ekimae], allClinics: true, doctorId: "", id: mine };
    expect((await save({ ...own, role: "RECEPTION", allClinics: false })).body.code).toBe("SE090");
    expect((await save({ ...own, clinicIds: [honin] })).body.code).toBe("SE090");
    expect((await save({ ...own, displayName: "試験 職員2" })).status).toBe(200);
    expect(await post(postDisable, "/api/admin/staff/disable", { id: mine })).toEqual({ status: 409, body: { code: "SE071", params: {} } });
    expect((await prisma.account.findUniqueOrThrow({ where: { id: mine } })).status).toBe("ACTIVE");
    expect((await post(postPassword, "/api/admin/staff/password", { id: mine })).body.code).toBe("SE090");
  });
});

describe("パスワード発行, 無効化, 有効化, ロック解除", () => {
  let id = "";
  let mail = "";
  let pw = "";

  beforeAll(async () => {
    as(admin.token);
    mail = email();
    const r = await save(body({ email: mail }));
    id = r.body.id!;
    pw = r.body.password!;
  });

  it("パスワード発行: a new password, the old one and its sessions are gone, the next login lands on P05", async () => {
    const old = (await loginWith(mail, pw)) as { session: { token: string } };
    const r = await post(postPassword, "/api/admin/staff/password", { id });
    expect(r.status).toBe(200);
    const next = r.body.password!;
    expect(next).not.toBe(pw);
    expect((await resolveSession(old.session.token)).state).not.toBe("valid");
    expect((await loginWith(mail, pw)).ok).toBe(false);
    expect(await loginWith(mail, next)).toMatchObject({ ok: true, body: { destination: "/password/change" } });
    expect((await audits("accounts", id)).at(-1)?.detail).toEqual({ columns: ["password_hash"] }); // must_change_password was already true
    pw = next;
  });

  it("無効化: PE010 on login, the open session no longer reads; 有効化 only for a disabled account", async () => {
    const open = (await loginWith(mail, pw)) as { session: { token: string } };
    expect((await post(postEnable, "/api/admin/staff/enable", { id })).body.code).toBe("SE090"); // not disabled
    expect((await post(postDisable, "/api/admin/staff/disable", { id })).status).toBe(200);
    expect((await prisma.account.findUniqueOrThrow({ where: { id } })).status).toBe("DISABLED");
    expect(await loginWith(mail, pw)).toMatchObject({ ok: false, code: "PE010" });
    expect((await resolveSession(open.session.token)).state).not.toBe("valid");
    expect((await audits("accounts", id)).at(-1)?.detail).toEqual({ columns: ["status"] });
    expect((await post(postDisable, "/api/admin/staff/disable", { id })).body).toMatchObject({ unchanged: true });
    expect((await post(postPassword, "/api/admin/staff/password", { id })).body.code).toBe("SE090"); // disabled
    expect((await save({ ...body(), id, email: mail })).body.code).toBe("SE090"); // read-only (②)

    expect((await post(postEnable, "/api/admin/staff/enable", { id })).status).toBe(200);
    expect((await loginWith(mail, pw)).ok).toBe(true);
  });

  it("ロック解除: status ACTIVE, locked_until null, failed count 0; not for an unlocked account", async () => {
    expect((await post(postUnlock, "/api/admin/staff/unlock", { id })).body.code).toBe("SE090");
    await prisma.account.update({ where: { id }, data: { lockedUntil: new Date(Date.now() + 600_000), failedLoginCount: 5 } });
    const rows = (await json(await getList(request("/api/admin/staff/list")))).body as unknown as { lists: { rows: { id: string; state: string }[] } };
    expect(rows.lists.rows.find((r) => r.id === id)?.state).toBe("locked");
    expect((await post(postUnlock, "/api/admin/staff/unlock", { id })).status).toBe(200);
    expect(await prisma.account.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "ACTIVE", lockedUntil: null, failedLoginCount: 0 });
    expect((await audits("accounts", id)).at(-1)?.detail).toEqual({ columns: ["locked_until", "failed_login_count"] });
  });
});

describe("doctor accounts and scope", () => {
  let doctorId = "";

  beforeAll(async () => {
    as(admin.token);
    doctorId = (await prisma.doctor.create({
      data: {
        code: testDoctorCode, familyName: "試験", givenName: "医", familyNameKana: "シケン", givenNameKana: "イ", nameRomaji: "SHIKEN I",
        title: "DOCTOR", profileJa: "x", primaryClinicId: honin, displayOrder: 99,
      },
    })).id;
  });

  it("医師 account: no clinics, doctors.account_id set; a taken doctor → SE090; role away from 医師 clears the link", async () => {
    expect((await save(body({ role: "DOCTOR", clinicIds: [], doctorId: "" }))).body.errors).toEqual([expect.objectContaining({ field: "doctorId", code: "SE001" })]);
    const r = await save(body({ role: "DOCTOR", clinicIds: [honin], doctorId }));
    expect(r.status).toBe(200);
    expect(await prisma.staffClinic.count({ where: { accountId: r.body.id } })).toBe(0);
    expect((await prisma.doctor.findUniqueOrThrow({ where: { id: doctorId } })).accountId).toBe(r.body.id);
    expect((await audits("doctors", doctorId)).length).toBe(1);
    expect((await save(body({ role: "DOCTOR", doctorId }))).body.code).toBe("SE090");

    const back = await save({ ...body(), id: r.body.id, email: (await prisma.account.findUniqueOrThrow({ where: { id: r.body.id } })).email, role: "RECEPTION" });
    expect(back.status).toBe(200);
    expect((await prisma.doctor.findUniqueOrThrow({ where: { id: doctorId } })).accountId).toBeNull();
    expect(await prisma.staffClinic.count({ where: { accountId: r.body.id } })).toBe(1);
  });

  it("⑧ an administrator without all_clinics cannot read or change an all_clinics account; the list holds only his clinics' accounts", async () => {
    as(local.token);
    expect((await post(postPassword, "/api/admin/staff/password", { id: admin.account.id })).body.code).toBe("SE090");
    expect((await post(postDisable, "/api/admin/staff/disable", { id: admin.account.id })).body.code).toBe("SE090");
    expect((await save({ ...body(), id: admin.account.id, email: admin.account.email })).body.code).toBe("SE090");
    const lists = (await json(await getList(request("/api/admin/staff/list")))).body as unknown as { lists: { rows: { id: string; locked8: boolean }[]; clinics: { id: string }[] } };
    expect(lists.lists.clinics.map((c) => c.id)).toEqual([honin]);
    expect(lists.lists.rows.find((r) => r.id === admin.account.id)?.locked8).toBe(true);
    // an account that holds only ekimae is outside his scope
    const ekiOnly = await makeStaff("RECEPTION", { clinics: ["ekimae"] });
    expect(lists.lists.rows.some((r) => r.id === ekiOnly.account.id)).toBe(false);
    expect((await json(await getDetail(request(`/api/admin/staff/detail?id=${ekiOnly.account.id}`)))).status).toBe(403);
    as(admin.token);
    expect((await json(await getDetail(request(`/api/admin/staff/detail?id=${ekiOnly.account.id}`)))).status).toBe(200);
    expect((await json(await getDetail(request("/api/admin/staff/detail?id=not-a-uuid")))).body.code).toBe("SE090");
  });
});

describe("A05 form rendering", () => {
  it("renders the list, the form of the first account and the 新規作成 button", async () => {
    as(admin.token);
    const lists = (await json(await getList(request("/api/admin/staff/list")))).body as unknown as { lists: Parameters<typeof StaffClient>[0]["lists"] };
    const first = (await json(await getDetail(request(`/api/admin/staff/detail?id=${lists.lists.rows[0].id}`)))).body.detail as never;
    const html = renderToStaticMarkup(<StaffClient lists={lists.lists} initial={first} />);
    for (const text of ["スタッフアカウント", "新規作成", "アカウントの編集", "表示名", "メールアドレス", "保存する"]) expect(html).toContain(text);
    expect(html).not.toContain("初期パスワードを発行しました"); // the dialog exists only after create / reissue
  });
});
