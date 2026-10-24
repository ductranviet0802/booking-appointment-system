// B6 レセコンCSV夜間出力 on the slot database: CP932 bytes (decoded and compared), CRLF, quoting, 〓 + warning count, file names,
// export_files values (DONE, +30 days, sha256 of the plain file, stored encrypted), the patient delta from the clinic's latest DONE
// PATIENTS file (a PARTIAL run that produced the clinic's file counts), first run = all, period > 31 days → SE080, a failing
// clinic → no file and PARTIAL, a taken job lock → nothing written, re-run → header-only P file, cancellation handed over once.
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import iconv from "iconv-lite";
import { runJob } from "@/lib/batch/runner";
import { addDays, dbDate, dbTime, todayJst } from "@/lib/datetime";
import { readExportFile } from "@/lib/export/store";
import { pool, prisma } from "@/lib/prisma";
import { fixture, type Fixture } from "./b2-helpers";

process.env.EXPORT_DIR = mkdtempSync(path.join(tmpdir(), "b6-"));
jest.mock("@/lib/export/store", () => {
  const actual = jest.requireActual("@/lib/export/store");
  return { ...actual, storeExportFile: jest.fn(actual.storeExportFile) };
});
import { storeExportFile } from "@/lib/export/store";
const storeMock = storeExportFile as jest.MockedFunction<typeof storeExportFile>;

jest.setTimeout(120_000);

let f: Fixture;
let g: Fixture; // a second clinic of the test's own (the failing one)
const today = todayJst();
const extraPatients: string[] = [];
const runIds: string[] = [];
let seq = 0;

const no = () => `XQ${"ABCDEFGHJK"[Math.floor(seq / 10) % 10]}${"ABCDEFGHJK"[seq % 10]}${String(++seq + 7000).padStart(4, "0")}`; // AAAA0000
async function patient(o: Partial<{ familyName: string; givenName: string; nameType: "JP" | "ROMAJI"; kana: [string, string]; phone: string | null; building: string | null }> = {}) {
  const p = await prisma.patient.create({
    data: {
      nameType: o.nameType ?? "JP", familyName: o.familyName ?? "山田", givenName: o.givenName ?? "花子", familyNameKana: o.kana?.[0] ?? "ヤマダ", givenNameKana: o.kana?.[1] ?? "ハナコ",
      birthDate: dbDate("1985-04-01"), sex: "FEMALE", postcode: "1000005", prefecture: "東京都", city: "千代田区", town: "丸の内", addressLine: "1-1",
      building: o.building === undefined ? "ビル2F" : o.building, phone: o.phone === undefined ? "0312345678" : o.phone, createdByKind: "PATIENT", // (a staff-registered patient needs a phone, patients_phone_required)
    },
  });
  extraPatients.push(p.id);
  return p;
}
async function booking(fx: Fixture, patientId: string, date: string, status: "RESERVED" | "CHECKED_IN" | "NO_SHOW" | "CANCELED" = "RESERVED", channel: "WEB" | "PHONE" | "COUNTER" = "WEB") {
  return prisma.booking.create({
    data: {
      bookingNo: no(), clinicId: fx.clinic.id, departmentId: fx.dept.id, visitTypeId: fx.visitType.id, doctorId: fx.doctors[0].id, doctorRequested: true,
      patientId, channel, slotDate: dbDate(date), startTime: dbTime("09:00"), endTime: dbTime("09:15"), status,
      ...(status === "CANCELED" && { canceledAt: new Date(), canceledByKind: "STAFF" as const, cancelReasonCode: "OTHER" as const, cancelReasonText: "x" }),
    },
  });
}
const run = (o: { clinic?: Fixture | null; dryRun?: boolean; params?: Record<string, unknown>; trigger?: "SCHEDULE" | "MANUAL" } = {}) =>
  runJob("B6", { trigger: o.trigger ?? "SCHEDULE", clinicId: o.clinic === null ? null : (o.clinic ?? f).clinic.id, dryRun: o.dryRun, params: o.params }).then((r) => {
    if (r.run) runIds.push(r.run.id);
    return r;
  });
const files = (fx: Fixture, kind: string) => prisma.exportFile.findMany({ where: { clinicId: fx.clinic.id, kind }, orderBy: { createdAt: "asc" } });
const text = async (storageKey: string) => iconv.decode(await readExportFile(storageKey), "cp932");
const lines = (t: string) => t.split("\r\n").slice(0, -1);

let p1: { id: string };
let p2: { id: string };
let p3: { id: string };

