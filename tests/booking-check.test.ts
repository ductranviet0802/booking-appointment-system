// checkBooking (read-only core entry, P11 event 11) and the write path run the same rules: one table of cases, each run
// through checkBooking (nothing written) and then createBooking / changeBooking (same rule, same failed list).
// Own clinic from b2-helpers; doctor 2 is deactivated; frames are made directly inside the booking window.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  changeBooking, checkBooking, createBooking, type Actor, type BookingInput, type Options, type Rule,
} from "@/lib/booking/core";
import { addDays, dbDate, dbTime, todayJst } from "@/lib/datetime";
import { pool, prisma } from "@/lib/prisma";
import { fixture, type Fixture } from "./b2-helpers";

process.env.NOTIFY_OUTBOX_DIR = mkdtempSync(path.join(tmpdir(), "check-outbox-"));
jest.setTimeout(90_000);

let f: Fixture;
let runId: string;
let DAY: string;
const extra: string[] = [];

beforeAll(async () => {
  f = await fixture({ doctors: 3 });
  await prisma.doctor.update({ where: { id: f.doctors[2].id }, data: { isActive: false } });
  runId = (await prisma.batchRun.create({
    data: { jobCode: "B2", trigger: "MANUAL", clinicId: f.clinic.id, startedAt: new Date(), endedAt: new Date(), status: "SUCCESS", readCount: 0, writtenCount: 0, errorCount: 0 },
  })).id;
  DAY = await openWeekday(3); // the calendar rules of A-5 must not hit it
});

/** the first weekday (the fixture's hours: Mon–Fri) without a holiday, `from` days after today or later */
async function openWeekday(from: number) {
  for (let i = from; ; i++) {
    const d = addDays(todayJst(), i);
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd >= 1 && wd <= 5 && !(await prisma.holiday.count({ where: { holidayDate: dbDate(d) } }))) return d;
  }
}

afterAll(async () => {
  await f.cleanup();
  await prisma.patient.deleteMany({ where: { id: { in: extra } } });
  await prisma.$disconnect();
  await pool.end();
});

let seq = 0;
async function person() {
  const p = await prisma.patient.create({
    data: {
      nameType: "JP", familyName: "確認", givenName: `患者${++seq}`, familyNameKana: "カクニン", givenNameKana: "カンジャ", birthDate: dbDate("1985-05-05"),
      sex: "FEMALE", postcode: "1000001", prefecture: "東京都", city: "千代田区", addressLine: "1-1", phone: "09011112222", createdByKind: "STAFF",
    },
  });
  extra.push(p.id);
  return p;
}

async function frames(doctorIdx: number, starts: string[], o: { reserved?: number; status?: "OPEN" | "CLOSED"; date?: string } = {}) {
  for (const s of starts) {
    const [h, m] = s.split(":").map(Number);
    const end = `${String(h + Math.floor((m + 15) / 60)).padStart(2, "0")}:${String((m + 15) % 60).padStart(2, "0")}`;
    await prisma.slot.create({
      data: {
        clinicId: f.clinic.id, departmentId: f.dept.id, doctorId: f.doctors[doctorIdx].id, slotDate: dbDate(o.date ?? DAY),
        startTime: dbTime(s), endTime: dbTime(end), capacity: 1, reservedCount: o.reserved ?? 0, status: o.status ?? "OPEN",
        closedReason: o.status === "CLOSED" ? "DOCTOR_OFF" : null, generatedRunId: runId,
      },
    });
  }
}

const patientActor = (): Actor => ({ kind: "PATIENT", accountId: f.admin.id, channel: "WEB" });
const staff = (): Actor => ({ kind: "STAFF", accountId: f.admin.id, channel: "PHONE" });
const input = (patientId: string, o: Partial<BookingInput> = {}): BookingInput => ({
  clinicId: f.clinic.id, departmentId: f.dept.id, visitTypeId: f.visitType.id, patientId, doctorId: f.doctors[0].id,
  doctorRequested: true, slotDate: DAY, startTime: "09:00", notes: null, ...o,
});
const written = async () => ({
  bookings: await prisma.booking.count({ where: { clinicId: f.clinic.id } }),
  events: await prisma.bookingEvent.count({ where: { booking: { clinicId: f.clinic.id } } }),
  reserved: (await prisma.slot.aggregate({ where: { clinicId: f.clinic.id }, _sum: { reservedCount: true } }))._sum.reservedCount,
});
const book = async (patientId: string, start: string, doctorIdx = 0) => {
  const r = await createBooking(input(patientId, { startTime: start, doctorId: f.doctors[doctorIdx].id }), staff(), { overrideLimit: true });
  if (!r.ok) throw new Error(`setup ${r.rule}`);
  return r;
};

