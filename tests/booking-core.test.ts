// Booking core (lib/booking): two parallel confirms for the last seat (one wins, the other PE030), one booking per draft
// (idempotency key), the rules and their order (window, cut-off, closure, capacity, limit, overlap), 指名なし assignment,
// change (frames moved, version, CHANGED, NT-03), cancel (frames freed, idempotent, PE044, deadline), field encryption.
// Own clinic from b2-helpers; frames are made directly inside the booking window (no B2 run).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cancelBooking, changeBooking, createBooking, PATIENT_CODE, STAFF_CODE, type Actor, type BookingInput } from "@/lib/booking/core";
import { beforeDeadline, deadlineOf, DEFAULT_POLICY } from "@/lib/booking/policy";
import { decryptJson, decryptText, encryptJson, encryptText } from "@/lib/crypto/field";
import { addDays, dbDate, dbTime, todayJst } from "@/lib/datetime";
import { pool, prisma } from "@/lib/prisma";
import { fixture, type Fixture } from "./b2-helpers";

process.env.NOTIFY_OUTBOX_DIR = mkdtempSync(path.join(tmpdir(), "core-outbox-"));
jest.setTimeout(60_000);

const DAY = addDays(todayJst(), 5);
let f: Fixture;
let runId: string;
let other: { id: string };
const extra: string[] = [];

beforeAll(async () => {
  f = await fixture({ doctors: 2 });
  runId = (await prisma.batchRun.create({
    data: { jobCode: "B2", trigger: "MANUAL", clinicId: f.clinic.id, startedAt: new Date(), endedAt: new Date(), status: "SUCCESS", readCount: 0, writtenCount: 0, errorCount: 0 },
  })).id;
  other = await person("他人");
});

afterAll(async () => {
  await f.cleanup();
  await prisma.patient.deleteMany({ where: { id: { in: extra } } });
  await prisma.$disconnect();
  await pool.end();
});

/** a staff-registered patient without an account (no lock shared with the fixture's account) */
async function person(given: string) {
  const p = await prisma.patient.create({
    data: {
      nameType: "JP", familyName: "試験", givenName: given, familyNameKana: "シケン", givenNameKana: "タニン", birthDate: dbDate("1985-05-05"),
      sex: "FEMALE", postcode: "1000001", prefecture: "東京都", city: "千代田区", addressLine: "1-1", phone: "09011112222", createdByKind: "STAFF",
    },
  });
  extra.push(p.id);
  return p;
}

/** frames of one doctor at DAY (15 min each) */
async function frames(doctorIdx: number, starts: string[], o: { capacity?: number; status?: "OPEN" | "CLOSED"; date?: string } = {}) {
  const out = [];
  for (const s of starts) {
    const [h, m] = s.split(":").map(Number);
    const end = `${String(h + Math.floor((m + 15) / 60)).padStart(2, "0")}:${String((m + 15) % 60).padStart(2, "0")}`;
    out.push(await prisma.slot.create({
      data: {
        clinicId: f.clinic.id, departmentId: f.dept.id, doctorId: f.doctors[doctorIdx].id, slotDate: dbDate(o.date ?? DAY),
        startTime: dbTime(s), endTime: dbTime(end), capacity: o.capacity ?? 1, status: o.status ?? "OPEN",
        closedReason: o.status === "CLOSED" ? "DOCTOR_OFF" : null, generatedRunId: runId,
      },
    }));
  }
  return out;
}

const patientActor = (): Actor => ({ kind: "PATIENT", accountId: f.admin.id, channel: "WEB" });
const staff: () => Actor = () => ({ kind: "STAFF", accountId: f.admin.id, channel: "PHONE" });
const input = (o: Partial<BookingInput>): BookingInput => ({
  clinicId: f.clinic.id, departmentId: f.dept.id, visitTypeId: f.visitType.id, patientId: f.patient.id, doctorId: f.doctors[0].id,
  doctorRequested: true, slotDate: DAY, startTime: "09:00", notes: null, ...o,
});
const reserved = async (id: string) => (await prisma.slot.findUniqueOrThrow({ where: { id } })).reservedCount;

