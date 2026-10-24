// B1 前日リマインド and the X1 / X2 send rules end to end on the slot database (fake transport, moved clock):
// selection (tomorrow, RESERVED, created before the run, not within 24 h), dry run, re-run and two runners at once (the partial
// unique index notifications_remind_once), a booking cancelled while B1 runs, 5xx → +1 / +5 / +30 min → FAILED, 429 / timeout
// retried, 4xx FAILED at once (run PARTIAL), 5xx then success, LINE refused → the same notice by MAIL.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { remindClinic } from "@/lib/batch/b1-remind";
import { runJob } from "@/lib/batch/runner";
import { cancelInTx } from "@/lib/booking/core";
import { addDays, dbDate, dbTime, todayJst } from "@/lib/datetime";
import { deliverDue } from "@/lib/notify/queue";
import * as transport from "@/lib/notify/transport";
import { pool, prisma } from "@/lib/prisma";
import { fixture, type Fixture } from "./b2-helpers";

process.env.NOTIFY_OUTBOX_DIR = mkdtempSync(path.join(tmpdir(), "b1-outbox-"));
jest.setTimeout(60_000);

let f: Fixture;
let seq = 0;
const today = todayJst();
const tomorrow = addDays(today, 1);
const noon = new Date(`${today}T12:00:00+09:00`); // run clock inside the LINE / SMS sending hours
const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
const accounts: string[] = [];
const patients: string[] = [];

beforeAll(async () => {
  f = await fixture({ doctors: 1 });
});
afterAll(async () => {
  await f.cleanup();
  await prisma.patient.deleteMany({ where: { id: { in: patients } } });
  await prisma.account.deleteMany({ where: { id: { in: accounts } } });
  await prisma.$disconnect();
  await pool.end();
});

/** an account holder (SELF patient) whose mail address picks the fake provider's answer; or a staff-registered patient */
async function person(o: { email?: string; line?: string; account?: boolean } = {}) {
  const tag = `${f.tag}x${++seq}`;
  const account = o.account === false ? null : await prisma.account.create({
    data: {
      email: o.email ?? `${tag}.w4test@example.jp`, passwordHash: "x", role: "PATIENT", status: "ACTIVE", language: "JA",
      notifyChannel: o.line ? "LINE" : "MAIL", lineUserId: o.line ?? null, lineFriend: o.line ? "FOLLOWING" : null,
    },
  });
  if (account) accounts.push(account.id);
  const p = await prisma.patient.create({
    data: {
      accountId: account?.id ?? null, relation: account ? "SELF" : null, nameType: "JP", familyName: "試験", givenName: `患者${seq}`, familyNameKana: "シケン",
      givenNameKana: "カンジャ", birthDate: dbDate("1990-01-01"), sex: "FEMALE", postcode: "1000001", prefecture: "東京都", city: "千代田区", addressLine: "1-1",
      phone: "09000000000", createdByKind: account ? "PATIENT" : "STAFF",
    },
  });
  patients.push(p.id);
  return p;
}
const no = () => `RM${"ABCDEFGHJK"[Math.floor(seq / 10) % 10]}${"ABCDEFGHJK"[seq % 10]}${String(++seq).padStart(4, "0")}`;
async function booking(patientId: string, o: { date?: string; createdAt?: Date; start?: string; status?: "RESERVED" | "CANCELED" } = {}) {
  const start = o.start ?? "10:00";
  return prisma.booking.create({
    data: {
      bookingNo: no(), clinicId: f.clinic.id, departmentId: f.dept.id, visitTypeId: f.visitType.id, doctorId: f.doctors[0].id, doctorRequested: false,
      patientId, channel: "WEB", slotDate: dbDate(o.date ?? tomorrow), startTime: dbTime(start), endTime: dbTime(`${start.slice(0, 3)}${start.endsWith("00") ? "15" : "45"}`),
      createdAt: o.createdAt ?? twoDaysAgo, status: o.status ?? "RESERVED",
      ...(o.status === "CANCELED" && { canceledAt: new Date(), canceledByKind: "STAFF" as const, cancelReasonCode: "OTHER" as const, cancelReasonText: "x" }),
    },
  });
}
const reminders = (bookingId: string) => prisma.notification.findMany({ where: { bookingId, event: "NT02_REMIND" }, orderBy: { queuedAt: "asc" } });
const plus = (min: number) => new Date(noon.getTime() + min * 60_000);

