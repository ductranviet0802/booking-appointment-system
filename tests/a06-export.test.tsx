// A06 CSV出力: access per role (page and routes), DISCLOSURE rows admin only (list and download by id), clinic scope of a file id,
// download audit + count + sha256 check, expired / BUILDING / unknown refusals, stale BUILDING → FAILED on open, SE082 / SE083 /
// item 1 / item 4 states, 出力する (SI080 / SI081 / SE080 / SE002 / SE001 / SE084 / SE090).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { guardScreen } from "@/lib/auth/context";
import { loadExportState } from "@/lib/admin/export";
import { checkPeriod } from "@/lib/admin/export-rules";
import { runJob } from "@/lib/batch/runner";
import { dbDate, dbTime, todayJst } from "@/lib/datetime";
import { storeExportFile } from "@/lib/export/store";
import { pool, prisma } from "@/lib/prisma";
import { cleanupStaff, makeStaff, request } from "./a03-helpers";
import { fixture, type Fixture } from "./b2-helpers";

process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
process.env.EXPORT_DIR = mkdtempSync(path.join(tmpdir(), "a06-"));
const mockJar: { sid?: string; path: string } = { path: "/admin/export" };
jest.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sid" && mockJar.sid ? { value: mockJar.sid } : undefined) }),
  headers: async () => ({ get: (n: string) => (n === "x-pathname" ? mockJar.path : null) }),
}));
jest.mock("../app/(staff)/admin/export/export.module.css", () => ({}));
jest.mock("@/components/ui/Toast", () => ({ useToast: () => ({ toast: jest.fn() }), useLang: () => "ja" }));
jest.mock("@/lib/client/api", () => ({ useApiFetch: () => jest.fn(), postJson: jest.fn(), openStaffErrorScreen: jest.fn() }));

import { GET as getDownload } from "@/app/api/admin/export/download/route";
import { POST as postRun } from "@/app/api/admin/export/run/route";
import { GET as getState } from "@/app/api/admin/export/state/route";
import { ExportClient } from "@/app/(staff)/admin/export/ExportClient";

jest.setTimeout(120_000);

let f: Fixture;
let g: Fixture;
let admin: Awaited<ReturnType<typeof makeStaff>>;
let reception: Awaited<ReturnType<typeof makeStaff>>;
let doctor: Awaited<ReturnType<typeof makeStaff>>;
let recG: Awaited<ReturnType<typeof makeStaff>>;
const as = (t: string | undefined) => { mockJar.sid = t; };
const today = todayJst();
const runIds: string[] = [];

type Body = { code?: string; ok?: boolean; outcome?: { code: string; params?: Record<string, string> }; errors?: { field: string; code: string }[]; state?: Awaited<ReturnType<typeof loadExportState>> };
const post = async (b: unknown) => {
  const res = await postRun(request("/api/admin/export/run", b));
  return { status: res.status, body: (await res.json()) as Body };
};
const state = async () => ((await (await getState(request("/api/admin/export/state"))).json()) as Body).state!;
const dl = (id: string) => getDownload(request(`/api/admin/export/download?id=${id}`));
const rowOf = async (kind: string, fx = f) => prisma.exportFile.findFirstOrThrow({ where: { clinicId: fx.clinic.id, kind }, orderBy: { createdAt: "desc" } });
async function disclosure(o: { status: string; createdAt?: Date; expiresAt?: Date | null; patientId?: string; clinic?: Fixture; withFile?: boolean }) {
  const stored = o.status === "DONE" ? await storeExportFile("DISCLOSURE_x.zip", Buffer.from("PK-fake-zip")) : null; // ef_done_file: a DONE row has its file
  return prisma.exportFile.create({
    data: {
      clinicId: (o.clinic ?? f).clinic.id, kind: "DISCLOSURE", trigger: "MANUAL", status: o.status, patientId: o.patientId ?? f.patient.id,
      fileName: `DISCLOSURE_${o.patientId ?? f.patient.id}_20261024${String(Math.floor(Math.random() * 9000) + 1000)}.zip`, createdBy: admin.account.id,
      ...(o.createdAt && { createdAt: o.createdAt }), expiresAt: o.expiresAt === undefined ? (o.status === "BUILDING" ? null : new Date(Date.now() + 86_400_000)) : o.expiresAt,
      ...(stored && { storageKey: stored.storageKey, sha256: stored.sha256, rowCount: 3, warningCount: 0 }),
    },
  });
}

