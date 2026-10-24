// B5 保存期間削除 on the slot's test database (no mocks): per row class of 06 §5 a row just inside its period stays and a
// row just past it is acted on (dependent rows with it); anonymised values exactly as 06 §B5; dry run writes nothing; a
// second run is all zeros; Q-022 setting moves the boundary; a bad setting / a failing batch → PARTIAL, other classes
// done; one RETENTION_PURGE audit row with counts only. Races: e-mail verification vs the PENDING purge, a staff booking
// vs the withdrawn purge, a booking taking an old frame vs the slot purge, two runs at once.
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { runJob } from "@/lib/batch/runner";
import { cutOf } from "@/lib/batch/b5-retention";
import { lockPerson } from "@/lib/booking/core";
import { addDays, dbDate, dbTime, todayJst, toIsoDate } from "@/lib/datetime";
import { deleteExportFile, storeExportFile } from "@/lib/export/store";
import { pool, prisma } from "@/lib/prisma";
import { fixture, type Fixture } from "./b2-helpers";

jest.setTimeout(120_000);

const H = 3_600_000;
const today = todayJst();
const ago = (d: number) => addDays(today, -d);
let f: Fixture;
let run0: { id: string };
let seq = 0;
const tag = `b5t${Date.now().toString(36).slice(-5)}`;
const mine = { patients: [] as string[], accounts: [] as string[], exports: [] as string[], runs: [] as string[], audits: [] as bigint[] };

beforeAll(async () => {
  f = await fixture({ doctors: 1 });
  run0 = await prisma.batchRun.create({ data: { jobCode: "B2", trigger: "MANUAL", startedAt: new Date(), status: "SUCCESS", readCount: 0, writtenCount: 0, errorCount: 0, message: f.tag } });
});
afterAll(async () => {
  await prisma.systemSetting.updateMany({ where: { key: "retention_withdrawn_days" }, data: { value: "30" } });
  await prisma.systemSetting.updateMany({ where: { key: "retention_slot_days" }, data: { value: "90" } });
  const bookings = { patientId: { in: mine.patients } };
  await prisma.notification.deleteMany({ where: { OR: [{ patientId: { in: mine.patients } }, { toAddress: { startsWith: tag } }] } });
  await prisma.booking.deleteMany({ where: bookings });
  for (const e of await prisma.exportFile.findMany({ where: { id: { in: mine.exports } } })) if (e.storageKey) await deleteExportFile(e.storageKey);
  await prisma.exportFile.deleteMany({ where: { id: { in: mine.exports } } });
  await prisma.patientCard.deleteMany({ where: { patientId: { in: mine.patients } } });
  await prisma.patient.deleteMany({ where: { id: { in: mine.patients } } });
  await prisma.account.deleteMany({ where: { id: { in: mine.accounts } } });
  await prisma.session.deleteMany({ where: { accountId: f.patient.accountId! } });
  await prisma.authToken.deleteMany({ where: { accountId: f.patient.accountId! } });
  await prisma.slot.deleteMany({ where: { clinicId: f.clinic.id } });
  await prisma.batchRun.deleteMany({ where: { id: { in: mine.runs } } });
  await prisma.auditLog.deleteMany({ where: { id: { in: mine.audits } } });
  await f.cleanup();
  await prisma.$disconnect();
  await pool.end();
});

// ── row builders ─────────────────────────────────────────────────────────────────────────────────────────────────

const no = () => `BF${"ABCDEFGHJK"[Math.floor(seq / 10) % 10]}${"ABCDEFGHJK"[seq % 10]}${String(++seq).padStart(4, "0")}`;
const hash = () => randomBytes(32).toString("hex");

