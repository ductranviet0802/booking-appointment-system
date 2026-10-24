// B2 枠生成: the pure planning (open bands, shift bands, frames), then the job on a clinic and doctors the test creates itself
// (never the seeded clinics): closures, holidays, 臨時診療, pattern validity, EXTRA / OFF, 代診, shifts that close a frame under a
// booking (要調整, never cancelled), reopening, idempotence, --dry-run, and the batch CLI.
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cutFrames, openBandsForDate, openBandsOn, planFrames, shiftBandsOn } from "@/lib/batch/b2-frames";
import { runJob } from "@/lib/batch/runner";
import { dbDate, toHhmm, toIsoDate } from "@/lib/datetime";
import { pool, prisma } from "@/lib/prisma";
import { fixture, MON, type Fixture } from "./b2-helpers";

process.env.NOTIFY_OUTBOX_DIR = mkdtempSync(path.join(tmpdir(), "b2-outbox-"));
jest.setTimeout(120_000);

const hours = [1, 2, 3, 4, 5].flatMap((weekday) => [
  { weekday, band: "AM" as const, open: "09:00", close: "12:00", reception: null },
  { weekday, band: "PM" as const, open: "15:00", close: "18:00", reception: null },
]);
const cal = (kind: "CLOSED" | "AM_CLOSED" | "PM_CLOSED" | "SPECIAL_OPEN", o: Partial<Record<"amOpen" | "amClose" | "pmOpen" | "pmClose", string>> = {}) =>
  ({ kind, amOpen: null, amClose: null, pmOpen: null, pmClose: null, ...o });

afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

