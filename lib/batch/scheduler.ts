// In-app scheduler: off unless BATCH_SCHEDULER=on (started by instrumentation.ts). Each minute it starts the jobs that
// are due (lib/batch/schedule.ts) and runs the notification worker (X1 / X2 retries).
import { prisma } from "@/lib/prisma";
import { toHhmm } from "@/lib/datetime";
import { deliverDue } from "@/lib/notify/queue";
import { runJob } from "@/lib/batch/runner";
import { dueJobs, jstParts } from "@/lib/batch/schedule";

export async function tick(now = new Date()) {
  const startOfDay = new Date(`${jstParts(now).date}T00:00:00+09:00`);
  const [runs, policies] = await Promise.all([
    prisma.batchRun.findMany({ where: { startedAt: { gte: startOfDay } }, select: { jobCode: true, trigger: true, status: true, clinicId: true } }),
    prisma.bookingPolicy.findMany({ where: { clinic: { isActive: true } }, select: { clinicId: true, reminderTime: true } }),
  ]);
  const due = dueJobs(now, {
    ranToday: new Set(runs.filter((r) => r.trigger === "SCHEDULE").map((r) => r.jobCode)),
    reminders: policies.map((p) => ({ clinicId: p.clinicId, at: toHhmm(p.reminderTime) })),
    remindedToday: new Set(runs.filter((r) => r.jobCode === "B1" && r.status === "SUCCESS" && r.clinicId).map((r) => r.clinicId!)),
  });
  for (const d of due) await runJob(d.code, { trigger: "SCHEDULE", clinicId: d.clinicId });
  await deliverDue(now);
  return due;
}

export function startScheduler() {
  const g = globalThis as unknown as { batchTimer?: NodeJS.Timeout };
  if (g.batchTimer) return;
  g.batchTimer = setInterval(() => {
    tick().catch((e) => console.error(JSON.stringify({ level: "error", msg: "scheduler tick failed", error: String(e) })));
  }, 60_000);
}