async function patient(o: { accountId?: string; relation?: "SELF" | "CHILD"; createdAt?: Date } = {}) {
  const p = await prisma.patient.create({
    data: {
      accountId: o.accountId ?? null, relation: o.relation ?? null, nameType: "JP", familyName: "保存", givenName: "試験", familyNameKana: "ホゾン",
      givenNameKana: "シケン", birthDate: dbDate("1984-07-21"), sex: "FEMALE", postcode: "1000001", prefecture: "東京都", city: "千代田区",
      town: "丸の内", addressLine: "1-1", building: "ビル1", phone: "09011112222", createdByKind: o.accountId ? "PATIENT" : "STAFF",
      ...(o.createdAt && { createdAt: o.createdAt }),
    },
  });
  mine.patients.push(p.id);
  return p;
}
async function account(status: "WITHDRAWN" | "PENDING", o: { withdrawnAt?: Date; createdAt?: Date } = {}) {
  const a = await prisma.account.create({
    data: {
      email: `${tag}.${++seq}@example.jp`, passwordHash: "x", role: "PATIENT", status, notifyChannel: "MAIL",
      withdrawnAt: o.withdrawnAt ?? null, ...(o.createdAt && { createdAt: o.createdAt }),
    },
  });
  mine.accounts.push(a.id);
  return a;
}
async function booking(patientId: string, date: string, o: { status?: "RESERVED" | "CHECKED_IN" | "CANCELED"; notes?: boolean; canceledAt?: Date; slotIds?: string[]; questionnaire?: boolean } = {}) {
  const status = o.status ?? "CHECKED_IN";
  return prisma.booking.create({
    data: {
      bookingNo: no(), clinicId: f.clinic.id, departmentId: f.dept.id, visitTypeId: f.visitType.id, doctorId: f.doctors[0].id, doctorRequested: true,
      patientId, channel: "PHONE", slotDate: dbDate(date), startTime: dbTime("09:00"), endTime: dbTime("09:15"), status,
      notes: o.notes ? Buffer.from("memo") : null,
      ...(status === "CHECKED_IN" && { checkedInAt: new Date() }),
      ...(status === "CANCELED" && { canceledAt: o.canceledAt ?? new Date(), canceledByKind: "STAFF" as const, cancelReasonCode: "OTHER" as const, cancelReasonText: "都合" }),
      events: { create: [{ event: "CREATED", actorKind: "STAFF", at: new Date() }] },
      ...(o.slotIds && { bookingSlots: { create: o.slotIds.map((slotId) => ({ slotId })) } }),
      ...(o.questionnaire && { questionnaire: { create: { formVersion: "1", language: "JA", answers: Buffer.from("x"), submittedAt: new Date(), purgeAfter: dbDate(addDays(date, 90)) } } }),
    },
  });
}
let minute = 0;
const slot = (date: string) => {
  const m = minute++;
  return prisma.slot.create({
    data: {
      clinicId: f.clinic.id, departmentId: f.dept.id, doctorId: f.doctors[0].id, slotDate: dbDate(date),
      startTime: dbTime(`${String(8 + Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`),
      endTime: dbTime(`${String(8 + Math.floor((m + 1) / 60)).padStart(2, "0")}:${String((m + 1) % 60).padStart(2, "0")}`),
      capacity: 1, status: "OPEN", generatedRunId: run0.id,
    },
  });
};
const session = (expiresAt: Date) =>
  prisma.session.create({ data: { tokenHash: hash(), accountId: f.patient.accountId!, expiresAt, lastSeenAt: expiresAt } });
const token = (expiresAt: Date) =>
  prisma.authToken.create({ data: { tokenHash: hash(), accountId: f.patient.accountId!, purpose: "PASSWORD_RESET", expiresAt } });
const notification = (queuedAt: Date) =>
  prisma.notification.create({ data: { event: "NT01_BOOKED", channel: "MAIL", language: "JA", toAddress: `${tag}@example.jp`, status: "SENT", queuedAt } });
