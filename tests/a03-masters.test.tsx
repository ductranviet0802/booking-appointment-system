// A03 医師・診療科・診療区分マスタ: access (guardScreen, write routes with the wrong role), the saves with their audit rows,
// 有効 / 無効, 削除 (SE050), SE051 / SE052 / SE054, the photo and the read-only form of the receptionist.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { renderToStaticMarkup } from "react-dom/server";
import { guardScreen } from "@/lib/auth/context";
import { dbDate, dbTime, todayJst } from "@/lib/datetime";
import { pool, prisma } from "@/lib/prisma";
import { cleanupStaff, makeStaff, request } from "./a03-helpers";

process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
process.env.PHOTO_DIR = mkdtempSync(path.join(tmpdir(), "a03-photos-"));
const mockJar: { sid?: string; path: string } = { path: "/" };
jest.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sid" && mockJar.sid ? { value: mockJar.sid } : undefined) }),
  headers: async () => ({ get: (n: string) => (n === "x-pathname" ? mockJar.path : null) }),
}));
jest.mock("../app/(staff)/admin/masters/masters.module.css", () => ({}));
jest.mock("@/components/ui/Toast", () => ({ useToast: () => ({ toast: jest.fn() }), useLang: () => "ja" }));
jest.mock("@/lib/client/api", () => ({ useApiFetch: () => jest.fn(), postJson: jest.fn(), openStaffErrorScreen: jest.fn() }));

import { GET as getDetail } from "@/app/api/admin/masters/detail/route";
import { POST as postDelete } from "@/app/api/admin/masters/delete/route";
import { GET as getList } from "@/app/api/admin/masters/list/route";
import { POST as postSave } from "@/app/api/admin/masters/save/route";
import { POST as postStatus } from "@/app/api/admin/masters/status/route";
import { POST as postPhoto } from "@/app/api/admin/photos/route";
import { GET as getPhoto } from "@/app/api/photos/[file]/route";
import { MastersClient } from "@/app/(staff)/admin/masters/MastersClient";
import { loadDetail, loadLists, type DoctorDetail } from "@/lib/admin/masters";

jest.setTimeout(120_000);

const TAG = `T${Date.now().toString(36)}`.slice(0, 12);
let admin: Awaited<ReturnType<typeof makeStaff>>;
let reception: Awaited<ReturnType<typeof makeStaff>>;
let doctor: Awaited<ReturnType<typeof makeStaff>>;
let clinicId = "";

const as = (token: string | undefined) => {
  mockJar.sid = token;
};
type Answer = { code?: string; id?: string; photoUrl?: string; errors?: { field: string; code: string }[] };
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Answer });
const save = async (body: Record<string, unknown>) => json(await postSave(request("/api/admin/masters/save", body)));
const audits = (targetType: string, targetId: string) =>
  prisma.auditLog.findMany({ where: { action: "MASTER_UPDATE", targetType, targetId }, orderBy: { id: "asc" } });

const deptBody = (o: Record<string, unknown> = {}) => ({
  kind: "department", code: `${TAG}d`, nameJa: "試験科", nameEn: "", nameVi: "", nameKana: "シケンカ", displayOrder: "90", offered: true, clinicOrder: "9", ...o,
});
const doctorBody = (departmentIds: string[], o: Record<string, unknown> = {}) => ({
  kind: "doctor", code: `${TAG}x`, familyName: "試験", givenName: "太郎", familyNameKana: "シケン", givenNameKana: "タロウ", nameRomaji: "SHIKEN Taro",
  title: "DOCTOR", photoUrl: null, departmentIds, primaryClinicId: clinicId, langJa: true, langEn: false, langVi: false, langOther: "",
  profileJa: "経歴", profileEn: "", profileVi: "", qualJa: "", qualEn: "", qualVi: "", displayOrder: "90", ...o,
});
const vtBody = (departmentId: string, o: Record<string, unknown> = {}) => ({
  kind: "visitType", departmentId, code: `${TAG}v`, category: "SELF_PAY", nameJa: "試験区分", nameEn: "", nameVi: "", durationFrames: "2", priceYen: "4000",
  webBookable: true, noticeJa: "", noticeEn: "", noticeVi: "", displayOrder: "90", ...o,
});

beforeAll(async () => {
  admin = await makeStaff("ADMIN", { clinics: ["honin", "ekimae"] });
  reception = await makeStaff("RECEPTION");
  doctor = await makeStaff("DOCTOR");
  clinicId = admin.clinicId;
});