beforeAll(async () => {
  f = await fixture({ doctors: 1 });
  g = await fixture({ doctors: 1 });
  admin = await makeStaff("ADMIN", { clinics: [f.tag] });
  reception = await makeStaff("RECEPTION", { clinics: [f.tag] });
  doctor = await makeStaff("DOCTOR", { clinics: [f.tag] });
  recG = await makeStaff("RECEPTION", { clinics: [g.tag] });
  await prisma.patient.update({ where: { id: f.patient.id }, data: { familyName: "𠮷田" } });
  await prisma.booking.create({
    data: {
      bookingNo: "XRAA7001", clinicId: f.clinic.id, departmentId: f.dept.id, visitTypeId: f.visitType.id, doctorId: f.doctors[0].id, doctorRequested: true,
      patientId: f.patient.id, channel: "WEB", slotDate: dbDate(today), startTime: dbTime("09:00"), endTime: dbTime("09:15"),
    },
  });
  const r = await runJob("B6", { trigger: "SCHEDULE", clinicId: f.clinic.id });
  runIds.push(r.run!.id);
});
afterAll(async () => {
  await prisma.exportFile.deleteMany({ where: { clinicId: { in: [f.clinic.id, g.clinic.id] } } });
  await prisma.batchRun.deleteMany({ where: { id: { in: runIds } } });
  await f.cleanup();
  await g.cleanup();
  await cleanupStaff();
  await prisma.$disconnect();
  await pool.end();
});

describe("rules", () => {
  it("period checks: SE001 empty (spaces = empty), SE002 invalid / reversed, SE080 over 31 days inclusive; PATIENTS needs no period", () => {
    const codes = (k: "BOTH" | "PATIENTS", a: string, b: string) => checkPeriod(k, a, b).map((e) => `${e.field}:${e.code}`);
    expect(codes("BOTH", "2026/10/24", "2026/10/30")).toEqual([]);
    expect(codes("BOTH", " ", "")).toEqual(["from:SE001", "to:SE001"]);
    expect(codes("BOTH", "2026-10-24", "2026/02/30")).toEqual(["from:SE002", "to:SE002"]);
    expect(codes("BOTH", "2026/10/24", "2026/10/23")).toEqual(["to:SE002"]);
    expect(codes("BOTH", "2026/10/01", "2026/10/31")).toEqual([]); // 31 days
    expect(codes("BOTH", "2026/10/01", "2026/11/01")).toEqual(["to:SE080"]); // 32 days
    expect(codes("PATIENTS", "", "x")).toEqual([]);
  });
});

describe("access", () => {
  async function outcome(sid: string | undefined) {
    as(sid);
    try {
      await guardScreen("A06");
      return "allow";
    } catch (e) {
      const d = (e as { digest?: string }).digest ?? "";
      return d.startsWith("NEXT_REDIRECT") ? "redirect" : d.startsWith("NEXT_HTTP_ERROR_FALLBACK") ? `http:${d.split(";")[1]}` : "other";
    }
  }

  it("page: RECEPTION and ADMIN in; DOCTOR → ER-03; anonymous → login", async () => {
    expect(await outcome(admin.token)).toBe("allow");
    expect(await outcome(reception.token)).toBe("allow");
    expect(await outcome(doctor.token)).toBe("http:403");
    expect(await outcome(undefined)).toBe("redirect");
  });

  it("routes: DOCTOR 403 SE091 on all three and nothing runs; anonymous 401", async () => {
    const before = await prisma.exportFile.count({ where: { clinicId: f.clinic.id } });
    const file = await rowOf("PATIENTS");
    as(doctor.token);
    expect((await post({ kind: "BOTH", from: "2026/10/24", to: "2026/10/25" })).status).toBe(403);
    expect((await getState(request("/api/admin/export/state"))).status).toBe(403);
    expect((await dl(file.id)).status).toBe(403);
    as(undefined);
    expect((await post({ kind: "BOTH", from: "2026/10/24", to: "2026/10/25" })).status).toBe(401);
    expect((await dl(file.id)).status).toBe(401);
    expect(await prisma.exportFile.count({ where: { clinicId: f.clinic.id } })).toBe(before);
    expect((await prisma.exportFile.findUniqueOrThrow({ where: { id: file.id } })).downloadCount).toBe(0);
  });
});