async function exportRow(createdAt: Date, o: { file?: boolean; building?: boolean } = {}) {
  const stored = o.file ? await storeExportFile(`${tag}_${++seq}.csv`, Buffer.from("a,b\n")) : { storageKey: `${tag}_gone_${++seq}.csv`, sha256: "0".repeat(64) };
  const e = await prisma.exportFile.create({
    data: o.building
      ? { clinicId: f.clinic.id, kind: "DISCLOSURE", trigger: "MANUAL", status: "BUILDING", patientId: f.patient.id, fileName: "d.zip", createdAt }
      : {
          clinicId: f.clinic.id, kind: "BOOKINGS", trigger: "BATCH", status: "DONE", periodFrom: dbDate(today), periodTo: dbDate(today), fileName: "b.csv",
          storageKey: stored.storageKey, sha256: stored.sha256, rowCount: 1, warningCount: 0, expiresAt: new Date(createdAt.getTime() + 30 * 86_400_000), createdAt,
        },
  });
  mine.exports.push(e.id);
  return e;
}
async function batchRun(startedAt: Date) {
  const r = await prisma.batchRun.create({ data: { jobCode: "B4", trigger: "SCHEDULE", startedAt, endedAt: startedAt, status: "SUCCESS", readCount: 0, writtenCount: 0, errorCount: 0 } });
  mine.runs.push(r.id);
  return r;
}
async function auditRow(at: Date) {
  const a = await prisma.auditLog.create({ data: { at, action: "LOGIN_OK" } });
  mine.audits.push(a.id);
  return a;
}

const b5 = (o: { dryRun?: boolean } = {}) => runJob("B5", { trigger: "MANUAL", ...o });
const purgeRow = (runId: string) => prisma.auditLog.findFirstOrThrow({ where: { action: "RETENTION_PURGE", targetId: runId } });
const gone = {
  patient: (id: string) => prisma.patient.findUnique({ where: { id } }),
  booking: (id: string) => prisma.booking.findUnique({ where: { id } }),
};
const fileOf = (key: string) => readFile(path.join(process.env.EXPORT_DIR ?? "var/export", key)).then(() => true, () => false);

// ── the run over every class ─────────────────────────────────────────────────────────────────────────────────────