type Setup = { inp: BookingInput; actor: Actor; opts?: Options; change?: { bookingId: string; version: number } };
type Case = [name: string, failed: Rule[], setup: () => Promise<Setup>];

const cases: Case[] = [
  ["free frame → ok", [], async () => {
    await frames(0, ["09:00"]);
    return { inp: input((await person()).id), actor: patientActor() };
  }],
  ["outside the window → WINDOW (PE031)", ["WINDOW"], async () => {
    const far = addDays(todayJst(), 31);
    await frames(0, ["09:00"], { date: far });
    return { inp: input((await person()).id, { slotDate: far }), actor: patientActor() };
  }],
  ["today inside the cut-off → CUTOFF for a patient (PE032)", ["CUTOFF"], async () => {
    await frames(0, ["00:00"], { date: todayJst() });
    return { inp: input((await person()).id, { slotDate: todayJst(), startTime: "00:00" }), actor: patientActor() };
  }],
  ["CLOSED frame → CLOSED (PE035)", ["CLOSED"], async () => {
    await frames(1, ["09:15"], { status: "CLOSED" });
    return { inp: input((await person()).id, { doctorId: f.doctors[1].id, startTime: "09:15" }), actor: patientActor() };
  }],
  ["A-5: no frames on a date clinic_calendar_days closes → CLOSED (PE035)", ["CLOSED"], async () => {
    const d = await openWeekday(12);
    await f.calendar(d, "CLOSED");
    return { inp: input((await person()).id, { slotDate: d, startTime: "10:00" }), actor: patientActor() };
  }],
  ["A-5: no frames on a national holiday → CLOSED (PE035)", ["CLOSED"], async () => {
    const d = await openWeekday(16);
    await f.holiday(d);
    return { inp: input((await person()).id, { slotDate: d, doctorId: null, doctorRequested: false, startTime: "10:00" }), actor: patientActor() };
  }],
  ["A-5: no frames on an open weekday → TAKEN (PE030), not a closure", ["TAKEN"], async () => {
    const d = await openWeekday(20);
    return { inp: input((await person()).id, { slotDate: d, startTime: "10:00" }), actor: patientActor() };
  }],
  ["full frame → TAKEN (PE030)", ["TAKEN"], async () => {
    await frames(1, ["09:30"], { reserved: 1 });
    return { inp: input((await person()).id, { doctorId: f.doctors[1].id, startTime: "09:30" }), actor: patientActor() };
  }],
  ["指名なし: only a deactivated doctor's frame → TAKEN", ["TAKEN"], async () => {
    await frames(2, ["09:45"]);
    return { inp: input((await person()).id, { doctorId: null, doctorRequested: false, startTime: "09:45" }), actor: patientActor() };
  }],
  ["a deactivated doctor chosen → TAKEN", ["TAKEN"], async () => {
    await frames(2, ["10:00"]);
    return { inp: input((await person()).id, { doctorId: f.doctors[2].id, startTime: "10:00" }), actor: patientActor() };
  }],
  ["a RESERVED booking the same day at the clinic → LIMIT (staff: SW020)", ["LIMIT"], async () => {
    const p = await person();
    await frames(0, ["10:15", "10:30"]);
    await book(p.id, "10:15");
    return { inp: input(p.id, { startTime: "10:30" }), actor: staff() };
  }],
  ["Q-046: a CHECKED_IN booking the same day at the clinic counts for the limit (patient: PE033)", ["LIMIT"], async () => {
    const p = await person();
    await frames(0, ["16:00", "16:15"]);
    const b = await book(p.id, "16:00");
    await prisma.booking.update({ where: { id: b.bookingId }, data: { status: "CHECKED_IN", checkedInAt: new Date() } });
    return { inp: input(p.id, { startTime: "16:15" }), actor: patientActor() };
  }],
  ["Q-046: a NO_SHOW booking the same day does not count", [], async () => {
    const p = await person();
    await frames(0, ["16:30", "16:45"]);
    const b = await book(p.id, "16:30");
    await prisma.booking.update({ where: { id: b.bookingId }, data: { status: "NO_SHOW" } });
    return { inp: input(p.id, { startTime: "16:45" }), actor: patientActor() };
  }],
  ["Q-046 change mode: the booking being changed is not counted, a CHECKED_IN sibling is", ["LIMIT"], async () => {
    const p = await person();
    await frames(0, ["17:00", "17:15", "17:30"]);
    const done = await book(p.id, "17:00");
    await prisma.booking.update({ where: { id: done.bookingId }, data: { status: "CHECKED_IN", checkedInAt: new Date() } });
    const b = await book(p.id, "17:15");
    return { inp: input(p.id, { startTime: "17:30" }), actor: patientActor(), change: { bookingId: b.bookingId, version: 0 } };
  }],
  ["overlap with the person's own booking (limit overridden) → OVERLAP", ["OVERLAP"], async () => {
    const p = await person();
    await frames(0, ["10:45"]);
    await frames(1, ["10:45"]);
    await book(p.id, "10:45");
    return { inp: input(p.id, { doctorId: f.doctors[1].id, startTime: "10:45" }), actor: staff(), opts: { overrideLimit: true } };
  }],
  ["limit and overlap together, patient order → LIMIT, OVERLAP", ["LIMIT", "OVERLAP"], async () => {
    const p = await person();
    await frames(0, ["11:00"]);
    await frames(1, ["11:00"]);
    await book(p.id, "11:00");
    return { inp: input(p.id, { doctorId: f.doctors[1].id, startTime: "11:00" }), actor: patientActor() };
  }],
  ["change mode: own frame free, own booking no limit / overlap → ok", [], async () => {
    const p = await person();
    await frames(0, ["11:15"]);
    const b = await book(p.id, "11:15");
    return { inp: input(p.id, { startTime: "11:15" }), actor: patientActor(), change: { bookingId: b.bookingId, version: 0 } };
  }],
  ["change mode: another version → STALE", ["STALE"], async () => {
    const p = await person();
    await frames(0, ["11:30", "11:45"]);
    const b = await book(p.id, "11:30");
    return { inp: input(p.id, { startTime: "11:45" }), actor: patientActor(), change: { bookingId: b.bookingId, version: 7 } };
  }],
  ["change mode: a cancelled booking → NOT_RESERVED", ["NOT_RESERVED"], async () => {
    const p = await person();
    await frames(0, ["15:00", "15:15"]);
    const b = await book(p.id, "15:00");
    await prisma.booking.update({ where: { id: b.bookingId }, data: { status: "CANCELED", canceledAt: new Date(), canceledByKind: "STAFF", cancelReasonCode: "OTHER", cancelReasonText: "x" } });
    return { inp: input(p.id, { startTime: "15:15" }), actor: patientActor(), change: { bookingId: b.bookingId, version: 0 } };
  }],
];

describe("checkBooking and the write path: one table of rules", () => {
  it.each(cases)("%s", async (_name, failed, setup) => {
    const s = await setup();
    const before = await written();
    const check = await checkBooking(s.inp, s.actor, s.opts, s.change);
    expect(await written()).toEqual(before); // read only
    const write = s.change ? await changeBooking(s.change.bookingId, s.change.version, s.inp, s.actor, s.opts) : await createBooking(s.inp, s.actor, s.opts);
    const outcome = (r: typeof check | typeof write) => (r.ok ? [] : r.failed);
    expect(outcome(check)).toEqual(failed);
    expect(outcome(write)).toEqual(failed);
  });

  it("change mode without a version (P11): STALE is not compared, the rest is", async () => {
    const p = await person();
    await frames(0, ["15:30"]);
    const b = await book(p.id, "15:30");
    expect(await checkBooking(input(p.id, { startTime: "15:30" }), patientActor(), {}, { bookingId: b.bookingId })).toMatchObject({ ok: true });
  });
});