afterAll(async () => {
  await prisma.doctorShiftPattern.deleteMany({ where: { doctor: { code: { startsWith: TAG } } } });
  await prisma.doctorDepartment.deleteMany({ where: { doctor: { code: { startsWith: TAG } } } });
  await prisma.doctor.deleteMany({ where: { code: { startsWith: TAG } } });
  await prisma.visitType.deleteMany({ where: { code: { startsWith: TAG } } });
  await prisma.clinicDepartment.deleteMany({ where: { department: { code: { startsWith: TAG } } } });
  await prisma.department.deleteMany({ where: { code: { startsWith: TAG } } });
  await cleanupStaff();
  await prisma.$disconnect();
  await pool.end();
});

// ── access ──────────────────────────────────────────────────────────────────────────────────────────────────────────

async function outcome(screen: Parameters<typeof guardScreen>[0], sid: string | undefined) {
  mockJar.sid = sid;
  mockJar.path = "/admin/masters";
  try {
    await guardScreen(screen);
    return "allow";
  } catch (e) {
    const d = (e as { digest?: string }).digest ?? "";
    return d.startsWith("NEXT_REDIRECT") ? "redirect" : d.startsWith("NEXT_HTTP_ERROR_FALLBACK") ? `http:${d.split(";")[1]}` : "other";
  }
}

describe("access", () => {
  it("guardScreen A03: ADMIN and RECEPTION in, DOCTOR → ER-03, anonymous → login", async () => {
    expect(await outcome("A03", admin.token)).toBe("allow");
    expect(await outcome("A03", reception.token)).toBe("allow");
    expect(await outcome("A03", doctor.token)).toBe("http:403");
    expect(await outcome("A03", undefined)).toBe("redirect");
  });

  it("guardScreen A05: ADMIN only", async () => {
    expect(await outcome("A05", admin.token)).toBe("allow");
    expect(await outcome("A05", reception.token)).toBe("http:403");
    expect(await outcome("A05", doctor.token)).toBe("http:403");
  });

  it("every write route answers a RECEPTION session with 403 SE091 and writes nothing", async () => {
    const count = async () => [
      await prisma.doctor.count(), await prisma.department.count(), await prisma.visitType.count(),
      await prisma.auditLog.count({ where: { action: "MASTER_UPDATE" } }),
    ];
    const before = await count();
    as(reception.token);
    const first = await prisma.department.findFirstOrThrow();
    const calls = [
      postSave(request("/api/admin/masters/save", deptBody())),
      postSave(request("/api/admin/masters/save", doctorBody([first.id]))),
      postSave(request("/api/admin/masters/save", vtBody(first.id))),
      postStatus(request("/api/admin/masters/status", { kind: "department", id: first.id, active: false })),
      postDelete(request("/api/admin/masters/delete", { kind: "department", id: first.id, confirmed: true })),
      postPhoto(request("/api/admin/photos", undefined, { raw: "x", headers: { "content-type": "application/octet-stream" } })),
    ];
    for (const res of calls) expect(await json(await res)).toEqual({ status: 403, body: { code: "SE091", params: {} } });
    expect(await count()).toEqual(before);
    expect((await getList(request("/api/admin/masters/list"))).status).toBe(200); // the read events stay open
    as(doctor.token);
    expect((await getList(request("/api/admin/masters/list"))).status).toBe(403);
  });

  it("no session → 401 PI013; cross-origin → 400 SE090; first-change password → 403", async () => {
    as(undefined);
    expect(await json(await postSave(request("/api/admin/masters/save", deptBody())))).toEqual({ status: 401, body: { code: "PI013", params: {} } });
    as(admin.token);
    const cross = request("/api/admin/masters/save", deptBody(), { headers: { origin: "http://evil.example" } });
    expect(await json(await postSave(cross))).toEqual({ status: 400, body: { code: "SE090", params: {} } });
    const fc = await makeStaff("ADMIN", { mustChangePassword: true });
    as(fc.token);
    expect((await postSave(request("/api/admin/masters/save", deptBody()))).status).toBe(403);
  });
});

// ── saves, audit, 無効化 / 有効化, 削除 ─────────────────────────────────────────────────────────────────────────────────