describe("B1 selection, dry run, idempotency", () => {
  let ok: { id: string };
  let late: { id: string };
  let none: { id: string };
  let canceled: { id: string };
  let other: { id: string };

  it("dry run counts and writes nothing; the run sends NT-02 by MAIL with the 04 values; skips within 24 h, no recipient, cancelled, other days", async () => {
    ok = await booking((await person()).id);
    late = await booking((await person()).id, { createdAt: new Date(`${today}T11:00:00+09:00`) }); // < 24 h before 10:00 tomorrow
    none = await booking((await person({ account: false })).id); // staff-registered, no sms_opt_in
    canceled = await booking((await person()).id, { status: "CANCELED" });
    other = await booking((await person()).id, { date: addDays(today, 2) });

    const dry = await remindClinic(f.clinic.id, tomorrow, noon, true);
    expect(dry).toMatchObject({ read: 3, queued: 1, within24h: 1, noRecipient: 1, failed: 0 });
    expect(await prisma.notification.count({ where: { booking: { clinicId: f.clinic.id } } })).toBe(0);

    const run = await remindClinic(f.clinic.id, tomorrow, noon, false);
    expect(run).toMatchObject({ read: 3, queued: 1, within24h: 1, noRecipient: 1, failed: 0 });
    const [n] = await reminders(ok.id);
    expect([n.channel, n.status, n.attempts]).toEqual(["MAIL", "SENT", 1]);
    for (const b of [late, none, canceled, other]) expect(await reminders(b.id)).toHaveLength(0);
  });

  it("re-run writes nothing new (already sent)", async () => {
    const again = await remindClinic(f.clinic.id, tomorrow, noon, false);
    expect(again).toMatchObject({ queued: 0, already: 1 });
    expect(await reminders(ok.id)).toHaveLength(1);
  });

  it("the partial unique index refuses a second NT-02 for booking × channel (P2002); other events are not limited", async () => {
    const base = { event: "NT02_REMIND" as const, channel: "MAIL" as const, language: "JA" as const, toAddress: "a@example.jp", bookingId: ok.id, status: "QUEUED" as const, queuedAt: new Date() };
    await expect(prisma.notification.create({ data: base })).rejects.toMatchObject({ code: "P2002" });
    await expect(prisma.notification.create({ data: base })).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    const nt01 = await prisma.notification.create({ data: { ...base, event: "NT01_BOOKED" } });
    await prisma.notification.create({ data: { ...base, event: "NT01_BOOKED" } });
    expect(nt01.id).toBeTruthy();
  });

  it("two runners at once (no advisory lock between them): one NT-02 per booking, the loser counts it as already sent", async () => {
    const bs = await Promise.all([1, 2, 3].map(async () => booking((await person()).id, { start: "11:00" })));
    const [x, y] = await Promise.all([remindClinic(f.clinic.id, tomorrow, noon, false), remindClinic(f.clinic.id, tomorrow, noon, false)]);
    expect(x.queued + y.queued).toBe(3);
    for (const b of bs) expect(await reminders(b.id)).toHaveLength(1);
  });

  it("Q-033: targets read in chunks, every chunk sent in the same run (chunk 2, 5 new targets → 5 reminders, ≥ 3 reads)", async () => {
    const bs = await Promise.all([1, 2, 3, 4, 5].map(async () => booking((await person()).id, { start: "11:30" })));
    const reads = jest.spyOn(prisma.booking, "findMany");
    const c = await remindClinic(f.clinic.id, tomorrow, noon, false, 2);
    expect(reads.mock.calls.length).toBeGreaterThanOrEqual(3);
    reads.mockRestore();
    expect(c.queued).toBe(5);
    for (const b of bs) expect(await reminders(b.id)).toHaveLength(1);
    expect(await remindClinic(f.clinic.id, tomorrow, noon, false, 2)).toMatchObject({ queued: 0 }); // re-run: only the unsent
  });

  it("two B1 jobs at once through the runner: one is skipped 「実行中のため省略」", async () => {
    const [x, y] = await Promise.all([runJob("B1", { trigger: "MANUAL", clinicId: f.clinic.id }), runJob("B1", { trigger: "MANUAL", clinicId: f.clinic.id })]);
    expect([x, y].filter((r) => r.result.message === "実行中のため省略")).toHaveLength(1);
  });

  it("a booking cancelled while B1 runs gets no reminder (the cancel holds the booking lock; B1 reads it FOR SHARE)", async () => {
    const p = await person();
    const b = await booking(p.id, { start: "12:00" });
    let locked!: () => void;
    const holding = new Promise<void>((r) => { locked = r; });
    const cancel = prisma.$transaction(async (tx) => {
      const r = await cancelInTx(tx, { bookingId: b.id, reasonCode: "SCHEDULE", reasonText: null }, { kind: "STAFF", accountId: f.admin.id, channel: "PHONE" }, { notify: false });
      expect(r.ok).toBe(true);
      locked();
      await new Promise((res) => setTimeout(res, 500));
    });
    await holding;
    const [r] = await Promise.all([remindClinic(f.clinic.id, tomorrow, noon, false), cancel]);
    expect(r.skipped).toBe(1);
    expect(await reminders(b.id)).toHaveLength(0);
  });
});