describe("pure planning", () => {
  it("cuts a band into frames; the last frame ends no later than the band", () => {
    expect(cutFrames("09:00", "10:00", 15)).toEqual([["09:00", "09:15"], ["09:15", "09:30"], ["09:30", "09:45"], ["09:45", "10:00"]]);
    expect(cutFrames("09:00", "09:50", 20).at(-1)).toEqual(["09:20", "09:40"]);
    expect(cutFrames("09:00", "09:10", 15)).toEqual([]);
  });

  it("open bands: weekday hours, calendar kinds, a holiday closes unless 臨時診療", () => {
    const both = ["AM", "PM"];
    const bands = (date: string, c: ReturnType<typeof cal> | null, holiday = false) => openBandsOn(date, hours, c, holiday).map((b) => b.band);
    expect(bands(MON, null)).toEqual(both);
    expect(bands("2030-03-09", null)).toEqual([]); // Saturday: no row
    expect(bands(MON, cal("CLOSED"))).toEqual([]);
    expect(bands(MON, cal("AM_CLOSED"))).toEqual(["PM"]);
    expect(bands(MON, cal("PM_CLOSED"))).toEqual(["AM"]);
    expect(bands(MON, null, true)).toEqual([]);
    expect(bands(MON, cal("AM_CLOSED"), true)).toEqual([]);
    expect(openBandsOn("2030-03-09", hours, cal("SPECIAL_OPEN", { amOpen: "10:00", amClose: "11:00" }), false)).toEqual([{ band: "AM", open: "10:00", close: "11:00" }]);
    expect(openBandsOn(MON, hours, cal("SPECIAL_OPEN", { pmOpen: "15:00", pmClose: "16:00" }), true)).toEqual([{ band: "PM", open: "15:00", close: "16:00" }]);
  });

  it("shift bands: pattern ∩ open band, EXTRA added, OFF removed, SUBSTITUTE handed over", () => {
    const patterns = [{ doctorId: "a", departmentId: "d", weekday: 1, band: "AM" as const, start: "08:00", end: "11:00", validFrom: "2030-01-01", validTo: null }];
    const open = openBandsOn(MON, hours, null, false);
    const base = { date: MON, clinicId: "c", open, patterns, exceptions: [] };
    expect(shiftBandsOn(base).entries).toEqual([{ doctorId: "a", departmentId: "d", band: "AM", start: "09:00", end: "11:00" }]);
    const ex = (e: object) => ({ doctorId: "a", date: MON, kind: "OFF" as const, clinicId: null, departmentId: null, band: null, start: null, end: null, substituteDoctorId: null, ...e });
    expect(shiftBandsOn({ ...base, exceptions: [ex({ kind: "OFF", band: "PM" })] }).entries).toHaveLength(1);
    expect(shiftBandsOn({ ...base, exceptions: [ex({ kind: "OFF" })] }).entries).toHaveLength(0);
    const extra = ex({ kind: "EXTRA", doctorId: "b", clinicId: "c", departmentId: "d", band: "PM", start: "15:00", end: "16:00" });
    expect(shiftBandsOn({ ...base, exceptions: [extra] }).entries).toHaveLength(2);
    const sub = shiftBandsOn({ ...base, exceptions: [ex({ kind: "SUBSTITUTE", clinicId: "c", departmentId: "d2", band: "AM", substituteDoctorId: "z" })] });
    expect(sub.entries).toEqual([{ doctorId: "z", departmentId: "d2", band: "AM", start: "09:00", end: "11:00" }]);
    expect(sub.substitutions[0].from.doctorId).toBe("a");
  });

  it("plan: insert missing, close what left the shift (with the reason), reopen, and nothing when in sync", () => {
    const input = {
      clinicId: "c", dates: [MON], frameMinutes: 60, hours, calendar: new Map(), holidays: new Set<string>(),
      patterns: [{ doctorId: "a", departmentId: "d", weekday: 1, band: "AM" as const, start: "09:00", end: "11:00", validFrom: "2030-01-01", validTo: null }],
      exceptions: [], existing: [] as Parameters<typeof planFrames>[0]["existing"],
    };
    expect(planFrames(input).inserts.map((f) => f.start)).toEqual(["09:00", "10:00"]);
    const synced = [
      { id: "1", doctorId: "a", date: MON, start: "09:00", end: "10:00", status: "OPEN" as const, reserved: 0 },
      { id: "2", doctorId: "a", date: MON, start: "10:00", end: "11:00", status: "CLOSED" as const, reserved: 0 },
      { id: "3", doctorId: "a", date: MON, start: "11:00", end: "12:00", status: "OPEN" as const, reserved: 1 },
    ];
    const plan = planFrames({ ...input, existing: synced });
    expect(plan.inserts).toEqual([]);
    expect(plan.reopens).toEqual(["2"]);
    expect(plan.closes).toEqual([{ id: "3", reason: "DOCTOR_OFF", reserved: 1 }]);
    expect(planFrames({ ...input, holidays: new Set([MON]), existing: synced }).closes.map((c) => c.reason)).toEqual(["HOLIDAY", "HOLIDAY"]);
    expect(planFrames({ ...input, calendar: new Map([[MON, cal("CLOSED")]]), existing: synced }).closes.map((c) => c.reason)).toEqual(["CLINIC_CLOSED", "CLINIC_CLOSED"]);
  });
});

async function run(f: Fixture, params: Record<string, unknown> = { from: MON, to: "2030-03-10" }, dryRun = false) {
  return runJob("B2", { trigger: "MANUAL", clinicId: f.clinic.id, params, dryRun });
}
const dayOf = (s: { slotDate: Date }) => toIsoDate(s.slotDate);
const count = (frames: Array<{ slotDate: Date; status?: string }>, date: string, status = "OPEN") => frames.filter((s) => dayOf(s) === date && s.status === status).length;