beforeAll(async () => {
  f = await fixture({ doctors: 1 });
  g = await fixture({ doctors: 1 });
  p1 = await patient();
  p2 = await patient({ familyName: "𠮷田", givenName: "太郎", kana: ["ヨシダ", "タロウ"], phone: null, building: null });
  p3 = await patient({ nameType: "ROMAJI", familyName: "Smith", givenName: "Ann", kana: ["すみす", "ｱﾝ"] });
  await prisma.patientCard.create({ data: { patientId: p1.id, clinicId: f.clinic.id, cardNo: "H-100", enteredByKind: "STAFF" } });
  await booking(f, p1.id, today);
  await booking(f, p2.id, addDays(today, 3), "CHECKED_IN", "PHONE");
  await booking(f, p3.id, addDays(today, 6), "NO_SHOW", "COUNTER");
  await booking(f, p3.id, addDays(today, 7)); // outside today … today + 6
  await booking(f, p3.id, today, "CANCELED"); // cancelled, never handed over
});
afterAll(async () => {
  await prisma.exportFile.deleteMany({ where: { OR: [{ clinicId: { in: [f.clinic.id, g.clinic.id] } }, { runId: { in: runIds } }] } });
  await prisma.batchRun.deleteMany({ where: { id: { in: runIds } } });
  for (const x of [f, g]) {
    await prisma.booking.deleteMany({ where: { clinicId: x.clinic.id } });
  }
  await prisma.patientCard.deleteMany({ where: { patientId: { in: extraPatients } } });
  await prisma.patient.deleteMany({ where: { id: { in: extraPatients } } });
  await f.cleanup();
  await g.cleanup();
  await prisma.$disconnect();
  await pool.end();
});