describe("booking core", () => {
  it("two parallel confirms for the last seat: one booking, the other PE030; the frame is never over-booked", async () => {
    const [slot] = await frames(0, ["10:00"]);
    const results = await Promise.all([
      createBooking(input({ startTime: "10:00" }), patientActor()),
      createBooking(input({ startTime: "10:00", patientId: other.id }), staff()),
    ]);
    const ok = results.filter((r) => r.ok);
    const lost = results.filter((r) => !r.ok);
    expect(ok).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0].ok === false && lost[0].rule).toBe("TAKEN");
    expect(PATIENT_CODE.TAKEN).toBe("PE030");
    expect(STAFF_CODE.TAKEN).toBe("SE020");
    expect(await reserved(slot.id)).toBe(1);
    expect(await prisma.bookingSlot.count({ where: { slotId: slot.id } })).toBe(1);
  });

  it("one booking per draft: the same idempotency key twice (double press) creates one booking and returns it twice", async () => {
    await frames(1, ["11:00"]);
    const p = await person("二重");
    const req = () => createBooking(input({ patientId: p.id, doctorId: f.doctors[1].id, startTime: "11:00" }), staff(), { idempotencyKey: "draft-1" });
    const [a, b] = await Promise.all([req(), req()]);
    const c = await req();
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (a.ok && b.ok && c.ok) expect(new Set([a.bookingId, b.bookingId, c.bookingId]).size).toBe(1);
    expect(await prisma.booking.count({ where: { patientId: p.id } })).toBe(1);
  });

  it("writes the booking: number format, frames, CREATED, encrypted notes and 問診, NT-01 queued", async () => {
    const [slot] = await frames(0, ["15:00"]);
    const p = await person("記録");
    const r = await createBooking(input({ patientId: p.id, startTime: "15:00", notes: "頭痛があります", questionnaire: { formVersion: "2026.1", language: "JA", answers: { C01: "yes" } } }), staff());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bookingNo).toMatch(/^[A-HJ-NP-Z]{4}[0-9]{4}$/);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: r.bookingId }, include: { events: true, questionnaire: true, bookingSlots: true } });
    expect(b.bookingSlots.map((x) => x.slotId)).toEqual([slot.id]);
    expect(b.events.map((e) => e.event)).toEqual(["CREATED"]);
    expect(b.channel).toBe("PHONE");
    expect(decryptText(b.notes!)).toBe("頭痛があります");
    expect(decryptJson(b.questionnaire!.answers)).toEqual({ C01: "yes" });
    // no account and sms_opt_in off: no recipient, no row (S02 SW021 case)
    expect(r.notificationId).toBeNull();
  });

  it("queues NT-01 to the account holder by MAIL, with the 04 §6.1 values", async () => {
    await frames(1, ["16:00"]);
    // the fixture patient may hold the 10:00 booking of the first test: the limit is not what this test checks
    const r = await createBooking(input({ doctorId: f.doctors[1].id, startTime: "16:00" }), patientActor(), { overrideLimit: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const n = await prisma.notification.findUniqueOrThrow({ where: { id: r.notificationId! } });
    expect([n.event, n.channel, n.toAddress]).toEqual(["NT01_BOOKED", "MAIL", `${f.tag}.patient.w1test@example.jp`]);
    expect(["SENT", "QUEUED"]).toContain(n.status);
  });

  it("rules: window, cut-off (patients only), closure, limit (staff may override), overlap, in the patient order", async () => {
    const p = await person("規則");
    const far = addDays(todayJst(), 31);
    await frames(0, ["09:00"], { date: far });
    const w = await createBooking(input({ patientId: p.id, slotDate: far }), patientActor());
    expect(!w.ok && w.rule).toBe("WINDOW");

    await frames(1, ["12:00"], { status: "CLOSED" });
    const c = await createBooking(input({ patientId: p.id, doctorId: f.doctors[1].id, startTime: "12:00" }), patientActor());
    expect(!c.ok && c.rule).toBe("CLOSED");

    await frames(0, ["09:30", "09:45"]);
    expect((await createBooking(input({ patientId: p.id, startTime: "09:30" }), staff())).ok).toBe(true);
    const lim = await createBooking(input({ patientId: p.id, startTime: "09:45" }), staff());
    expect(!lim.ok && lim.rule).toBe("LIMIT");
    expect(!lim.ok && lim.sameDayBookingNos).toHaveLength(1);
    expect((await createBooking(input({ patientId: p.id, startTime: "09:45" }), staff(), { overrideLimit: true })).ok).toBe(true);

    await frames(1, ["09:30"]);
    const ov = await createBooking(input({ patientId: p.id, doctorId: f.doctors[1].id, startTime: "09:30" }), staff(), { overrideLimit: true });
    expect(!ov.ok && ov.rule).toBe("OVERLAP");
    const both = await createBooking(input({ patientId: p.id, doctorId: f.doctors[1].id, startTime: "09:30" }), patientActor());
    expect(!both.ok && both.failed).toEqual(["LIMIT", "OVERLAP"]); // patient order: PE033 before PE034
  });

  it("same-day cut-off applies to patients, not to staff", async () => {
    const today = todayJst();
    const p = await person("当日");
    await frames(0, ["00:00"], { date: today });
    const pa = await createBooking(input({ patientId: p.id, slotDate: today, startTime: "00:00" }), patientActor());
    expect(!pa.ok && pa.rule).toBe("CUTOFF");
    expect((await createBooking(input({ patientId: p.id, slotDate: today, startTime: "00:00" }), staff())).ok).toBe(true);
  });

  it("指名なし: the least-booked doctor with the whole run free; tie by display_order", async () => {
    const p1 = await person("指名1");
    const p2 = await person("指名2");
    await frames(0, ["13:00"]);
    await frames(1, ["13:00"]);
    const day0 = await prisma.booking.count({ where: { doctorId: f.doctors[0].id, slotDate: dbDate(DAY), status: { in: ["RESERVED", "CHECKED_IN"] } } });
    const day1 = await prisma.booking.count({ where: { doctorId: f.doctors[1].id, slotDate: dbDate(DAY), status: { in: ["RESERVED", "CHECKED_IN"] } } });
    const r = await createBooking(input({ patientId: p1.id, doctorId: null, doctorRequested: false, startTime: "13:00" }), patientActor());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: r.bookingId } });
    expect(b.doctorId).toBe(day1 < day0 ? f.doctors[1].id : f.doctors[0].id);
    expect(b.doctorRequested).toBe(false);
    const r2 = await createBooking(input({ patientId: p2.id, doctorId: null, doctorRequested: false, startTime: "13:00" }), patientActor());
    expect(r2.ok).toBe(true);
    const r3 = await createBooking(input({ patientId: other.id, doctorId: null, doctorRequested: false, startTime: "13:00" }), patientActor());
    expect(!r3.ok && r3.rule).toBe("TAKEN");
  });

  it("change: old frames released, new frames held, version + 1, CHANGED with before / after; a stale version is refused", async () => {
    const p = await person("変更");
    const [a] = await frames(0, ["14:00"]);
    const [b] = await frames(0, ["14:15"]);
    const r = await createBooking(input({ patientId: p.id, startTime: "14:00" }), staff());
    if (!r.ok) throw new Error("setup");
    const stale = await changeBooking(r.bookingId, 5, input({ patientId: p.id, startTime: "14:15" }), staff());
    expect(!stale.ok && stale.rule).toBe("STALE");
    // its own frame counts as free and its own booking is not a limit / overlap
    const same = await changeBooking(r.bookingId, 0, input({ patientId: p.id, startTime: "14:00", notes: "変更後" }), staff());
    expect(same.ok).toBe(true);
    const moved = await changeBooking(r.bookingId, 1, input({ patientId: p.id, startTime: "14:15" }), staff());
    expect(moved.ok).toBe(true);
    expect([await reserved(a.id), await reserved(b.id)]).toEqual([0, 1]);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: r.bookingId }, include: { events: { orderBy: { id: "asc" } } } });
    expect([row.version, row.changeCount, row.bookingNo]).toEqual([2, 2, r.bookingNo]);
    expect(row.events.map((e) => e.event)).toEqual(["CREATED", "CHANGED", "CHANGED"]);
    expect(row.events[2].before).toMatchObject({ start: "14:00" });
    expect(row.events[2].after).toMatchObject({ start: "14:15" });
  });

  it("cancel: frames freed at once, double submit with one key cancels once, a later cancel is PE044", async () => {
    const p = await person("取消");
    const [s] = await frames(1, ["14:30"]);
    const r = await createBooking(input({ patientId: p.id, doctorId: f.doctors[1].id, startTime: "14:30" }), staff());
    if (!r.ok) throw new Error("setup");
    const c = { bookingId: r.bookingId, reasonCode: "SCHEDULE" as const, reasonText: null };
    const [x, y] = await Promise.all([cancelBooking(c, staff(), { idempotencyKey: "cancel-1" }), cancelBooking(c, staff(), { idempotencyKey: "cancel-1" })]);
    expect(x.ok && y.ok).toBe(true);
    expect(await reserved(s.id)).toBe(0);
    const again = await cancelBooking(c, staff());
    expect(!again.ok && again.rule).toBe("ALREADY_CANCELED");
    expect(PATIENT_CODE.ALREADY_CANCELED).toBe("PE044");
    const events = await prisma.bookingEvent.findMany({ where: { bookingId: r.bookingId } });
    expect(events.map((e) => e.event).sort()).toEqual(["CANCELED", "CREATED"]);
  });

  it("two parallel cancels without a key: one cancels, the other gets PE044", async () => {
    const p = await person("並行取消");
    await frames(0, ["16:30"]);
    const r = await createBooking(input({ patientId: p.id, startTime: "16:30" }), staff());
    if (!r.ok) throw new Error("setup");
    const c = { bookingId: r.bookingId, reasonCode: "OTHER" as const, reasonText: "理由" };
    const out = await Promise.all([cancelBooking(c, staff()), cancelBooking(c, staff())]);
    expect(out.filter((o) => o.ok)).toHaveLength(1);
    expect(out.find((o) => !o.ok)).toMatchObject({ rule: "ALREADY_CANCELED" });
  });

  it("patient cancel after the deadline is refused (PE041); staff are not bound (F5-04)", async () => {
    const today = todayJst();
    const p = await person("期限");
    await frames(1, ["23:30"], { date: today });
    const r = await createBooking(input({ patientId: p.id, doctorId: f.doctors[1].id, slotDate: today, startTime: "23:30" }), staff());
    if (!r.ok) throw new Error("setup");
    const c = { bookingId: r.bookingId, reasonCode: "SCHEDULE" as const, reasonText: null };
    const late = await cancelBooking(c, patientActor());
    expect(!late.ok && late.rule).toBe("DEADLINE");
    expect((await cancelBooking(c, staff())).ok).toBe(true);
  });
});