describe("A03 as the administrator", () => {
  let deptId = "";
  let doctorId = "";

  beforeAll(() => as(admin.token));

  it("department: field errors, then INSERT with the clinic link and two audit rows (更新2, 更新7)", async () => {
    const bad = await save(deptBody({ nameJa: " ", nameKana: "ひらがな", clinicOrder: "" }));
    expect(bad.status).toBe(400);
    expect(bad.body.errors!.map((e) => `${e.field}:${e.code}`).sort()).toEqual(["clinicOrder:SE001", "nameJa:SE001", "nameKana:SE002"]);
    expect(await prisma.department.count({ where: { code: `${TAG}d` } })).toBe(0);

    const ok = await save(deptBody());
    expect(ok.status).toBe(200);
    deptId = ok.body.id!;
    expect(await prisma.clinicDepartment.findUnique({ where: { clinicId_departmentId: { clinicId, departmentId: deptId } } })).toMatchObject({ displayOrder: 9 });
    expect((await audits("departments", deptId)).map((a) => a.detail)).toEqual([{ columns: expect.arrayContaining(["code", "name_ja", "is_active"]) }]);
    expect((await audits("clinic_departments", deptId)).length).toBe(1);
    expect(await save(deptBody())).toMatchObject({ status: 400, body: { errors: [{ field: "code", code: "SE051" }] } });
  });

  it("an update writes only the changed columns; a save without change writes no audit row and still succeeds", async () => {
    await save(deptBody({ id: deptId, nameJa: "試験科2" }));
    const rows = await audits("departments", deptId);
    expect(rows.at(-1)?.detail).toEqual({ columns: ["name_ja"] });
    const n = (await audits("departments", deptId)).length + (await audits("clinic_departments", deptId)).length;
    expect((await save(deptBody({ id: deptId, nameJa: "試験科2" }))).status).toBe(200);
    expect((await audits("departments", deptId)).length + (await audits("clinic_departments", deptId)).length).toBe(n);
    // 18 is immutable: a changed code in the request is ignored
    await save(deptBody({ id: deptId, nameJa: "試験科2", code: "other-code" }));
    expect((await prisma.department.findUniqueOrThrow({ where: { id: deptId } })).code).toBe(`${TAG}d`);
  });

  it("doctor: INSERT with links; a value the UI cannot produce → 400 SE090 and nothing written", async () => {
    const tampered = await save(doctorBody([deptId], { title: "KING" }));
    expect(tampered).toMatchObject({ status: 400, body: { code: "SE090" } });
    expect((await save(doctorBody(["00000000-0000-4000-8000-000000000000"]))).body.code).toBe("SE090");
    expect(await prisma.doctor.count({ where: { code: `${TAG}x` } })).toBe(0);

    const ok = await save(doctorBody([deptId]));
    expect(ok.status).toBe(200);
    doctorId = ok.body.id!;
    expect((await audits("doctors", doctorId)).length).toBe(1);
    expect((await audits("doctor_departments", doctorId)).length).toBe(1);
    const d = (await loadDetail("doctor", doctorId, clinicId)) as DoctorDetail;
    expect(d).toMatchObject({ langJa: true, langEn: false, departmentIds: [deptId], hasAccount: false });
  });

  it("SE054: unchecking a link a current shift pattern uses (doctor 11, clinic 21-1); SE050 on delete of the same doctor", async () => {
    await prisma.doctorShiftPattern.create({
      data: { doctorId, clinicId, departmentId: deptId, weekday: 1, band: "AM", startTime: dbTime("09:00"), endTime: dbTime("12:00"), validFrom: dbDate(todayJst()) },
    });
    const other = await prisma.department.findFirstOrThrow({ where: { isActive: true, id: { not: deptId } } });
    const r = await save(doctorBody([other.id], { id: doctorId }));
    expect(r).toMatchObject({ status: 400, body: { code: "SE054", errors: [{ field: "departmentIds", code: "SE054" }] } });
    expect(await prisma.doctorDepartment.count({ where: { doctorId, departmentId: deptId } })).toBe(1);

    const r2 = await save(deptBody({ id: deptId, nameJa: "試験科2", offered: false }));
    expect(r2).toMatchObject({ status: 400, body: { errors: [{ field: "offered", code: "SE054" }] } });
    expect(await prisma.clinicDepartment.count({ where: { clinicId, departmentId: deptId } })).toBe(1);

    const del = await json(await postDelete(request("/api/admin/masters/delete", { kind: "doctor", id: doctorId, confirmed: false })));
    expect(del).toEqual({ status: 409, body: { code: "SE050", params: {} } });
    expect(await prisma.doctor.count({ where: { id: doctorId } })).toBe(1);
    // a pattern that ended before today does not count (抽出11)
    await prisma.doctorShiftPattern.updateMany({ where: { doctorId }, data: { validFrom: dbDate("2020-01-01"), validTo: dbDate("2020-12-31") } });
    expect((await save(doctorBody([other.id], { id: doctorId }))).status).toBe(200);
    await prisma.doctorShiftPattern.deleteMany({ where: { doctorId } });
  });

  it("無効化 → 有効化 write is_active only, with audit; a second 無効化 changes nothing", async () => {
    const off = async () => json(await postStatus(request("/api/admin/masters/status", { kind: "doctor", id: doctorId, active: false })));
    expect((await off()).body).toMatchObject({ ok: true });
    expect((await prisma.doctor.findUniqueOrThrow({ where: { id: doctorId } })).isActive).toBe(false);
    const n = (await audits("doctors", doctorId)).length;
    expect((await off()).body).toMatchObject({ ok: true, unchanged: true });
    expect((await audits("doctors", doctorId)).length).toBe(n);
    const on = await json(await postStatus(request("/api/admin/masters/status", { kind: "doctor", id: doctorId, active: true })));
    expect(on.status).toBe(200);
    expect((await audits("doctors", doctorId)).at(-1)?.detail).toEqual({ columns: ["is_active"] });
    const gone = await json(await postStatus(request("/api/admin/masters/status", { kind: "doctor", id: "00000000-0000-4000-8000-000000000000", active: false })));
    expect(gone.body.code).toBe("SE090");
  });

  it("visit type: SELF_PAY needs a price (SE052), FIRST stores none and sets questionnaire_required; SE051 per clinic; SE090 for a foreign id", async () => {
    expect(await save(vtBody(deptId, { priceYen: "" }))).toMatchObject({ status: 400, body: { errors: [{ field: "priceYen", code: "SE052" }] } });
    expect(await save(vtBody(deptId, { category: "FIRST", priceYen: "100" }))).toMatchObject({ body: { errors: [{ code: "SE052" }] } });
    expect(await save(vtBody(deptId, { priceYen: "-5" }))).toMatchObject({ body: { errors: [{ field: "priceYen", code: "SE002" }] } });
    const self = await save(vtBody(deptId));
    expect(self.status).toBe(200);
    expect(await prisma.visitType.findUniqueOrThrow({ where: { id: self.body.id } })).toMatchObject({ priceYen: 4000, questionnaireRequired: false, clinicId });
    expect(await save(vtBody(deptId))).toMatchObject({ body: { errors: [{ field: "code", code: "SE051" }] } });
    const first = await save(vtBody(deptId, { id: self.body.id, category: "FIRST", priceYen: "" }));
    expect(first.status).toBe(200);
    expect(await prisma.visitType.findUniqueOrThrow({ where: { id: self.body.id } })).toMatchObject({ priceYen: null, questionnaireRequired: true });
    expect((await audits("visit_types", self.body.id!)).at(-1)?.detail).toEqual({ columns: ["category", "price_yen", "questionnaire_required"] });

    // another clinic's visit type is unknown here (SE090) and the list holds this clinic's rows only
    const ekimae = await prisma.clinic.findFirstOrThrow({ where: { code: "ekimae" } });
    const foreign = await prisma.visitType.findFirstOrThrow({ where: { clinicId: ekimae.id } });
    expect(await loadDetail("visitType", foreign.id, clinicId)).toBeNull();
    expect((await json(await getDetail(request(`/api/admin/masters/detail?kind=visitType&id=${foreign.id}`)))).body.code).toBe("SE090");
    expect((await loadLists(clinicId)).visitTypes.every((v) => v.id !== foreign.id)).toBe(true);
  });

  it("delete: an unreferenced department goes with its links and visit types, one audit row per table (更新5, 更新7)", async () => {
    const check = await json(await postDelete(request("/api/admin/masters/delete", { kind: "department", id: deptId, confirmed: false })));
    expect(check.body).toMatchObject({ ok: true, deletable: true });
    expect(await prisma.department.count({ where: { id: deptId } })).toBe(1);
    await prisma.doctorDepartment.deleteMany({ where: { departmentId: deptId } });
    await prisma.doctor.delete({ where: { id: doctorId } });
    const r = await json(await postDelete(request("/api/admin/masters/delete", { kind: "department", id: deptId, confirmed: true })));
    expect(r.status).toBe(200);
    expect(await prisma.department.count({ where: { id: deptId } })).toBe(0);
    expect(await prisma.visitType.count({ where: { departmentId: deptId } })).toBe(0);
    for (const [table, column] of [["departments", "code"], ["clinic_departments", "clinic_id"], ["visit_types", "price_yen"]]) {
      expect((await audits(table, deptId)).at(-1)?.detail).toEqual({ columns: expect.arrayContaining([column]) });
    }
  });

  it("a referenced record cannot be deleted (SE050): a department with a booking", async () => {
    const booking = await prisma.booking.findFirstOrThrow();
    for (const [kind, id] of [["department", booking.departmentId], ["doctor", booking.doctorId], ["visitType", booking.visitTypeId]] as const) {
      const vt = kind === "visitType" ? await prisma.visitType.findUniqueOrThrow({ where: { id } }) : null;
      if (vt && vt.clinicId !== clinicId) continue;
      expect(await json(await postDelete(request("/api/admin/masters/delete", { kind, id, confirmed: true })))).toEqual({ status: 409, body: { code: "SE050", params: {} } });
    }
  });
});

