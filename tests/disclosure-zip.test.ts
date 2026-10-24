// S03 開示用データ: the ZIP writer read back through its central directory (names, UTF-8 flag, CRC-32, inflate), and the builder —
// contents of one patient at all clinics (profile, 診察券, bookings with notes decrypted, 問診 still held, notifications, consents,
// nothing of other patients, no audit entries), DONE values, FAILED path, a finished build after A06 set the row FAILED.
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomFillSync } from "node:crypto";
import { crc32, inflateRawSync } from "node:zlib";
import { buildDisclosure, startDisclosureBuild } from "@/lib/export/disclosure";
import { zipFiles } from "@/lib/export/zip";
import { encryptJson, encryptText } from "@/lib/crypto/field";
import { addDays, dbDate, dbTime, todayJst } from "@/lib/datetime";
import { readExportFile } from "@/lib/export/store";
import { pool, prisma } from "@/lib/prisma";
import { fixture, type Fixture } from "./b2-helpers";

process.env.EXPORT_DIR = mkdtempSync(path.join(tmpdir(), "disc-"));
jest.mock("@/lib/export/store", () => {
  const actual = jest.requireActual("@/lib/export/store");
  return { ...actual, storeExportFile: jest.fn(actual.storeExportFile) };
});
import { storeExportFile } from "@/lib/export/store";
const storeMock = storeExportFile as jest.MockedFunction<typeof storeExportFile>;

jest.setTimeout(60_000);

/** reads an archive back through the central directory */
function readZip(buf: Buffer) {
  const end = buf.length - 22;
  expect(buf.readUInt32LE(end)).toBe(0x06054b50);
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, { data: Buffer; flags: number }>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    expect(buf.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + csize);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    expect(data.length).toBe(usize);
    expect(crc32(data)).toBe(crc);
    out.set(name, { data, flags });
    p += 46 + nlen;
  }
  return out;
}

describe("zip writer", () => {
  it("round trip: UTF-8 names (flag set), deflated text, stored incompressible bytes, an empty file, CRC-32 and sizes", () => {
    const noise = Buffer.alloc(2000);
    randomFillSync(noise);
    const text = Buffer.from("患者,予約\r\n".repeat(500), "utf8");
    const zip = zipFiles([
      { name: "profile.csv", data: text },
      { name: "日本語/ファイル.csv", data: Buffer.from("あ") },
      { name: "noise.bin", data: noise },
      { name: "empty.csv", data: new Uint8Array(0) },
    ]);
    expect(zip.length).toBeLessThan(text.length + noise.length); // the text really is deflated
    const files = readZip(zip);
    expect([...files.keys()]).toEqual(["profile.csv", "日本語/ファイル.csv", "noise.bin", "empty.csv"]);
    expect(files.get("profile.csv")!.data.equals(text)).toBe(true);
    expect(files.get("日本語/ファイル.csv")!.data.toString()).toBe("あ");
    expect(files.get("noise.bin")!.data.equals(noise)).toBe(true);
    expect(files.get("empty.csv")!.data.length).toBe(0);
    for (const f of files.values()) expect(f.flags & 0x0800).toBe(0x0800);
  });
});

let f: Fixture;
let g: Fixture;
let other: { id: string };
const today = todayJst();
const rows: string[] = [];

beforeAll(async () => {
  f = await fixture({ doctors: 1 });
  g = await fixture({ doctors: 1 });
  other = await prisma.patient.create({
    data: { nameType: "JP", familyName: "他人", givenName: "太郎", familyNameKana: "タニン", givenNameKana: "タロウ", birthDate: dbDate("1970-01-01"), sex: "MALE", postcode: "1000001", prefecture: "東京都", city: "千代田区", addressLine: "9", createdByKind: "PATIENT" },
  });
});
afterAll(async () => {
  await prisma.exportFile.deleteMany({ where: { id: { in: rows } } });
  for (const x of [f, g]) {
    await prisma.notification.deleteMany({ where: { patientId: { in: [x.patient.id, other.id] } } });
    await prisma.booking.deleteMany({ where: { clinicId: x.clinic.id } });
    await prisma.patientCard.deleteMany({ where: { clinicId: x.clinic.id } });
  }
  await prisma.consent.deleteMany({ where: { accountId: f.patient.accountId! } });
  await prisma.patient.delete({ where: { id: other.id } });
  await f.cleanup();
  await g.cleanup();
  await prisma.$disconnect();
  await pool.end();
});

const bk = (fx: Fixture, patientId: string, no: string, o: { notes?: string } = {}) =>
  prisma.booking.create({
    data: {
      bookingNo: no, clinicId: fx.clinic.id, departmentId: fx.dept.id, visitTypeId: fx.visitType.id, doctorId: fx.doctors[0].id, doctorRequested: true, patientId,
      channel: "WEB", slotDate: dbDate(addDays(today, 1)), startTime: dbTime("09:00"), endTime: dbTime("09:15"), ...(o.notes && { notes: encryptText(o.notes) }),
    },
  });
async function request(patientId: string) {
  const r = await prisma.exportFile.create({
    data: { clinicId: f.clinic.id, kind: "DISCLOSURE", trigger: "MANUAL", status: "BUILDING", patientId, fileName: `DISCLOSURE_${patientId}_202610241200.zip`, createdBy: f.admin.id },
  });
  rows.push(r.id);
  return r;
}