describe("B5 per row class", () => {
  const now = Date.now();
  const d30 = 30 * 86_400_000;
  const y5 = cutOf(5, "years", new Date(now));
  const y2 = cutOf(2, "years", new Date(now));
  const r: Record<string, { id: string }> = {};
  const x: Record<string, string> = {}; // extra ids
  const audit: Record<string, bigint> = {};
  let firstRun: Awaited<ReturnType<typeof b5>>;

  it("builds rows just inside / just past each period; a dry run counts them and writes nothing", async () => {
    // 問診: 90 days after the patient's last visit
    const q1 = await patient();
    r.qPast = await booking(q1.id, ago(91), { questionnaire: true, notes: true });
    const q2 = await patient();
    r.qIn = await booking(q2.id, ago(90), { questionnaire: true, notes: true });
    const q3 = await patient();
    r.qLater = await booking(q3.id, ago(200), { questionnaire: true });
    await booking(q3.id, ago(10)); // a later visit keeps the old 問診
    // cancel reason text: 1 year after cancellation
    r.cPast = await booking(q2.id, ago(400), { status: "CANCELED", canceledAt: new Date(now - 365 * 86_400_000 - H) });
    r.cIn = await booking(q2.id, ago(300), { status: "CANCELED", canceledAt: new Date(now - 365 * 86_400_000 + H) });
    // bookings: 5 years after slot_date (frames and events with them); the patient then has no booking left
    const p5 = await patient({ createdAt: new Date(now - 6 * 366 * 86_400_000) });
    const oldFrame = await slot(addDays(y5.date, -1));
    x.oldFrame = oldFrame.id;
    r.bPast = await booking(p5.id, addDays(y5.date, -1), { slotIds: [oldFrame.id], notes: true });
    x.p5 = p5.id;
    const p5b = await patient({ createdAt: new Date(now - 6 * 366 * 86_400_000) });
    r.bIn = await booking(p5b.id, y5.date);
    x.p5b = p5b.id;
    // patients without account and without booking: registration date counts
    x.p6old = (await patient({ createdAt: new Date(now - 6 * 366 * 86_400_000) })).id;
    x.p6new = (await patient()).id;
    // withdrawn: 30 days (Q-022 setting); SELF + family anonymised, bookings kept
    const w1 = await account("WITHDRAWN", { withdrawnAt: new Date(now - d30 - H) });
    x.w1 = w1.id;
    x.w1self = (await patient({ accountId: w1.id, relation: "SELF" })).id;
    x.w1child = (await patient({ accountId: w1.id, relation: "CHILD" })).id;
    r.w1booking = await booking(x.w1child, ago(60), { notes: true });
    x.w2 = (await account("WITHDRAWN", { withdrawnAt: new Date(now - d30 + H) })).id;
    const w3 = await account("WITHDRAWN", { withdrawnAt: new Date(now - d30 - H) }); // staff booked a future visit since
    x.w3 = w3.id;
    x.w3self = (await patient({ accountId: w3.id, relation: "SELF" })).id;
    await booking(x.w3self, addDays(today, 5), { status: "RESERVED" });
    // PENDING: 7 days after creation, with SELF patient, consents and tokens
    const pa1 = await account("PENDING", { createdAt: new Date(now - 7 * 86_400_000 - H) });
    x.pa1 = pa1.id;
    x.pa1self = (await patient({ accountId: pa1.id, relation: "SELF" })).id;
    await prisma.consent.createMany({ data: ["TERMS", "PRIVACY"].map((kind) => ({ accountId: pa1.id, kind, version: "1.0", agreedAt: pa1.createdAt })) });
    await prisma.authToken.create({ data: { tokenHash: hash(), accountId: pa1.id, purpose: "EMAIL_VERIFY", expiresAt: new Date(now - 6 * 86_400_000) } });
    x.pa2 = (await account("PENDING", { createdAt: new Date(now - 7 * 86_400_000 + H) })).id;
    // sessions / auth tokens: 30 days after expiry; notifications: 1 year
    r.sPast = await session(new Date(now - d30 - H));
    r.sIn = await session(new Date(now - d30 + H));
    x.tPast = (await token(new Date(now - d30 - H))).tokenHash;
    x.tIn = (await token(new Date(now - d30 + H))).tokenHash;
    r.nPast = await notification(new Date(now - 365 * 86_400_000 - H));
    r.nIn = await notification(new Date(now - 365 * 86_400_000 + H));
    // export files: file 30 days (row kept), row 5 years; a BUILDING row is A06's
    r.eFilePast = await exportRow(new Date(now - d30 - H), { file: true });
    r.eFileIn = await exportRow(new Date(now - d30 + H), { file: true });
    r.eRowPast = await exportRow(new Date(y5.at.getTime() - H));
    r.eRowIn = await exportRow(new Date(y5.at.getTime() + H));
    r.eBuilding = await exportRow(new Date(y5.at.getTime() - H), { building: true });
    // slots: free 90 days after slot_date; a frame with a booking stays
    r.slotPast = await slot(ago(91));
    r.slotIn = await slot(ago(90));
    const held = await slot(ago(100));
    r.slotHeld = held;
    await booking(q3.id, ago(100), { slotIds: [held.id] });
    // batch runs: 2 years, unless a kept frame names it
    r.runPast = await batchRun(new Date(y2.at.getTime() - H));
    r.runIn = await batchRun(new Date(y2.at.getTime() + H));
    r.runHeld = await batchRun(new Date(y2.at.getTime() - H));
    await prisma.slot.update({ where: { id: held.id }, data: { generatedRunId: r.runHeld.id } });
    // audit logs: 5 years (Q-002)
    audit.past = (await auditRow(new Date(y5.at.getTime() - H))).id;
    audit.in = (await auditRow(new Date(y5.at.getTime() + H))).id;

    const runs = await prisma.batchRun.count();
    const audits = await prisma.auditLog.count({ where: { action: "RETENTION_PURGE" } });
    const dry = await b5({ dryRun: true });
    expect(dry.run).toBeNull();
    expect(dry.result).toMatchObject({ status: "SUCCESS", written: 0 });
    expect(dry.result.read).toBeGreaterThanOrEqual(16); // the past rows above (notes: two) + the seed's B5 demo block
    expect(dry.result.message).toMatch(/^（試行）questionnaires [1-9]/);
    expect(await prisma.batchRun.count()).toBe(runs);
    expect(await prisma.auditLog.count({ where: { action: "RETENTION_PURGE" } })).toBe(audits);
    expect(await gone.booking(r.bPast.id)).not.toBeNull();
    expect(await prisma.questionnaire.count({ where: { bookingId: r.qPast.id } })).toBe(1);
    expect(await prisma.account.count({ where: { id: { in: [x.w1, x.pa1] } } })).toBe(2);
    expect(await fileOf(((await prisma.exportFile.findUniqueOrThrow({ where: { id: r.eFilePast.id } })).storageKey)!)).toBe(true);
  });

  it("the run acts on the rows past their period and only those", async () => {
    firstRun = await b5();
    expect(firstRun.result.status).toBe("SUCCESS");
    expect(firstRun.run!.status).toBe("SUCCESS");

    // 問診 and notes
    expect(await prisma.questionnaire.count({ where: { bookingId: { in: [r.qPast.id, r.qIn.id, r.qLater.id] } } })).toBe(2);
    expect(await prisma.questionnaire.count({ where: { bookingId: r.qPast.id } })).toBe(0);
    expect((await gone.booking(r.qPast.id))!.notes).toBeNull();
    expect((await gone.booking(r.qIn.id))!.notes).not.toBeNull();
    // cancel reason text
    expect((await gone.booking(r.cPast.id))!.cancelReasonText).toBeNull();
    expect((await gone.booking(r.cPast.id))!.cancelReasonCode).toBe("OTHER");
    expect((await gone.booking(r.cIn.id))!.cancelReasonText).toBe("都合");
    // bookings with their events and frames; the freed 5-year-old frame goes in the same run
    expect(await gone.booking(r.bPast.id)).toBeNull();
    expect(await prisma.bookingEvent.count({ where: { bookingId: r.bPast.id } })).toBe(0);
    expect(await prisma.bookingSlot.count({ where: { bookingId: r.bPast.id } })).toBe(0);
    expect(await prisma.slot.findUnique({ where: { id: x.oldFrame } })).toBeNull();
    expect(await gone.booking(r.bIn.id)).not.toBeNull();
    // patients without account: anonymised exactly as 06 §B5
    const p5 = await gone.patient(x.p5);
    expect(p5).toMatchObject({
      familyName: "削除済", givenName: "削除済", familyNameKana: "サクジョズミ", givenNameKana: "サクジョズミ", postcode: "       ",
      prefecture: "", city: "", town: "", addressLine: "", building: "", phone: "", sex: "FEMALE", nameType: "JP", createdByKind: "STAFF",
    });
    expect(toIsoDate(p5!.birthDate)).toBe("1984-01-01");
    expect(p5!.anonymizedAt).not.toBeNull();
    expect((await gone.patient(x.p6old))!.anonymizedAt).not.toBeNull();
    for (const id of [x.p5b, x.p6new]) expect((await gone.patient(id))!).toMatchObject({ anonymizedAt: null, familyName: "保存" });
    // withdrawn: account gone, SELF + family anonymised and detached, their booking kept without notes
    expect(await prisma.account.findUnique({ where: { id: x.w1 } })).toBeNull();
    for (const id of [x.w1self, x.w1child]) expect(await gone.patient(id)).toMatchObject({ accountId: null, familyName: "削除済", phone: "" });
    expect((await gone.patient(x.w1child))!.relation).toBe("CHILD");
    const wb = (await gone.booking(r.w1booking.id))!;
    expect(wb).toMatchObject({ status: "CHECKED_IN", notes: null, clinicId: f.clinic.id, visitTypeId: f.visitType.id });
    expect(wb.anonymizedAt).not.toBeNull();
    expect(await prisma.account.count({ where: { id: { in: [x.w2, x.w3] } } })).toBe(2);
    expect((await gone.patient(x.w3self))!.anonymizedAt).toBeNull();
    // PENDING: account, SELF patient, consents and tokens together
    expect(await prisma.account.findUnique({ where: { id: x.pa1 } })).toBeNull();
    expect(await gone.patient(x.pa1self)).toBeNull();
    expect(await prisma.consent.count({ where: { accountId: x.pa1 } })).toBe(0);
    expect(await prisma.authToken.count({ where: { accountId: x.pa1 } })).toBe(0);
    expect(await prisma.account.findUnique({ where: { id: x.pa2 } })).not.toBeNull();
    // sessions, tokens, notifications
    expect(await prisma.session.findUnique({ where: { id: r.sPast.id } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: r.sIn.id } })).not.toBeNull();
    expect(await prisma.authToken.findUnique({ where: { tokenHash: x.tPast } })).toBeNull();
    expect(await prisma.authToken.findUnique({ where: { tokenHash: x.tIn } })).not.toBeNull();
    expect(await prisma.notification.findUnique({ where: { id: r.nPast.id } })).toBeNull();
    expect(await prisma.notification.findUnique({ where: { id: r.nIn.id } })).not.toBeNull();
    // export files: file gone with the row kept; old rows gone; BUILDING untouched
    const ef = await prisma.exportFile.findUniqueOrThrow({ where: { id: r.eFilePast.id } });
    expect(await fileOf(ef.storageKey!)).toBe(false);
    expect(await fileOf((await prisma.exportFile.findUniqueOrThrow({ where: { id: r.eFileIn.id } })).storageKey!)).toBe(true);
    expect(await prisma.exportFile.findUnique({ where: { id: r.eRowPast.id } })).toBeNull();
    expect(await prisma.exportFile.count({ where: { id: { in: [r.eRowIn.id, r.eBuilding.id] } } })).toBe(2);
    // slots, batch runs, audit logs
    expect(await prisma.slot.findUnique({ where: { id: r.slotPast.id } })).toBeNull();
    expect(await prisma.slot.count({ where: { id: { in: [r.slotIn.id, r.slotHeld.id] } } })).toBe(2);
    expect(await prisma.batchRun.findUnique({ where: { id: r.runPast.id } })).toBeNull();
    expect(await prisma.batchRun.count({ where: { id: { in: [r.runIn.id, r.runHeld.id] } } })).toBe(2);
    expect(await prisma.auditLog.findUnique({ where: { id: audit.past } })).toBeNull();
    expect(await prisma.auditLog.findUnique({ where: { id: audit.in } })).not.toBeNull();
  });

  it("writes one RETENTION_PURGE audit row with counts per table and no content", async () => {
    const row = await purgeRow(firstRun.run!.id);
    expect(row).toMatchObject({ accountId: null, targetType: "batch_run" });
    const detail = row.detail as { counts: Record<string, number>; failed: string[] };
    expect(Object.keys(detail).sort()).toEqual(["counts", "failed"]);
    expect(detail.failed).toEqual([]);
    for (const k of ["questionnaires", "bookings.notes", "bookings.cancel_reason_text", "bookings", "booking_events", "booking_slots", "patients.no_account",
      "accounts.withdrawn", "patients.withdrawn", "accounts.pending", "patients.pending", "consents.pending", "sessions", "auth_tokens", "notifications",
      "export_files.file", "export_files", "slots", "batch_runs", "audit_logs"]) expect(detail.counts[k]).toBeGreaterThanOrEqual(1);
    expect(detail.counts["patients.withdrawn"]).toBeGreaterThanOrEqual(2);
    expect(detail.counts["consents.pending"]).toBeGreaterThanOrEqual(2);
    expect(Object.values(detail.counts).reduce((s, n) => s + n, 0)).toBe(firstRun.result.written);
    expect(JSON.stringify(detail)).not.toMatch(/保存|example\.jp/);
  });

  it("a second run right after finds nothing (all zeros)", async () => {
    const again = await b5();
    expect(again.result).toMatchObject({ status: "SUCCESS", read: 0, written: 0, errors: 0 });
    const counts = ((await purgeRow(again.run!.id)).detail as { counts: Record<string, number> }).counts;
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });
});