describe("B6", () => {
  it("dry run counts and writes nothing", async () => {
    const r = await run({ dryRun: true });
    expect(r.run).toBeNull();
    expect(r.result).toMatchObject({ status: "SUCCESS", read: 6, written: 0 });
    expect(await files(f, "PATIENTS")).toHaveLength(0);
  });

  it("first run: all patients of the clinic (booking or card), bookings of today … today + 6, no cancelled row", async () => {
    const r = await run();
    expect(r.result).toMatchObject({ status: "SUCCESS", written: 2, message: "患者 3件・予約 3件・外字あり 1件" });
    const [pf] = await files(f, "PATIENTS");
    const [bf] = await files(f, "BOOKINGS");
    expect(pf).toMatchObject({ status: "DONE", trigger: "BATCH", rowCount: 3, warningCount: 1, runId: r.run!.id, createdBy: null });
    expect(pf.fileName).toMatch(new RegExp(`^P_${f.tag}_\\d{8}_\\d{4}\\.csv$`));
    expect(bf.fileName).toMatch(new RegExp(`^B_${f.tag}_\\d{8}_\\d{4}\\.csv$`));
    expect(pf.expiresAt!.getTime() - pf.createdAt.getTime()).toBeGreaterThan(29.99 * 86_400_000);
    expect(pf.expiresAt!.getTime() - pf.createdAt.getTime()).toBeLessThan(30.01 * 86_400_000);
    expect(bf).toMatchObject({ rowCount: 3, warningCount: 0, periodFrom: dbDate(today), periodTo: dbDate(addDays(today, 6)) });
    expect(pf.changedSince!.getTime()).toBe(0);

    const raw = await readExportFile(pf.storageKey!);
    expect((await import("node:crypto")).createHash("sha256").update(raw).digest("hex")).toBe(pf.sha256);
    expect(readdirSync(process.env.EXPORT_DIR!).some((n) => n.endsWith(pf.fileName))).toBe(true);
    // CP932 bytes: 〓 is 0x81AC, the header is Japanese, CRLF, every field quoted
    expect(raw.includes(Buffer.from([0x81, 0xac]))).toBe(true);
    const out = lines(iconv.decode(raw, "cp932"));
    expect(out[0]).toBe('"診察券番号","システム患者ID","氏名","氏名カナ","性別","生年月日","郵便番号","住所","電話番号","区分","更新日時"');
    expect(out).toHaveLength(4);
    const byId = (id: string) => out.find((l) => l.includes(id))!;
    expect(byId(p1.id)).toMatch(new RegExp(`^"H-100","${p1.id}","山田　花子","ヤマダ　ハナコ","2","19850401","100-0005","東京都千代田区丸の内1-1　ビル2F","03-1234-5678","新規","\\d{4}/\\d\\d/\\d\\d \\d\\d:\\d\\d"$`));
    expect(byId(p2.id)).toMatch(new RegExp(`^"","${p2.id}","〓田　太郎","ヨシダ　タロウ","2","19850401","100-0005","東京都千代田区丸の内1-1","","新規",`));
    expect(byId(p3.id)).toContain('"ＳＭＩＴＨ　ＡＮＮ","スミス　アン"');

    const b = lines(await text(bf.storageKey!));
    expect(b[0]).toBe('"予約番号","予約日","開始時刻","終了時刻","診療科コード","診療区分コード","診療区分名称","区分","医師コード","医師名","診察券番号","システム患者ID","氏名カナ","状態","経路","問診有無"');
    expect(b).toHaveLength(4);
    const d = (n: number) => addDays(today, n).replaceAll("-", "");
    expect(b[1]).toMatch(new RegExp(`^"XQ[A-Z]{2}\\d{4}","${d(0)}","0900","0915","${f.tag}","T","再診","再診","${f.tag}d0","医0試験","H-100","${p1.id}","ヤマダ　ハナコ","予約済","Web","無"$`));
    expect(b[2]).toContain(`"${d(3)}"`);
    expect(b[2]).toContain('"来院済","電話","無"');
    expect(b[3]).toContain('"無断キャンセル","窓口"');
    expect(b.join("")).not.toContain("キャンセル済");
  });

  it("re-run: a new header-only P file (nothing changed since the first run); B file again; the cancellation is sent once", async () => {
    const [first] = await files(f, "PATIENTS");
    const firstRun = await prisma.batchRun.findUniqueOrThrow({ where: { id: first.runId! } });
    await prisma.booking.updateMany({ where: { clinicId: f.clinic.id, patientId: p1.id }, data: { status: "CANCELED", canceledAt: new Date(), canceledByKind: "STAFF", cancelReasonCode: "OTHER", cancelReasonText: "x" } });
    const r = await run({ trigger: "MANUAL", params: { kind: "BOTH", createdBy: f.admin.id } });
    expect(r.result.status).toBe("SUCCESS");
    const ps = await files(f, "PATIENTS");
    expect(ps).toHaveLength(2);
    expect(ps[1]).toMatchObject({ rowCount: 0, trigger: "MANUAL", createdBy: f.admin.id });
    expect(ps[1].changedSince).toEqual(firstRun.startedAt);
    expect(lines(await text(ps[1].storageKey!))).toHaveLength(1); // header only, still produced (05 X5 empty result)
    const bs = await files(f, "BOOKINGS");
    const rows = lines(await text(bs[1].storageKey!));
    expect(rows.filter((l) => l.includes("キャンセル済"))).toHaveLength(1);
    expect(bs[1].rowCount).toBe(3); // p1's cancelled booking + the two others
    await run({ trigger: "MANUAL" });
    const again = await files(f, "BOOKINGS");
    expect(again[2].rowCount).toBe(2); // handed over, not sent again
  });

  it("a manual file of another period does not hand a cancellation over (judge W5 B-1)", async () => {
    const b = await booking(f, p2.id, addDays(today, 5));
    await run({ trigger: "MANUAL", params: { kind: "BOOKINGS" } }); // carries the booking
    await prisma.booking.update({ where: { id: b.id }, data: { status: "CANCELED", canceledAt: new Date(), canceledByKind: "STAFF", cancelReasonCode: "OTHER", cancelReasonText: "x" } });
    await run({ trigger: "MANUAL", params: { kind: "BOOKINGS", periodFrom: today, periodTo: today } }); // today only
    await run({ trigger: "MANUAL", params: { kind: "BOOKINGS" } });
    const bs = await files(f, "BOOKINGS");
    const cancels = async (i: number) => lines(await text(bs[i].storageKey!)).filter((l) => l.includes("キャンセル済")).length;
    expect(await cancels(bs.length - 2)).toBe(0); // the today-only file
    expect(await cancels(bs.length - 1)).toBe(1); // the next full file still sends it
  });

  it("patient delta: a changed patient is a 変更 row", async () => {
    await prisma.patient.update({ where: { id: p2.id }, data: { phone: "09011112222" } });
    const bBefore = (await files(f, "BOOKINGS")).length;
    await run({ trigger: "MANUAL", params: { kind: "PATIENTS" } });
    const ps = await files(f, "PATIENTS");
    const last = ps[ps.length - 1];
    const rows = lines(await text(last.storageKey!));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain(`"${p2.id}"`);
    expect(rows[1]).toContain('"090-1111-2222","変更"');
    expect((await files(f, "BOOKINGS")).length).toBe(bBefore); // kind PATIENTS wrote no B file
  });

  it("period over 31 days → SE080 (FAILED, nothing written); exactly 31 days is accepted", async () => {
    const before = await prisma.exportFile.count({ where: { clinicId: f.clinic.id } });
    const bad = await run({ trigger: "MANUAL", params: { kind: "BOOKINGS", periodFrom: today, periodTo: addDays(today, 31) } });
    expect(bad.result.status).toBe("FAILED");
    expect(bad.result.message).toContain("SE080");
    expect(await prisma.exportFile.count({ where: { clinicId: f.clinic.id } })).toBe(before);
    const ok = await run({ trigger: "MANUAL", params: { kind: "BOOKINGS", periodFrom: today, periodTo: addDays(today, 30) } });
    expect(ok.result.status).toBe("SUCCESS");
    const wrong = await run({ trigger: "MANUAL", params: { kind: "BOOKINGS", periodFrom: addDays(today, 3), periodTo: today } });
    expect(wrong.result.status).toBe("FAILED");
  });

  it("a failing clinic writes no file at all (the first file already stored is removed) → FAILED", async () => {
    const storedBefore = readdirSync(process.env.EXPORT_DIR!).length;
    const rowsBefore = await prisma.exportFile.count({ where: { clinicId: g.clinic.id } });
    const gp = await patient();
    await booking(g, gp.id, today);
    storeMock.mockImplementationOnce(((...a) => (jest.requireActual("@/lib/export/store") as { storeExportFile: typeof storeExportFile }).storeExportFile(...a)) as typeof storeExportFile);
    storeMock.mockRejectedValueOnce(new Error("disk full"));
    const r = await run({ clinic: g, trigger: "MANUAL" });
    expect(r.result).toMatchObject({ status: "FAILED", errors: 1 });
    expect(r.result.message).toContain("disk full");
    expect(await prisma.exportFile.count({ where: { clinicId: g.clinic.id } })).toBe(rowsBefore);
    expect(readdirSync(process.env.EXPORT_DIR!).length).toBe(storedBefore);
  });

  it("one clinic failing among several → PARTIAL; the other clinics keep their files; the delta then starts at the PARTIAL run", async () => {
    storeMock.mockImplementation(((name: string, bytes: Uint8Array) => {
      if (name.includes(g.tag)) return Promise.reject(new Error("boom"));
      return (jest.requireActual("@/lib/export/store") as { storeExportFile: typeof storeExportFile }).storeExportFile(name, bytes);
    }) as typeof storeExportFile);
    const r = await run({ clinic: null });
    storeMock.mockReset();
    storeMock.mockImplementation(((...a) => (jest.requireActual("@/lib/export/store") as { storeExportFile: typeof storeExportFile }).storeExportFile(...a)) as typeof storeExportFile);
    expect(r.result.status).toBe("PARTIAL");
    expect(r.result.errors).toBe(1);
    expect(await prisma.exportFile.count({ where: { clinicId: g.clinic.id, runId: r.run!.id } })).toBe(0);
    expect(await prisma.exportFile.count({ where: { clinicId: f.clinic.id, runId: r.run!.id } })).toBe(2);
    // g has no file of this run, so its next delta is still "all"; f's starts at the PARTIAL run
    await run({ trigger: "MANUAL", params: { kind: "PATIENTS" } });
    const ps = await files(f, "PATIENTS");
    expect(ps[ps.length - 1].changedSince).toEqual(r.run!.startedAt);
    await prisma.exportFile.deleteMany({ where: { runId: r.run!.id } }); // the seeded clinics' files of the all-clinics run
  });

  it("job lock taken → SUCCESS 「実行中のため省略」, nothing written", async () => {
    const before = await prisma.exportFile.count({ where: { clinicId: f.clinic.id } });
    const holder = await pool.connect();
    try {
      await holder.query("SELECT pg_advisory_lock(hashtext('batch:B6'))");
      const r = await run({ trigger: "MANUAL" });
      expect(r.result).toMatchObject({ status: "SUCCESS", written: 0, message: "実行中のため省略" });
    } finally {
      await holder.query("SELECT pg_advisory_unlock(hashtext('batch:B6'))");
      holder.release();
    }
    expect(await prisma.exportFile.count({ where: { clinicId: f.clinic.id } })).toBe(before);
  });
});
