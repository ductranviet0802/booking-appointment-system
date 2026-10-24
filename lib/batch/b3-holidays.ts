// B3 祝日取込 (06 §B3, 05 X3): download and validate, apply to `holidays` from 1 Jan of the current year, then B2 (EVENT) for
// the changed dates inside the booking window, all clinics. A failed download / validation is retried once (after
// `retryDelayMs`, default 10 min), then the run is FAILED and `holidays` stays as it was; message = the SE041 {理由}.
import { fetchHolidayFile, parseHolidayCsv, x3FailureReason, type HolidayRow } from "@/lib/adapters/x3-holidays";
import { addDays, dbDate, todayJst, toIsoDate } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { b3Message } from "@/lib/batch/b3-message";
import type { Job } from "@/lib/batch/runner";

const RETRY_DELAY_MS = 10 * 60 * 1000;

/** step 2 of 06 B3 as a pure function over the stored rows and the file rows */
export function diffHolidays(stored: Array<{ date: string; nameJa: string; isActive: boolean }>, file: HolidayRow[]) {
  const have = new Map(stored.map((s) => [s.date, s]));
  const inFile = new Set(file.map((r) => r.date));
  const added = file.filter((r) => !have.has(r.date));
  const changed = file.filter((r) => {
    const s = have.get(r.date);
    return s && (s.nameJa !== r.nameJa || !s.isActive); // a returning date counts as changed
  });
  const removed = stored.filter((s) => s.isActive && !inFile.has(s.date));
  return { added, changed, removed };
}

export const b3Job: Job = async (ctx) => {
  const today = todayJst();
  const year = Number(today.slice(0, 4));
  // 05 X3: the URL is system_settings.holiday_source_url; --param source / env X3_SOURCE override it, and outside
  // production the local fixture stands in (fetchHolidayFile's default) so dev and tests never reach the network
  const setting = process.env.NODE_ENV === "production" && !process.env.X3_SOURCE
    ? (await prisma.systemSetting.findUnique({ where: { key: "holiday_source_url" } }))?.value || undefined
    : undefined;
  const source = typeof ctx.params.source === "string" ? ctx.params.source : setting;
  const delay = ctx.params.retryDelayMs === undefined ? RETRY_DELAY_MS : Number(ctx.params.retryDelayMs);
  const load = async () => parseHolidayCsv(await fetchHolidayFile(source), year);

  let file: HolidayRow[];
  try {
    try {
      file = await load();
    } catch {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      file = await load();
    }
  } catch (e) {
    return { status: "FAILED", read: 0, written: 0, errors: 1, message: x3FailureReason(e) };
  }

  const stored = (await prisma.holiday.findMany({ where: { holidayDate: { gte: dbDate(`${year}-01-01`) } } })).map((h) => ({
    date: toIsoDate(h.holidayDate), nameJa: h.nameJa, isActive: h.isActive,
  }));
  const { added, changed, removed } = diffHolidays(stored, file);
  const result = { status: "SUCCESS" as const, read: file.length, written: added.length + changed.length + removed.length, errors: 0, message: b3Message(added.length, changed.length, removed.length) };
  if (ctx.dryRun || result.written === 0) return result;

  const runId = ctx.runId as string;
  await prisma.$transaction(async (tx) => {
    await tx.holiday.createMany({
      data: added.map((r) => ({ holidayDate: dbDate(r.date), nameJa: r.nameJa, nameEn: r.nameEn, nameVi: r.nameVi, lastRunId: runId })),
    });
    for (const r of changed) {
      await tx.holiday.update({
        where: { holidayDate: dbDate(r.date) },
        data: { nameJa: r.nameJa, nameEn: r.nameEn, nameVi: r.nameVi, isActive: true, lastRunId: runId },
      });
    }
    if (removed.length > 0) {
      await tx.holiday.updateMany({ where: { holidayDate: { in: removed.map((s) => dbDate(s.date)) } }, data: { isActive: false, lastRunId: runId } });
    }
  });

  // step 4: B2 for the changed dates inside the booking window (all clinics); its own failure shows on A01 item 16 (Q9 e)
  const window = (await prisma.bookingPolicy.aggregate({ _max: { bookingWindowDays: true } }))._max.bookingWindowDays ?? 30;
  const last = addDays(today, window + 7);
  const dates = [...added.map((r) => r.date), ...changed.map((r) => r.date), ...removed.map((s) => s.date)].filter((d) => d >= today && d <= last);
  if (dates.length > 0) {
    // imported here, not at the top: runner → jobs → this file would otherwise be a cycle that leaves JOBS.B3 undefined
    const { runJob } = await import("@/lib/batch/runner");
    await runJob("B2", { trigger: "EVENT", clinicId: null, params: { dates } });
  }
  return result;
};