describe("B5 settings and failures", () => {
  it("Q-022: retention_withdrawn_days 45 keeps a 31-day withdrawn account; back to 30 it goes", async () => {
    const w = await account("WITHDRAWN", { withdrawnAt: new Date(Date.now() - 31 * 86_400_000) });
    const self = await patient({ accountId: w.id, relation: "SELF" });
    await prisma.systemSetting.update({ where: { key: "retention_withdrawn_days" }, data: { value: "45" } });
    try {
      expect((await b5()).result.status).toBe("SUCCESS");
      expect(await prisma.account.findUnique({ where: { id: w.id } })).not.toBeNull();
    } finally {
      await prisma.systemSetting.update({ where: { key: "retention_withdrawn_days" }, data: { value: "30" } });
    }
    await b5();
    expect(await prisma.account.findUnique({ where: { id: w.id } })).toBeNull();
    expect((await gone.patient(self.id))!.familyName).toBe("削除済");
  });

  it("a bad setting fails that class only → PARTIAL, the other classes done", async () => {
    const s = await slot(ago(120));
    const old = await session(new Date(Date.now() - 40 * 86_400_000));
    await prisma.systemSetting.update({ where: { key: "retention_slot_days" }, data: { value: "abc" } });
    try {
      const res = await b5();
      expect(res.result).toMatchObject({ status: "PARTIAL", errors: 1 });
      expect(res.run!.status).toBe("PARTIAL");
      expect(res.result.message).toMatch(/失敗 slots: retention_slot_days=abc/);
      expect(await prisma.slot.findUnique({ where: { id: s.id } })).not.toBeNull();
      expect(await prisma.session.findUnique({ where: { id: old.id } })).toBeNull();
      expect(((await purgeRow(res.run!.id)).detail as { failed: string[] }).failed).toEqual(["slots"]);
    } finally {
      await prisma.systemSetting.update({ where: { key: "retention_slot_days" }, data: { value: "90" } });
    }
  });

  it("a PENDING account whose person has a booking (S02) is kept, not a nightly failure; the others go", async () => {
    const created = new Date(Date.now() - 8 * 86_400_000);
    const booked = await account("PENDING", { createdAt: created });
    const b = await booking((await patient({ accountId: booked.id, relation: "SELF" })).id, ago(3));
    const fine = await account("PENDING", { createdAt: created });
    await patient({ accountId: fine.id, relation: "SELF" });
    expect((await b5()).result.status).toBe("SUCCESS");
    expect(await prisma.account.findUnique({ where: { id: booked.id } })).not.toBeNull();
    expect(await prisma.account.findUnique({ where: { id: fine.id } })).toBeNull();
    await prisma.booking.delete({ where: { id: b.id } });
    expect((await b5()).result.status).toBe("SUCCESS");
    expect(await prisma.account.findUnique({ where: { id: booked.id } })).toBeNull();
  });

  it("a failing batch rolls back whole → PARTIAL; next run picks up the rest", async () => {
    const created = new Date(Date.now() - 8 * 86_400_000);
    const bad = await account("PENDING", { createdAt: created });
    const fine = await account("PENDING", { createdAt: created });
    const old = await session(new Date(Date.now() - 40 * 86_400_000));
    // test-only trigger: deleting `bad` raises, as any DB error inside the batch would
    await prisma.$executeRawUnsafe(`CREATE FUNCTION b5t_refuse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF OLD.id = '${bad.id}' THEN RAISE EXCEPTION 'refused'; END IF; RETURN OLD; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER b5t_refuse BEFORE DELETE ON accounts FOR EACH ROW EXECUTE FUNCTION b5t_refuse()`);
    try {
      const res = await b5();
      expect(res.result).toMatchObject({ status: "PARTIAL", errors: 1 });
      expect(res.result.message).toMatch(/失敗 accounts\.pending: /);
      expect(await prisma.account.count({ where: { id: { in: [bad.id, fine.id] } } })).toBe(2); // same batch: rolled back together
      expect(await prisma.session.findUnique({ where: { id: old.id } })).toBeNull(); // the next classes went on
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER b5t_refuse ON accounts`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION b5t_refuse()`);
    }
    expect((await b5()).result.status).toBe("SUCCESS");
    expect(await prisma.account.count({ where: { id: { in: [bad.id, fine.id] } } })).toBe(0);
  });
});