describe("list and download", () => {
  it("reception sees the X5 files only; admin also the DISCLOSURE rows; newest first; DISCLOSURE count 「—」; 作成者 「システム」 for the nightly run", async () => {
    const done = await disclosure({ status: "DONE", withFile: true });
    as(reception.token);
    const r = await state();
    expect(r.rows.map((x) => x.kind).sort()).toEqual(["BOOKINGS", "PATIENTS"]);
    expect(r.rows.every((x) => x.creator === "システム" && x.tag === "BATCH")).toBe(true);
    const p = r.rows.find((x) => x.kind === "PATIENTS")!;
    expect(p).toMatchObject({ period: "差分", count: "1", warnings: 1, status: "DONE" });
    expect(r.rows.find((x) => x.kind === "BOOKINGS")!.period).toMatch(/^\d\d\/\d\d〜\d\d\/\d\d$/);
    as(admin.token);
    const a = await state();
    const d = a.rows.find((x) => x.id === done.id)!;
    expect(d).toMatchObject({ kind: "DISCLOSURE", tag: "DISCLOSURE", status: "DONE", count: "—", period: "全期間・法人全院", creator: "試験 職員" });
    const times = a.rows.map((x) => x.id);
    expect(times[0]).toBe(done.id); // created last
  });

  it("download: X5 file by reception — bytes, count + 1 and one CSV_DOWNLOAD audit row (kind, no content); a second download counts again", async () => {
    as(reception.token);
    const file = await rowOf("PATIENTS");
    const res = await dl(file.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain(file.fileName);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 4).toString("latin1")).toContain('"');
    await dl(file.id);
    expect((await prisma.exportFile.findUniqueOrThrow({ where: { id: file.id } })).downloadCount).toBe(2);
    const logs = await prisma.auditLog.findMany({ where: { action: "CSV_DOWNLOAD", targetId: file.id } });
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ targetType: "export_files", clinicId: f.clinic.id, accountId: reception.account.id, role: "RECEPTION", detail: { kind: "PATIENTS" } });
  });

  it("DISCLOSURE: reception refused by id (403 SE091, not counted, not audited); admin downloads, audit detail has the patient", async () => {
    const d = await disclosure({ status: "DONE", withFile: true });
    as(reception.token);
    const no = await dl(d.id);
    expect(no.status).toBe(403);
    expect(((await no.json()) as Body).code).toBe("SE091");
    expect(await prisma.auditLog.count({ where: { action: "CSV_DOWNLOAD", targetId: d.id } })).toBe(0);
    expect((await prisma.exportFile.findUniqueOrThrow({ where: { id: d.id } })).downloadCount).toBe(0);
    as(admin.token);
    const ok = await dl(d.id);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/zip");
    expect(Buffer.from(await ok.arrayBuffer()).toString()).toBe("PK-fake-zip");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "CSV_DOWNLOAD", targetId: d.id } });
    expect(log.detail).toEqual({ kind: "DISCLOSURE", patientId: f.patient.id });
  });

  it("another clinic's file id → 403; unknown / malformed / expired id → 404; BUILDING / FAILED → 409; a tampered object → 500 SE090 — nothing counted or audited", async () => {
    const other = await runJob("B6", { trigger: "MANUAL", clinicId: g.clinic.id });
    runIds.push(other.run!.id);
    const gFile = await rowOf("PATIENTS", g);
    as(reception.token);
    expect((await dl(gFile.id)).status).toBe(403);
    expect((await dl("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await dl("nope")).status).toBe(404);
    const expired = await rowOf("BOOKINGS");
    await prisma.exportFile.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await dl(expired.id)).status).toBe(404);
    as(admin.token);
    const building = await disclosure({ status: "BUILDING" });
    const failed = await disclosure({ status: "FAILED" });
    expect((await dl(building.id)).status).toBe(409);
    expect((await dl(failed.id)).status).toBe(409);
    const bad = await disclosure({ status: "DONE", withFile: true });
    await prisma.exportFile.update({ where: { id: bad.id }, data: { sha256: "0".repeat(64) } });
    expect((await dl(bad.id)).status).toBe(500);
    for (const id of [gFile.id, expired.id, building.id, failed.id, bad.id]) {
      expect(await prisma.auditLog.count({ where: { action: "CSV_DOWNLOAD", targetId: id } })).toBe(0);
    }
    const expiredRow = await state();
    expect(expiredRow.rows.some((x) => x.id === expired.id)).toBe(false); // the row leaves the list when expired
  });
});

