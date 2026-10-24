// J-06: the B2 dry run counts 要調整 and 代診 as a real run would (steps 4–7 in a rolled-back transaction) and writes nothing:
// no frame, no booking change, no booking_events, no batch_runs row, no NT-03.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runJob } from "@/lib/batch/runner";
import { pool, prisma } from "@/lib/prisma";
import { fixture, MON } from "./b2-helpers";

process.env.NOTIFY_OUTBOX_DIR = mkdtempSync(path.join(tmpdir(), "b2dry-outbox-"));
jest.setTimeout(60_000);

afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

it("dry run after an OFF and a SUBSTITUTE: 要調整 1, 代診 1, same counts as the real run, nothing written", async () => {
  const f = await fixture();
  try {
    const [a, b] = f.doctors;
    await f.pattern(a.id, 1, "AM");
    await f.pattern(a.id, 2, "AM");
    const params = { from: MON, to: "2030-03-05" };
    await runJob("B2", { trigger: "MANUAL", clinicId: f.clinic.id, params });
    const frames = await f.frames();
    const mon = frames.find((s) => s.slotDate.toISOString().startsWith(MON))!;
    const tue = frames.find((s) => s.slotDate.toISOString().startsWith("2030-03-05"))!;
    const moved = await f.book([mon.id], a.id, "DRYA0001");
    const adjusted = await f.book([tue.id], a.id, "DRYA0002");
    await f.exception({ doctorId: a.id, date: MON, kind: "SUBSTITUTE", band: "AM", substituteDoctorId: b.id });
    await f.exception({ doctorId: a.id, date: "2030-03-05", kind: "OFF", band: null });

    const snapshot = async () => ({
      slots: await prisma.slot.count({ where: { clinicId: f.clinic.id } }),
      open: await prisma.slot.count({ where: { clinicId: f.clinic.id, status: "OPEN" } }),
      runs: await prisma.batchRun.count({ where: { clinicId: f.clinic.id } }),
      events: await prisma.bookingEvent.count({ where: { bookingId: { in: [moved.id, adjusted.id] } } }),
      notices: await prisma.notification.count({ where: { bookingId: { in: [moved.id, adjusted.id] } } }),
      bookings: await prisma.booking.findMany({ where: { id: { in: [moved.id, adjusted.id] } }, select: { doctorId: true, adjustRequiredAt: true, version: true }, orderBy: { bookingNo: "asc" } }),
    });
    const before = await snapshot();
    const dry = await runJob("B2", { trigger: "MANUAL", clinicId: f.clinic.id, params, dryRun: true });
    expect(dry.run).toBeNull();
    expect(dry.result.message).toMatch(/要調整1・代診1/);
    expect(await snapshot()).toEqual(before);

    const real = await runJob("B2", { trigger: "MANUAL", clinicId: f.clinic.id, params });
    expect(real.result.message).toBe(dry.result.message);
    expect(real.result.written).toBe(dry.result.written);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: adjusted.id } })).adjustRequiredAt).not.toBeNull();
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: moved.id } })).doctorId).toBe(b.id);
  } finally {
    await f.cleanup();
  }
});