describe("B5 races (real row locks)", () => {
  const hold = async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    let locked!: () => void;
    const holding = new Promise<void>((res) => { locked = res; });
    const tx = prisma.$transaction(async (t) => {
      await work(t);
      locked();
      await new Promise((res) => setTimeout(res, 1_500));
    }, { timeout: 30_000 });
    await holding;
    // wrapped: an async function returning the bare promise would make `await hold()` wait for the commit
    return { committed: tx.then(() => new Date()) }; // a B5 run ending after it waited on the row lock
  };

  it("e-mail verification holding the account row while B5 runs: the account survives as ACTIVE", async () => {
    const a = await account("PENDING", { createdAt: new Date(Date.now() - 8 * 86_400_000) });
    const self = await patient({ accountId: a.id, relation: "SELF" });
    const verify = await hold((t) => t.account.updateMany({ where: { id: a.id, status: "PENDING" }, data: { status: "ACTIVE", emailVerifiedAt: new Date() } }));
    const [res, committed] = await Promise.all([b5(), verify.committed]);
    expect(res.result.status).toBe("SUCCESS");
    expect(res.run!.endedAt!.getTime()).toBeGreaterThanOrEqual(committed.getTime() - 50);
    expect(await prisma.account.findUnique({ where: { id: a.id } })).toMatchObject({ status: "ACTIVE" });
    expect(await gone.patient(self.id)).not.toBeNull();
  });

  it("staff booking a future visit for a withdrawn account's patient under lockPerson: B5 re-checks and keeps it", async () => {
    const w = await account("WITHDRAWN", { withdrawnAt: new Date(Date.now() - 31 * 86_400_000) });
    const self = await patient({ accountId: w.id, relation: "SELF" });
    const staff = await hold(async (t) => {
      await lockPerson(t, self.id);
      await t.booking.create({
        data: {
          bookingNo: no(), clinicId: f.clinic.id, departmentId: f.dept.id, visitTypeId: f.visitType.id, doctorId: f.doctors[0].id, doctorRequested: true,
          patientId: self.id, channel: "PHONE", slotDate: dbDate(addDays(today, 3)), startTime: dbTime("10:00"), endTime: dbTime("10:15"),
        },
      });
    });
    const [res, committed] = await Promise.all([b5(), staff.committed]);
    expect(res.result.status).toBe("SUCCESS");
    expect(res.run!.endedAt!.getTime()).toBeGreaterThanOrEqual(committed.getTime() - 50);
    expect(await prisma.account.findUnique({ where: { id: w.id } })).not.toBeNull();
    expect((await gone.patient(self.id))!).toMatchObject({ anonymizedAt: null, familyName: "保存" });
  });

  it("a booking taking an old free frame at the same moment: frame and booking survive", async () => {
    const s = await slot(ago(95));
    const p = await patient();
    const taker = await hold(async (t) => {
      const b = await t.booking.create({
        data: {
          bookingNo: no(), clinicId: f.clinic.id, departmentId: f.dept.id, visitTypeId: f.visitType.id, doctorId: f.doctors[0].id, doctorRequested: true,
          patientId: p.id, channel: "COUNTER", slotDate: s.slotDate, startTime: s.startTime, endTime: s.endTime, status: "CHECKED_IN", checkedInAt: new Date(),
        },
      });
      await t.bookingSlot.create({ data: { bookingId: b.id, slotId: s.id } });
      await t.slot.update({ where: { id: s.id }, data: { reservedCount: { increment: 1 } } });
    });
    const [res, committed] = await Promise.all([b5(), taker.committed]);
    expect(res.result.status).toBe("SUCCESS"); // the re-check under FOR UPDATE drops the frame; no FK error reached
    expect(res.run!.endedAt!.getTime()).toBeGreaterThanOrEqual(committed.getTime() - 50);
    expect(await prisma.slot.findUnique({ where: { id: s.id } })).not.toBeNull();
    expect(await prisma.bookingSlot.count({ where: { slotId: s.id } })).toBe(1);
  });

  it("two runs at once: one does the work, the other ends SUCCESS 「実行中のため省略」", async () => {
    const old = await session(new Date(Date.now() - 40 * 86_400_000));
    const [a, b] = await Promise.all([b5(), b5()]);
    expect([a, b].filter((x) => x.result.message === "実行中のため省略")).toHaveLength(1);
    expect(a.result.written + b.result.written).toBeGreaterThanOrEqual(1);
    expect(await prisma.session.findUnique({ where: { id: old.id } })).toBeNull();
  });
});