describe("DISCLOSURE states", () => {
  it("a BUILDING row older than 1 hour is set FAILED when anyone opens A06 (expires_at = now + 30 days); a younger one stays", async () => {
    const stale = await disclosure({ status: "BUILDING", createdAt: new Date(Date.now() - 2 * 3_600_000) });
    const young = await disclosure({ status: "BUILDING", createdAt: new Date(Date.now() - 30 * 60_000) });
    as(reception.token); // whoever opens
    await state();
    const s = await prisma.exportFile.findUniqueOrThrow({ where: { id: stale.id } });
    expect(s.status).toBe("FAILED");
    expect(s.expiresAt!.getTime() - Date.now()).toBeGreaterThan(29.9 * 86_400_000);
    expect((await prisma.exportFile.findUniqueOrThrow({ where: { id: young.id } })).status).toBe("BUILDING");
  });

  it("SE083 only on a FAILED row without a later BUILDING / DONE row of the same patient (any clinic); admin only; {日時} = expires_at − 30 days", async () => {
    const p = await prisma.patient.create({
      data: { nameType: "JP", familyName: "開示", givenName: "太郎", familyNameKana: "カイジ", givenNameKana: "タロウ", birthDate: dbDate("1980-01-01"), sex: "MALE", postcode: "1000001", prefecture: "東京都", city: "千代田区", addressLine: "1", createdByKind: "PATIENT" },
    });
    try {
      const failedAt = new Date(Date.now() - 3 * 86_400_000);
      const a = await disclosure({ status: "FAILED", patientId: p.id, createdAt: new Date(Date.now() - 4 * 86_400_000), expiresAt: new Date(failedAt.getTime() + 30 * 86_400_000) });
      as(admin.token);
      let row = (await state()).rows.find((x) => x.id === a.id)!;
      expect(row.status).toBe("FAILED");
      expect(row.se083).toMatch(/^\d\d\/\d\d \d\d:\d\d$/);
      as(reception.token);
      expect((await state()).rows.find((x) => x.id === a.id)).toBeUndefined();
      await disclosure({ status: "DONE", patientId: p.id, clinic: g }); // a later request of another clinic silences it too
      as(admin.token);
      row = (await state()).rows.find((x) => x.id === a.id)!;
      expect(row.se083).toBeNull();
      expect(row.status).toBe("FAILED"); // the failed row itself stays listed
    } finally {
      await prisma.exportFile.deleteMany({ where: { patientId: p.id } });
      await prisma.patient.delete({ where: { id: p.id } });
    }
  });
});

describe("page state", () => {
  const nightly = (clinic: Fixture, status: "SUCCESS" | "PARTIAL" | "FAILED" | "RUNNING", at: Date, message = "患者 1件・予約 2件・外字あり 0件") =>
    prisma.batchRun.create({ data: { jobCode: "B6", trigger: "SCHEDULE", clinicId: clinic.clinic.id, startedAt: at, endedAt: at, status, readCount: 0, writtenCount: 0, errorCount: 0, message } });

  it("item 1: none → 実績なし; SUCCESS → 正常終了（message）; FAILED → SE082; PARTIAL without a file of the clinic → SE082, with a file → 正常終了", async () => {
    const x = await fixture({ doctors: 1 });
    try {
      expect((await loadExportState(x.clinic.id, "ADMIN")).last).toEqual({ text: "夜間出力の実績はありません", failedAt: null });
      const t0 = Date.now() - 4 * 3_600_000;
      await nightly(x, "SUCCESS", new Date(t0));
      expect((await loadExportState(x.clinic.id, "ADMIN")).last.text).toMatch(/^\d\d\/\d\d \d\d:\d\d 正常終了（患者 1件・予約 2件・外字あり 0件）$/);
      await nightly(x, "FAILED", new Date(t0 + 1000));
      expect((await loadExportState(x.clinic.id, "ADMIN")).last.failedAt).toMatch(/^\d\d\/\d\d \d\d:\d\d$/);
      const partial = await nightly(x, "PARTIAL", new Date(t0 + 2000), "患者 0件・予約 0件・外字あり 0件／失敗 other: boom");
      expect((await loadExportState(x.clinic.id, "ADMIN")).last.failedAt).not.toBeNull();
      await prisma.exportFile.create({ data: { clinicId: x.clinic.id, kind: "PATIENTS", trigger: "BATCH", status: "DONE", fileName: "P_x.csv", runId: partial.id, storageKey: "x", sha256: "0".repeat(64), rowCount: 0, warningCount: 0, changedSince: new Date(0), expiresAt: new Date(Date.now() + 86_400_000) } });
      const last = (await loadExportState(x.clinic.id, "ADMIN")).last;
      expect(last.failedAt).toBeNull();
      expect(last.text).toMatch(/正常終了（患者 0件・予約 0件・外字あり 0件）$/); // failures of other clinics are not shown
      await nightly(x, "RUNNING", new Date(t0 + 3000));
      expect((await loadExportState(x.clinic.id, "ADMIN")).last.text).toContain("実行中");
    } finally {
      await prisma.exportFile.deleteMany({ where: { clinicId: x.clinic.id } });
      await x.cleanup();
    }
  });

  it("item 4: the start of the run of the latest DONE PATIENTS file, else 全件（初回出力）", async () => {
    expect((await loadExportState(f.clinic.id, "ADMIN")).since).toMatch(/^\d{4}\/\d\d\/\d\d \d\d:\d\d 以降の変更分（前回の正常出力から・変更不可）$/);
    const x = await fixture({ doctors: 1 });
    try {
      expect((await loadExportState(x.clinic.id, "ADMIN")).since).toBe("全件（初回出力）");
    } finally {
      await x.cleanup();
    }
  });

  it("the client: list, 外字あり 1件, ダウンロード only on 完了 rows, SE082 box, ファイルなし", async () => {
    as(admin.token);
    await disclosure({ status: "BUILDING" });
    const s = await loadExportState(f.clinic.id, "ADMIN");
    const html = renderToStaticMarkup(<ExportClient initial={s} />);
    expect(html).toContain("CSV出力（レセコン連携）");
    expect(html).toContain("外字あり 1件");
    expect(html).toContain("作成中");
    expect((html.match(/>ダウンロード</g) ?? []).length).toBe(s.rows.filter((r) => r.status === "DONE").length);
    expect(html).toContain("開示用");
    const failed = renderToStaticMarkup(<ExportClient initial={{ ...s, rows: [], last: { text: "", failedAt: "10/20 05:30" } }} />);
    expect(failed).toContain("前回の夜間CSV出力が失敗しています（10/20 05:30）");
    expect(failed).toContain("ファイルはありません");
  });
});