describe("B2 job on a clinic of its own", () => {
  it("open weekday, closed day, half days, holiday, 臨時診療 on a holiday, last frame ≤ band end", async () => {
    const f = await fixture();
    try {
      await f.weekPatterns(f.doctors[0].id);
      await f.pattern(f.doctors[1].id, 2, "AM", { start: "09:00", end: "11:50" }); // Tuesday morning, 11:50 end
      await f.calendar("2030-03-05", "AM_CLOSED"); // Tue
      await f.calendar("2030-03-07", "CLOSED"); // Thu
      await f.holiday("2030-03-06"); // Wed
      await f.holiday("2030-03-08"); // Fri
      await f.calendar("2030-03-08", "SPECIAL_OPEN", { am: ["09:00", "11:00"] });
      const { run: r, result } = await run(f);
      expect(result.status).toBe("SUCCESS");
      const frames = await f.frames();
      expect(r?.writtenCount).toBe(frames.length);
      const d0 = (date: string, doctor = f.doctors[0].id) => frames.filter((s) => dayOf(s) === date && s.doctorId === doctor);
      expect(d0(MON)).toHaveLength(24); // 12 morning + 12 afternoon
      expect(d0("2030-03-05").map((s) => toHhmm(s.startTime))[0]).toBe("15:00"); // AM_CLOSED: afternoon only
      expect(d0("2030-03-05")).toHaveLength(12);
      expect(d0("2030-03-06")).toHaveLength(0); // holiday
      expect(d0("2030-03-07")).toHaveLength(0); // CLOSED
      expect(d0("2030-03-08")).toHaveLength(8); // 臨時診療 09:00–11:00 over the holiday
      expect(d0("2030-03-09")).toHaveLength(0); // Saturday
      // Tuesday morning of doctor 1 is inside the AM_CLOSED day → nothing; Monday check of the 11:50 end below
      expect(d0("2030-03-05", f.doctors[1].id)).toHaveLength(0);
      expect(frames.every((s) => s.capacity === 1 && s.status === "OPEN")).toBe(true);
      expect(frames.every((s) => toHhmm(s.endTime) <= "18:00")).toBe(true);
    } finally {
      await f.cleanup();
    }
  });

  it("the last frame ends at or before the band end (11:50 → 11:45)", async () => {
    const f = await fixture();
    try {
      await f.pattern(f.doctors[0].id, 1, "AM", { start: "09:00", end: "11:50" });
      await run(f);
      const frames = await f.frames();
      expect(frames).toHaveLength(11);
      expect(toHhmm(frames.at(-1)!.endTime)).toBe("11:45");
    } finally {
      await f.cleanup();
    }
  });

  it("pattern validity dates; EXTRA adds frames, OFF removes them", async () => {
    const f = await fixture();
    try {
      const [a, b] = f.doctors;
      await f.pattern(a.id, 1, "AM", { from: "2030-03-11" }); // starts after the run range
      await f.pattern(a.id, 2, "AM", { to: "2030-03-04" }); // ended before Tuesday
      await f.pattern(a.id, 3, "AM"); // Wednesday, valid
      await f.pattern(a.id, 4, "AM");
      await f.pattern(a.id, 4, "PM");
      await f.exception({ doctorId: a.id, date: "2030-03-07", kind: "OFF", band: "AM" }); // Thu morning off
      await f.exception({ doctorId: b.id, date: "2030-03-04", kind: "EXTRA", band: "PM", start: "16:00", end: "17:00" });
      await run(f);
      const frames = await f.frames();
      expect(count(frames, MON)).toBe(4); // only the EXTRA (doctor b 16:00–17:00)
      expect(frames.filter((s) => dayOf(s) === MON).every((s) => s.doctorId === b.id)).toBe(true);
      expect(count(frames, "2030-03-05")).toBe(0);
      expect(count(frames, "2030-03-06")).toBe(12);
      expect(count(frames, "2030-03-07")).toBe(12); // afternoon only
      expect(frames.filter((s) => dayOf(s) === "2030-03-07").every((s) => toHhmm(s.startTime) >= "15:00")).toBe(true);
    } finally {
      await f.cleanup();
    }
  });

  it("a second run writes nothing; --dry-run writes nothing and reports the counts of the real run", async () => {
    const f = await fixture();
    try {
      await f.weekPatterns(f.doctors[0].id);
      const dry = await run(f, undefined, true);
      expect(await f.frames()).toHaveLength(0);
      expect(dry.run).toBeNull();
      const first = await run(f);
      expect(dry.result.written).toBe(first.result.written);
      expect(dry.result.message).toBe(first.result.message);
      expect(first.result.written).toBeGreaterThan(0);
      const second = await run(f);
      expect(second.result.written).toBe(0);
      expect(second.result.message).toContain("追加0・閉鎖0・再開0");
      expect(await f.frames()).toHaveLength(first.result.written);
      expect(await prisma.batchRun.count({ where: { clinicId: f.clinic.id, jobCode: "B2" } })).toBe(2); // the dry run writes no batch_runs row
    } finally {
      await f.cleanup();
    }
  });

  it("a shift change closes frames: CLOSED + closed_reason; a booking on one is 要調整 (not cancelled); reopening", async () => {
    const f = await fixture();
    try {
      const a = f.doctors[0];
      await f.pattern(a.id, 1, "AM");
      await run(f);
      const frames = await f.frames();
      const booked = await f.book([frames[0].id], a.id, "AAAA0001");
      const free = frames[1];
      // the doctor is off on Monday morning
      const off = await f.exception({ doctorId: a.id, date: MON, kind: "OFF", band: "AM" });
      const dry = await run(f, undefined, true);
      expect(await prisma.slot.count({ where: { clinicId: f.clinic.id, status: "CLOSED" } })).toBe(0); // dry run closed nothing
      const closed = await run(f);
      expect(closed.result.status).toBe("SUCCESS");
      expect(dry.result.written).toBe(closed.result.written);
      const after = await f.frames();
      expect(after.every((s) => s.status === "CLOSED" && s.closedReason === "DOCTOR_OFF")).toBe(true);
      expect(after.find((s) => s.id === free.id)?.reservedCount).toBe(0);
      const b = await prisma.booking.findUniqueOrThrow({ where: { id: booked.id }, include: { events: true } });
      expect(b.status).toBe("RESERVED"); // never cancelled
      expect(b.adjustRequiredAt).not.toBeNull();
      expect(b.events.filter((e) => e.event === "ADJUST_REQUIRED")).toHaveLength(1);
      // a rerun marks nothing twice
      await run(f);
      expect(await prisma.bookingEvent.count({ where: { bookingId: booked.id, event: "ADJUST_REQUIRED" } })).toBe(1);
      // the OFF is deleted: the frames open again
      await prisma.doctorShiftException.delete({ where: { id: off.id } });
      const reopened = await run(f);
      expect(reopened.result.message).toContain("再開12");
      const again = await f.frames();
      expect(again.every((s) => s.status === "OPEN" && s.closedReason === null)).toBe(true);
    } finally {
      await f.cleanup();
    }
  });

  it("a calendar closure closes frames with CLINIC_CLOSED, a holiday with HOLIDAY, and reopens when the closure goes", async () => {
    const f = await fixture();
    try {
      await f.pattern(f.doctors[0].id, 1, "AM");
      await f.pattern(f.doctors[0].id, 2, "AM");
      await run(f);
      await f.calendar(MON, "CLOSED");
      await f.holiday("2030-03-05");
      await run(f);
      const frames = await f.frames();
      expect(frames.filter((s) => dayOf(s) === MON).every((s) => s.status === "CLOSED" && s.closedReason === "CLINIC_CLOSED")).toBe(true);
      expect(frames.filter((s) => dayOf(s) === "2030-03-05").every((s) => s.status === "CLOSED" && s.closedReason === "HOLIDAY")).toBe(true);
      await prisma.clinicCalendarDay.deleteMany({ where: { clinicId: f.clinic.id } });
      await prisma.holiday.updateMany({ where: { holidayDate: dbDate("2030-03-05") }, data: { isActive: false } }); // an inactive holiday no longer closes
      await run(f);
      expect((await f.frames()).every((s) => s.status === "OPEN")).toBe(true);
    } finally {
      await f.cleanup();
    }
  });

  it("SUBSTITUTE moves the booking to the substitute's frame (DOCTOR_SUBSTITUTED, NT-03); a full frame → 要調整 instead", async () => {
    const f = await fixture();
    try {
      const [a, b] = f.doctors;
      await f.pattern(a.id, 1, "AM");
      await run(f);
      const mine = await f.frames();
      const moved = await f.book([mine[0].id], a.id, "BBBB0001");
      const stays = await f.book([mine[1].id], a.id, "BBBB0002");
      await f.exception({ doctorId: a.id, date: MON, kind: "SUBSTITUTE", band: "AM", substituteDoctorId: b.id });
      // the substitute's frame at 09:15 does not exist yet: B2 inserts it; fill it first through a booking by inserting it ourselves
      await prisma.slot.create({
        data: {
          clinicId: f.clinic.id, departmentId: f.dept.id, doctorId: b.id, slotDate: dbDate(MON), startTime: mine[1].startTime, endTime: mine[1].endTime,
          capacity: 1, reservedCount: 1, status: "OPEN", generatedRunId: mine[1].generatedRunId,
        },
      });
      const r = await run(f);
      expect(r.result.status).toBe("SUCCESS");
      const m = await prisma.booking.findUniqueOrThrow({ where: { id: moved.id }, include: { events: true, bookingSlots: { include: { slot: true } } } });
      expect(m.doctorId).toBe(b.id);
      expect(m.adjustRequiredAt).toBeNull();
      expect(m.events.map((e) => e.event)).toContain("DOCTOR_SUBSTITUTED");
      expect(m.bookingSlots[0].slot.doctorId).toBe(b.id);
      expect(toHhmm(m.bookingSlots[0].slot.startTime)).toBe("09:00");
      expect(await prisma.notification.count({ where: { bookingId: moved.id, event: "NT03_CHANGED" } })).toBe(1);
      const s = await prisma.booking.findUniqueOrThrow({ where: { id: stays.id } });
      expect(s.doctorId).toBe(a.id); // the substitute's 09:15 frame was full
      expect(s.status).toBe("RESERVED");
      expect(s.adjustRequiredAt).not.toBeNull();
      const old = await prisma.slot.findUniqueOrThrow({ where: { id: mine[0].id } });
      expect(old).toMatchObject({ status: "CLOSED", reservedCount: 0 });
      // every substitute frame exists: 12 for the band
      expect(await prisma.slot.count({ where: { clinicId: f.clinic.id, doctorId: b.id, status: "OPEN" } })).toBe(12);
    } finally {
      await f.cleanup();
    }
  });

  it("openBandsForDate reads the clinic's rows (for the booking screens)", async () => {
    const f = await fixture();
    try {
      expect((await openBandsForDate(prisma, f.clinic.id, MON)).map((b) => b.band)).toEqual(["AM", "PM"]);
      await f.calendar(MON, "PM_CLOSED");
      expect((await openBandsForDate(prisma, f.clinic.id, MON)).map((b) => b.band)).toEqual(["AM"]);
      await f.holiday("2030-03-05");
      expect(await openBandsForDate(prisma, f.clinic.id, "2030-03-05")).toEqual([]);
    } finally {
      await f.cleanup();
    }
  });

  it("an explicit `dates` list and the default range clamp: nothing before today unless `from` says so", async () => {
    const f = await fixture();
    try {
      await f.weekPatterns(f.doctors[0].id, ["AM"]);
      await run(f, { from: MON, to: "2030-03-10", dates: [MON, "2030-03-06"] });
      const frames = await f.frames();
      expect([...new Set(frames.map(dayOf))]).toEqual([MON, "2030-03-06"]);
      // no params: today … today + window + 7 — the 2030 patterns are valid but the dates are not in the range
      const none = await runJob("B2", { trigger: "SCHEDULE", clinicId: f.clinic.id });
      expect(none.result.status).toBe("SUCCESS");
      expect(await prisma.slot.count({ where: { clinicId: f.clinic.id, slotDate: { lt: dbDate(MON) } } })).toBe(0);
      // a bad parameter fails the run
      expect((await run(f, { from: "2030-13-01" })).result.status).toBe("FAILED");
    } finally {
      await f.cleanup();
    }
  });
});

describe("batch CLI", () => {
  it("npm run batch -- B2 runs through runJob (dry run, one clinic)", () => {
    const out = execFileSync(process.execPath, ["bin/run-ts.mjs", "bin/batch.ts", "B2", "--clinic", "honin", "--dry-run", "--param", "from=2030-03-04", "--param", "to=2030-03-05"], {
      env: process.env, encoding: "utf8",
    });
    const json = JSON.parse(out.trim().split("\n").at(-1) as string);
    expect(json).toMatchObject({ job: "B2", dryRun: true, runId: null, status: "SUCCESS" });
  });
});