describe("policy and encryption", () => {
  it("deadline: previous day at the time, or start − hours; inside until the shown minute + 1 minute", () => {
    const d = deadlineOf(DEFAULT_POLICY, "2026-10-21", "09:30");
    expect(d.toISOString()).toBe("2026-10-20T14:59:00.000Z"); // 2026-10-20 23:59 JST
    expect(beforeDeadline(DEFAULT_POLICY, "2026-10-21", "09:30", new Date("2026-10-20T14:59:59Z"))).toBe(true);
    expect(beforeDeadline(DEFAULT_POLICY, "2026-10-21", "09:30", new Date("2026-10-20T15:00:00Z"))).toBe(false);
    const h = { ...DEFAULT_POLICY, cancelDeadlineType: "HOURS_BEFORE" as const, cancelDeadlineHours: 3 };
    expect(deadlineOf(h, "2026-10-21", "09:30").toISOString()).toBe("2026-10-20T21:30:00.000Z"); // 06:30 JST
  });

  it("field encryption round-trips and differs per write", () => {
    const a = encryptText("メモ");
    expect(decryptText(a)).toBe("メモ");
    expect(Buffer.from(a).equals(Buffer.from(encryptText("メモ")))).toBe(false);
    expect(decryptJson(encryptJson({ q: [1, 2] }))).toEqual({ q: [1, 2] });
  });
});