describe("X1 / X2 retry rules (lib/notify/queue) through B1", () => {
  it("5xx: retried at +1, +5, +30 min, then FAILED (4 attempts); nothing is sent before the retry time", async () => {
    const b = await booking((await person({ email: `${f.tag}.fail500.w4test@example.jp` })).id, { start: "13:00" });
    await remindClinic(f.clinic.id, tomorrow, noon, false);
    let [n] = await reminders(b.id);
    expect([n.status, n.attempts, n.nextAttemptAt?.getTime()]).toEqual(["QUEUED", 1, plus(1).getTime()]);
    await deliverDue(plus(0.5));
    expect((await reminders(b.id))[0].attempts).toBe(1);
    for (const [at, attempts, next] of [[1, 2, 6], [6, 3, 36]] as const) {
      await deliverDue(plus(at));
      [n] = await reminders(b.id);
      expect([n.status, n.attempts, n.nextAttemptAt?.getTime()]).toEqual(["QUEUED", attempts, plus(next).getTime()]);
    }
    await deliverDue(plus(36));
    [n] = await reminders(b.id);
    expect([n.status, n.attempts, n.nextAttemptAt, n.lastError]).toEqual(["FAILED", 4, null, "fake: fail500"]);
  });

  it("429 and timeout are retried; 4xx is FAILED at once without retry and the job ends PARTIAL", async () => {
    const r429 = await booking((await person({ email: `${f.tag}.fail429.w4test@example.jp` })).id, { start: "14:00" });
    const rto = await booking((await person({ email: `${f.tag}.timeout.w4test@example.jp` })).id, { start: "14:15" });
    const r400 = await booking((await person({ email: `${f.tag}.fail400.w4test@example.jp` })).id, { start: "14:30" });
    const run = await runJob("B1", { trigger: "MANUAL", clinicId: f.clinic.id });
    expect(run.result.status).toBe("PARTIAL");
    expect(run.run!.status).toBe("PARTIAL");
    expect((await reminders(r429.id))[0]).toMatchObject({ status: "QUEUED", attempts: 1 });
    expect((await reminders(rto.id))[0]).toMatchObject({ status: "QUEUED", attempts: 1 });
    const [n] = await reminders(r400.id);
    expect([n.status, n.attempts, n.nextAttemptAt]).toEqual(["FAILED", 1, null]);
  });

  it("5xx then success: the retry at +1 min sends (SENT, 2 attempts, provider id)", async () => {
    const b = await booking((await person()).id, { start: "15:00" });
    const spy = jest.spyOn(transport, "send").mockResolvedValueOnce({ ok: false, retry: true, error: "HTTP 503" });
    await remindClinic(f.clinic.id, tomorrow, noon, false);
    expect((await reminders(b.id))[0]).toMatchObject({ status: "QUEUED", attempts: 1, lastError: "HTTP 503" });
    await deliverDue(plus(1));
    const [n] = await reminders(b.id);
    expect([n.status, n.attempts]).toEqual(["SENT", 2]);
    expect(n.providerMessageId).toMatch(/^fake-/);
    spy.mockRestore();
  });

  it("a reminder waiting for its retry is SKIPPED, not sent, once the booking is cancelled", async () => {
    const b = await booking((await person()).id, { start: "15:30" });
    const spy = jest.spyOn(transport, "send").mockResolvedValueOnce({ ok: false, retry: true, error: "HTTP 503" });
    await remindClinic(f.clinic.id, tomorrow, noon, false);
    spy.mockRestore();
    await prisma.booking.update({ where: { id: b.id }, data: { status: "CANCELED", canceledAt: noon, canceledByKind: "STAFF", cancelReasonCode: "OTHER" } });
    const sent = jest.spyOn(transport, "send");
    await deliverDue(plus(1));
    expect(sent).not.toHaveBeenCalled();
    sent.mockRestore();
    expect((await reminders(b.id))[0]).toMatchObject({ status: "SKIPPED", attempts: 1 });
  });

  it("a row that throws while sending is FAILED and does not block the other due rows", async () => {
    const a = await booking((await person()).id, { start: "16:00" });
    const b = await booking((await person()).id, { start: "16:15" });
    const spy = jest.spyOn(transport, "send").mockResolvedValue({ ok: false, retry: true, error: "HTTP 503" });
    await remindClinic(f.clinic.id, tomorrow, noon, false);
    const broken = (await reminders(a.id))[0].id;
    spy.mockReset();
    spy.mockImplementation(async (m) => {
      if (m.notificationId === broken) throw new Error("render broke");
      return { ok: true, providerMessageId: "fake-x" };
    });
    await deliverDue(plus(1));
    spy.mockRestore();
    expect((await reminders(a.id))[0]).toMatchObject({ status: "FAILED", lastError: "render broke" });
    expect((await reminders(b.id))[0]).toMatchObject({ status: "SENT" });
  });

  it("LINE refused (400): the LINE row is FAILED and the same NT-02 goes by MAIL to the account address — not a failure of the run (Q-042)", async () => {
    const p = await person({ line: `U${f.tag}fail400` });
    const b = await booking(p.id, { start: "15:30" });
    const c = await remindClinic(f.clinic.id, tomorrow, noon, false);
    const rows = await reminders(b.id);
    expect(rows.map((r) => [r.channel, r.status])).toEqual([["LINE", "FAILED"], ["MAIL", "SENT"]]);
    expect(rows[1].toAddress).toMatch(/\.w4test@example\.jp$/);
    expect([c.queued, c.failed]).toEqual([1, 0]);
  });

  it("LINE refused and the MAIL fallback refused too: the notice reached no channel → counted failed (run PARTIAL, Q-042)", async () => {
    const p = await person({ line: `U${f.tag}both.fail400`, email: `${f.tag}.both.fail400.w4test@example.jp` });
    const b = await booking(p.id, { start: "17:00" });
    const c = await remindClinic(f.clinic.id, tomorrow, noon, false);
    expect((await reminders(b.id)).map((r) => [r.channel, r.status])).toEqual([["LINE", "FAILED"], ["MAIL", "FAILED"]]);
    expect([c.queued, c.failed]).toEqual([1, 1]);
  });

  it("LINE inside the quiet hours (21:00–08:00) is held until 08:00, not sent", async () => {
    const p = await person({ line: `U${f.tag}ok` });
    const b = await booking(p.id, { start: "16:00" });
    const night = new Date(`${today}T21:30:00+09:00`);
    await remindClinic(f.clinic.id, tomorrow, night, false);
    const [n] = await reminders(b.id);
    expect([n.status, n.attempts, n.nextAttemptAt?.toISOString()]).toEqual(["QUEUED", 0, new Date(`${tomorrow}T08:00:00+09:00`).toISOString()]);
  });
});