describe("builder", () => {
  it("DONE: the patient's data of both clinics in six UTF-8 CSV files; row count, sha256, +30 days; nothing of other patients; no audit file", async () => {
    const pid = f.patient.id;
    await prisma.patientCard.createMany({ data: [{ patientId: pid, clinicId: f.clinic.id, cardNo: "F-1", enteredByKind: "STAFF" }, { patientId: pid, clinicId: g.clinic.id, cardNo: "G-1", enteredByKind: "STAFF" }] });
    const b1 = await bk(f, pid, "DZAA0001", { notes: "付き添いあり" });
    await bk(g, pid, "DZAA0002");
    await bk(g, other.id, "DZAA0003", { notes: "他人のメモ" });
    await prisma.questionnaire.create({ data: { bookingId: b1.id, formVersion: "1", language: "JA", answers: encryptJson({ q1: "頭痛" }), submittedAt: new Date(), purgeAfter: dbDate(addDays(today, 90)) } });
    await prisma.notification.create({ data: { event: "NT01_BOOKED", channel: "MAIL", language: "JA", patientId: pid, bookingId: b1.id, toAddress: "kanja@example.jp", status: "SENT", queuedAt: new Date(), sentAt: new Date() } });
    await prisma.consent.createMany({ data: [{ accountId: f.patient.accountId!, kind: "TERMS", version: "1", agreedAt: new Date() }, { accountId: f.patient.accountId!, kind: "PRIVACY", version: "1", agreedAt: new Date() }] });
    await prisma.auditLog.create({ data: { at: new Date(), action: "PATIENT_VIEW", targetType: "patient", targetId: pid, clinicId: f.clinic.id } });

    const row = await request(pid);
    expect(await buildDisclosure(row.id)).toBe("DONE");
    const done = await prisma.exportFile.findUniqueOrThrow({ where: { id: row.id } });
    // profile 1 + cards 2 + bookings 2 + questionnaires 1 + notifications 1 + consents 2
    expect(done).toMatchObject({ status: "DONE", rowCount: 9, warningCount: 0, clinicId: f.clinic.id, patientId: pid });
    expect(done.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(done.expiresAt!.getTime() - Date.now()).toBeGreaterThan(29.9 * 86_400_000);
    const zip = await readExportFile(done.storageKey!);
    expect(createHash("sha256").update(zip).digest("hex")).toBe(done.sha256);

    const files = readZip(zip);
    expect([...files.keys()]).toEqual(["profile.csv", "cards.csv", "bookings.csv", "questionnaires.csv", "notifications.csv", "consents.csv"]);
    const t = (n: string) => files.get(n)!.data.toString("utf8").split("\r\n").filter(Boolean);
    expect(t("profile.csv")).toHaveLength(2);
    expect(t("profile.csv")[1]).toContain(`"${pid}"`);
    expect(t("profile.csv")[1]).toContain('"試験","患者","シケン","カンジャ","1990-01-01"');
    expect(t("cards.csv").join("\n")).toMatch(/"F-1".*\n.*"G-1"|"G-1".*\n.*"F-1"/);
    const bookings = t("bookings.csv").join("\n");
    expect(bookings).toContain('"DZAA0001"');
    expect(bookings).toContain('"DZAA0002"'); // the other clinic
    expect(bookings).toContain('"付き添いあり"'); // notes decrypted
    expect(bookings).not.toContain("DZAA0003");
    expect(bookings).not.toContain("他人のメモ");
    expect(t("questionnaires.csv")[1]).toBe(`"DZAA0001","1","JA","${t("questionnaires.csv")[1].split('","')[3]}","{""q1"":""頭痛""}"`);
    expect(t("notifications.csv")[1]).toContain('"kanja@example.jp"');
    expect(t("consents.csv")).toHaveLength(3);
    expect([...files.keys()].join()).not.toMatch(/audit/);
    expect(files.get("profile.csv")!.data.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false); // plain UTF-8, no BOM
  });

  it("FAILED: a store error sets FAILED (+30 days, no file fields); a non-BUILDING row is left alone; startDisclosureBuild never throws", async () => {
    const row = await request(other.id);
    storeMock.mockRejectedValueOnce(new Error("disk full"));
    expect(await buildDisclosure(row.id)).toBe("FAILED");
    const failed = await prisma.exportFile.findUniqueOrThrow({ where: { id: row.id } });
    expect(failed).toMatchObject({ status: "FAILED", storageKey: null, sha256: null, rowCount: null });
    expect(failed.expiresAt!.getTime() - Date.now()).toBeGreaterThan(29.9 * 86_400_000);
    expect(await buildDisclosure(row.id)).toBe("SKIPPED"); // FAILED is final: a new request makes a new row
    expect(() => startDisclosureBuild("00000000-0000-4000-8000-000000000000")).not.toThrow();
  });

  it("A06 set the row FAILED while the build ran: the row stays FAILED and the finished file is discarded", async () => {
    const row = await request(other.id);
    const before = readdirSync(process.env.EXPORT_DIR!).length;
    const actual = jest.requireActual("@/lib/export/store") as { storeExportFile: typeof storeExportFile };
    storeMock.mockImplementationOnce(async (n, b) => {
      await prisma.exportFile.update({ where: { id: row.id }, data: { status: "FAILED", expiresAt: new Date(Date.now() + 30 * 86_400_000) } });
      return actual.storeExportFile(n, b);
    });
    expect(await buildDisclosure(row.id)).toBe("FAILED");
    expect(await prisma.exportFile.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "FAILED", storageKey: null });
    expect(readdirSync(process.env.EXPORT_DIR!).length).toBe(before);
  });
});