describe("出力する", () => {
  it("BOTH by reception: files of the session clinic with created_by + MANUAL trigger, SI080 「患者 a件・予約 b件」", async () => {
    as(reception.token);
    const r = await post({ kind: "BOTH", from: `${today.replaceAll("-", "/")}`, to: `${today.replaceAll("-", "/")}` });
    expect(r.body.outcome).toEqual({ code: "SI080", params: { 件数: "患者 0件・予約 1件" } });
    const p = await rowOf("PATIENTS");
    expect(p).toMatchObject({ trigger: "MANUAL", createdBy: reception.account.id, rowCount: 0 });
    expect((await state()).rows[0].creator).toBe("試験 職員");
  });

  it("only a header-only result → SI081; PATIENTS needs no period; checks: SE001 / SE002 / SE080 / bad kind, nothing written", async () => {
    as(recG.token);
    expect((await post({ kind: "PATIENTS", from: "", to: "" })).body.outcome).toEqual({ code: "SI081" });
    expect((await post({ kind: "BOTH", from: "", to: "" })).body.errors!.map((e) => e.code)).toEqual(["SE001", "SE001"]);
    const before = await prisma.exportFile.count({ where: { clinicId: g.clinic.id } });
    expect((await post({ kind: "BOOKINGS", from: "2026/10/01", to: "2026/11/05" })).body.errors![0].code).toBe("SE080");
    expect((await post({ kind: "BOOKINGS", from: "2026/13/01", to: "2026/11/05" })).body.errors![0].code).toBe("SE002");
    expect((await post({ kind: "ALL", from: "2026/10/01", to: "2026/10/02" })).body.code).toBe("SE090");
    expect(await prisma.exportFile.count({ where: { clinicId: g.clinic.id } })).toBe(before);
  });

  it("job lock taken → SE084, no file; a failing job → SE090 and no file", async () => {
    as(reception.token);
    const before = await prisma.exportFile.count({ where: { clinicId: f.clinic.id } });
    const holder = await pool.connect();
    try {
      await holder.query("SELECT pg_advisory_lock(hashtext('batch:B6'))");
      expect((await post({ kind: "BOTH", from: "2026/10/24", to: "2026/10/25" })).body.outcome).toEqual({ code: "SE084" });
    } finally {
      await holder.query("SELECT pg_advisory_unlock(hashtext('batch:B6'))");
      holder.release();
    }
    expect(await prisma.exportFile.count({ where: { clinicId: f.clinic.id } })).toBe(before);
    const spy = jest.spyOn(prisma.exportFile, "createMany").mockRejectedValueOnce(new Error("db down"));
    expect((await post({ kind: "BOTH", from: "2026/10/24", to: "2026/10/25" })).body.outcome).toEqual({ code: "SE090" });
    spy.mockRestore();
    expect(await prisma.exportFile.count({ where: { clinicId: f.clinic.id } })).toBe(before);
  });
});
