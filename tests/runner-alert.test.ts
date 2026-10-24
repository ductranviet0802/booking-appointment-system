// J-08 (N-OPS-06, B-10): a FAILED or PARTIAL run mails the operator and the admins of the clinic concerned through the mail
// transport (BATCH_ALERT); SUCCESS and a run skipped by the advisory lock send nothing. Q-034: a B4 clinic over the cap → FAILED
// → alert. Fake transport: one JSON line per mail in NOTIFY_OUTBOX_DIR.
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as b4 from "@/lib/batch/b4-close";
import { OPERATOR_ALERT_KEY, runJob } from "@/lib/batch/runner";
import { addDays, dbDate, dbTime, todayJst } from "@/lib/datetime";
import { pool, prisma } from "@/lib/prisma";
import { cleanupStaff, makeStaff } from "./a03-helpers";
import { fixture, type Fixture } from "./b2-helpers";

const outbox = mkdtempSync(path.join(tmpdir(), "alert-outbox-"));
process.env.NOTIFY_OUTBOX_DIR = outbox;
jest.setTimeout(60_000);

let f: Fixture;
let admin: Awaited<ReturnType<typeof makeStaff>>;
const OPERATOR = "ops.w4test@example.jp";
const mails = () =>
  readdirSync(outbox).flatMap((n) => readFileSync(path.join(outbox, n), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { to: string; subject: string; body: string; event: string }))
    .filter((m) => m.event === "BATCH_ALERT");

beforeAll(async () => {
  f = await fixture({ doctors: 1 });
  admin = await makeStaff("ADMIN", { clinics: [f.tag] });
  await prisma.systemSetting.create({ data: { key: OPERATOR_ALERT_KEY, value: OPERATOR } });
});
afterAll(async () => {
  await prisma.systemSetting.deleteMany({ where: { key: OPERATOR_ALERT_KEY } });
  await f.cleanup();
  await cleanupStaff();
  await prisma.$disconnect();
  await pool.end();
});

it("FAILED run → alert to the operator and the clinic's admin, with job, status, counts and message", async () => {
  const r = await runJob("B4", { trigger: "MANUAL", clinicId: f.clinic.id, params: { date: todayJst() } });
  expect(r.run!.status).toBe("FAILED");
  const sent = mails().filter((m) => m.body.includes(r.run!.id));
  expect(sent.map((m) => m.to).sort()).toEqual(expect.arrayContaining([OPERATOR, admin.account.email]));
  expect(sent[0].subject).toBe(`【バッチ失敗】B4 ${f.clinic.nameJa}`);
  expect(sent[0].body).toContain("状態: FAILED");
  expect(sent[0].body).toContain("bad parameter date");
});

it("PARTIAL run (B1, a reminder that reached no channel) → alert through the mail transport: in the outbox, no notifications row", async () => {
  const acc = await prisma.account.create({
    data: { email: `${f.tag}.fail400.w4test@example.jp`, passwordHash: "x", role: "PATIENT", status: "ACTIVE", language: "JA", notifyChannel: "MAIL" },
  });
  const p = await prisma.patient.create({
    data: {
      accountId: acc.id, relation: "SELF", nameType: "JP", familyName: "試験", givenName: "警報", familyNameKana: "シケン", givenNameKana: "ケイホウ",
      birthDate: dbDate("1990-01-01"), sex: "MALE", postcode: "1000001", prefecture: "東京都", city: "千代田区", addressLine: "1-1", phone: "09000000000", createdByKind: "PATIENT",
    },
  });
  await prisma.booking.create({
    data: {
      bookingNo: "ALRT0001", clinicId: f.clinic.id, departmentId: f.dept.id, visitTypeId: f.visitType.id, doctorId: f.doctors[0].id, doctorRequested: true,
      patientId: p.id, channel: "WEB", slotDate: dbDate(addDays(todayJst(), 1)), startTime: dbTime("10:00"), endTime: dbTime("10:15"), createdAt: new Date(Date.now() - 2 * 86_400_000),
    },
  });
  const notices = await prisma.notification.count();
  const r = await runJob("B1", { trigger: "MANUAL", clinicId: f.clinic.id });
  expect(r.run!.status).toBe("PARTIAL");
  const sent = mails().filter((m) => m.body.includes(r.run!.id));
  expect(sent.map((m) => m.to)).toEqual(expect.arrayContaining([OPERATOR, admin.account.email]));
  expect(sent[0].subject).toBe(`【バッチ一部失敗】B1 ${f.clinic.nameJa}`);
  expect(await prisma.notification.count()).toBe(notices + 1); // the NT-02 row only; the alert is no notifications row
  await prisma.notification.deleteMany({ where: { patientId: p.id } });
  await prisma.booking.deleteMany({ where: { patientId: p.id } });
  await prisma.patient.delete({ where: { id: p.id } });
  await prisma.account.delete({ where: { id: acc.id } });
});

it("Q-034: a clinic refused by the B4 cap makes the run FAILED and reaches the admins by the alert; the dry run reports it too", async () => {
  const cap = jest.replaceProperty(b4, "B4_MAX_PER_CLINIC", 1 as typeof b4.B4_MAX_PER_CLINIC);
  const yesterday = addDays(todayJst(), -1);
  for (const [i, no] of ["CAPA0001", "CAPA0002"].entries()) {
    await prisma.booking.create({
      data: {
        bookingNo: no, clinicId: f.clinic.id, departmentId: f.dept.id, visitTypeId: f.visitType.id, doctorId: f.doctors[0].id, doctorRequested: true,
        patientId: f.patient.id, channel: "WEB", slotDate: dbDate(yesterday), startTime: dbTime(`1${i}:00`), endTime: dbTime(`1${i}:15`),
      },
    });
  }
  const dry = await runJob("B4", { trigger: "MANUAL", clinicId: f.clinic.id, dryRun: true });
  expect([dry.result.status, dry.result.message]).toEqual(["FAILED", expect.stringContaining("over the cap 1")]);
  const r = await runJob("B4", { trigger: "MANUAL", clinicId: f.clinic.id });
  expect(r.run!.status).toBe("FAILED");
  expect(await prisma.booking.count({ where: { clinicId: f.clinic.id, noShowCandidateAt: { not: null } } })).toBe(0); // nothing flagged
  const sent = mails().filter((m) => m.body.includes(r.run!.id));
  expect(sent.map((m) => m.to)).toEqual(expect.arrayContaining([OPERATOR, admin.account.email]));
  expect(sent[0].body).toContain("over the cap 1");
  await prisma.booking.deleteMany({ where: { clinicId: f.clinic.id, slotDate: dbDate(yesterday) } });
  cap.restore();
});

it("SUCCESS and a run skipped by the lock send nothing", async () => {
  const before = mails().length;
  const ok = await runJob("B4", { trigger: "MANUAL", clinicId: f.clinic.id });
  expect(ok.run!.status).toBe("SUCCESS");
  const holder = await pool.connect();
  try {
    await holder.query("SELECT pg_advisory_lock(hashtext('batch:B4'))");
    const skipped = await runJob("B4", { trigger: "MANUAL", clinicId: f.clinic.id });
    expect(skipped.result.message).toBe("実行中のため省略");
  } finally {
    await holder.query("SELECT pg_advisory_unlock(hashtext('batch:B4'))");
    holder.release();
  }
  expect(mails().length).toBe(before);
});
