// B4 夜間締め on the slot database: dry run writes nothing; the run flags RESERVED bookings of yesterday only, with one
// NO_SHOW_CANDIDATE event each; a re-run writes nothing (null flag is the guard); a check-in holding the booking lock while
// B4 runs wins (B4 re-checks under the lock); two B4 runs at once → one is skipped by the advisory lock; a given past date
// works, today / a future date is refused (FAILED).
import { runJob } from "@/lib/batch/runner";
import { lockBooking, lockPerson } from "@/lib/booking/core";
import { addDays, dbDate, dbTime, todayJst } from "@/lib/datetime";
import { pool, prisma } from "@/lib/prisma";
import { fixture, type Fixture } from "./b2-helpers";

jest.setTimeout(60_000);

let f: Fixture;
let seq = 0;
const today = todayJst();
const yesterday = addDays(today, -1);

beforeAll(async () => {
  f = await fixture({ doctors: 1 });
});
afterAll(async () => {
  await f.cleanup();
  await prisma.$disconnect();
  await pool.end();
});

const no = () => `BQ${"ABCDEFGHJK"[Math.floor(seq / 10) % 10]}${"ABCDEFGHJK"[seq % 10]}${String(++seq).padStart(4, "0")}`;
async function booking(date: string, status: "RESERVED" | "CHECKED_IN" | "CANCELED" = "RESERVED") {
  return prisma.booking.create({
    data: {
      bookingNo: no(), clinicId: f.clinic.id, departmentId: f.dept.id, visitTypeId: f.visitType.id, doctorId: f.doctors[0].id, doctorRequested: true,
      patientId: f.patient.id, channel: "WEB", slotDate: dbDate(date), startTime: dbTime("09:00"), endTime: dbTime("09:15"), status,
      ...(status === "CANCELED" && { canceledAt: new Date(), canceledByKind: "STAFF" as const, cancelReasonCode: "OTHER" as const, cancelReasonText: "x" }),
      ...(status === "CHECKED_IN" && { checkedInAt: new Date() }),
    },
  });
}
const flagged = (id: string) => prisma.booking.findUniqueOrThrow({ where: { id } }).then((b) => b.noShowCandidateAt);
const events = (id: string) => prisma.bookingEvent.count({ where: { bookingId: id, event: "NO_SHOW_CANDIDATE" } });
const run = (o: { dryRun?: boolean; params?: Record<string, unknown> } = {}) => runJob("B4", { trigger: "MANUAL", clinicId: f.clinic.id, ...o });

describe("B4", () => {
  let a: { id: string };
  let c: { id: string };
  let d: { id: string };
  let e: { id: string };

  it("dry run counts and writes nothing (no batch_runs row, no flag)", async () => {
    a = await booking(yesterday);
    c = await booking(yesterday, "CHECKED_IN");
    d = await booking(yesterday, "CANCELED");
    e = await booking(today);
    const runs = await prisma.batchRun.count({ where: { clinicId: f.clinic.id } });
    const r = await run({ dryRun: true });
    expect(r.run).toBeNull();
    expect(r.result).toMatchObject({ status: "SUCCESS", read: 1, written: 0 });
    expect(await flagged(a.id)).toBeNull();
    expect(await prisma.batchRun.count({ where: { clinicId: f.clinic.id } })).toBe(runs);
  });

  it("run flags RESERVED of yesterday only, status stays RESERVED, one event; re-run writes nothing", async () => {
    const r = await run();
    expect(r.result).toMatchObject({ status: "SUCCESS", read: 1, written: 1 });
    expect(r.run!.writtenCount).toBe(1);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.status).toBe("RESERVED");
    expect(row.noShowCandidateAt).not.toBeNull();
    expect(await events(a.id)).toBe(1);
    for (const x of [c, d, e]) expect(await flagged(x.id)).toBeNull();
    const again = await run();
    expect(again.result).toMatchObject({ status: "SUCCESS", read: 0, written: 0 });
    expect(await events(a.id)).toBe(1);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: a.id } })).noShowCandidateAt).toEqual(row.noShowCandidateAt);
  });

  it("a check-in that holds the person / booking locks while B4 runs wins; B4 does not flag it", async () => {
    const b = await booking(yesterday);
    let locked!: () => void;
    const holding = new Promise<void>((r) => { locked = r; });
    const checkin = prisma.$transaction(async (tx) => {
      await lockPerson(tx, f.patient.id);
      await lockBooking(tx, b.id);
      await tx.booking.update({ where: { id: b.id }, data: { status: "CHECKED_IN", checkedInAt: new Date() } });
      locked();
      await new Promise((r) => setTimeout(r, 500));
    });
    await holding;
    const [r] = await Promise.all([run(), checkin]);
    expect(r.result).toMatchObject({ status: "SUCCESS", read: 1, written: 0 });
    expect(await flagged(b.id)).toBeNull();
    expect(await events(b.id)).toBe(0);
  });

  it("two runs at once: one does the work, the other ends SUCCESS 「実行中のため省略」 and writes nothing", async () => {
    const b = await booking(yesterday);
    const [x, y] = await Promise.all([run(), run()]);
    const skipped = [x, y].filter((r) => r.result.message === "実行中のため省略");
    expect(skipped).toHaveLength(1);
    expect(x.result.written + y.result.written).toBe(1);
    expect(await events(b.id)).toBe(1);
  });

  it("a given past date (operator) is flagged; today or a future date → FAILED, nothing written", async () => {
    const old = await booking(addDays(today, -3));
    expect((await run({ params: { date: addDays(today, -3) } })).result).toMatchObject({ status: "SUCCESS", written: 1 });
    expect(await flagged(old.id)).not.toBeNull();
    const bad = await run({ params: { date: today } });
    expect(bad.result.status).toBe("FAILED");
    expect(bad.run!.status).toBe("FAILED");
    expect(await flagged(e.id)).toBeNull();
  });
});