// ── photo ───────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("photo (events 9 / 10, 更新6)", () => {
  const upload = async (bytes: Buffer) =>
    json(await postPhoto(request("/api/admin/photos", undefined, { raw: new Uint8Array(bytes), headers: { "content-type": "application/octet-stream" } })));

  beforeAll(() => as(admin.token));

  it("a wide PNG becomes 400 x 400 and is served from /api/photos; the type is judged by content", async () => {
    const png = await sharp({ create: { width: 300, height: 120, channels: 3, background: "#3366cc" } }).png().toBuffer();
    const r = await upload(png);
    expect(r.status).toBe(200);
    expect(r.body.photoUrl).toMatch(/^\/api\/photos\/[0-9a-f-]{36}\.png$/);
    const url = r.body.photoUrl!;
    const file = url.replace("/api/photos/", "");
    const served = await getPhoto(request(url), { params: Promise.resolve({ file }) });
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(await sharp(Buffer.from(await served.arrayBuffer())).metadata()).toMatchObject({ width: 400, height: 400, format: "png" });
    const jpeg = await upload(await sharp({ create: { width: 800, height: 600, channels: 3, background: "#cc6633" } }).jpeg().toBuffer());
    expect(jpeg.body.photoUrl).toMatch(/\.jpg$/);
  });

  it("not JPEG / PNG, or over 2 MB → SE053 and nothing stored; a bad file name → 404", async () => {
    expect((await upload(Buffer.from("GIF89a not really"))).body).toMatchObject({ code: "SE053", errors: [{ field: "photo", code: "SE053" }] });
    expect((await upload(Buffer.alloc(2 * 1024 * 1024 + 1, 1))).body.code).toBe("SE053");
    const noise = await sharp({ create: { width: 2000, height: 2000, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 60 } } }).png().toBuffer();
    expect(noise.length).toBeGreaterThan(2 * 1024 * 1024);
    expect((await upload(noise)).body.code).toBe("SE053");
    expect((await getPhoto(request("/api/photos/x"), { params: Promise.resolve({ file: "../../etc/passwd" }) })).status).toBe(404);
  });

  it("a doctor saves only a stored photo address", async () => {
    const d = await prisma.department.findFirstOrThrow({ where: { isActive: true } });
    const r = await save(doctorBody([d.id], { code: `${TAG}p`, photoUrl: "/api/photos/00000000-0000-4000-8000-000000000000.png" }));
    expect(r.body.code).toBe("SE090");
  });
});

// ── the form of the receptionist (state ①) ───────────────────────────────────────────────────────────────────────────

describe("A03 form rendering", () => {
  const buttons = (html: string) => [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));

  it("RECEPTION: lists and form, but none of 新規追加 / 保存する / 無効化する / 削除する / 画像を変更 / 削除; inputs read-only", async () => {
    const lists = await loadLists(clinicId);
    const first = lists.doctors.find((d) => d.isActive)!;
    const initial = (await loadDetail("doctor", first.id, clinicId)) as DoctorDetail;
    const html = renderToStaticMarkup(<MastersClient role="RECEPTION" lists={lists} initial={initial} />);
    expect(html).toContain(first.code);
    expect(html).toContain("有効のみ表示");
    const labels = buttons(html);
    for (const forbidden of ["新規追加", "保存する", "無効化する", "有効化する", "削除する", "画像を変更", "削除"]) expect(labels).not.toContain(forbidden);
    expect(html).toContain("readOnly");
    const adminHtml = renderToStaticMarkup(<MastersClient role="ADMIN" lists={lists} initial={initial} />);
    for (const wanted of ["新規追加", "保存する", "無効化する", "削除する", "画像を変更"]) expect(buttons(adminHtml)).toContain(wanted);
  });
});
