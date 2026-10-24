// B1 前日リマインド (06 §B1, F6-04): NT-02 for RESERVED bookings of tomorrow created before the run and not within 24 h of
// the visit. One reminder per booking: a booking that already has an NT-02 row is skipped, and the partial unique index
// `notifications_remind_once` (booking × channel, event NT02) stops two runners inserting at once — the loser's unique
// violation is caught and counted as already sent. The booking row is read FOR SHARE in the insert's transaction, so a
// cancel committing meanwhile is seen (no reminder) or waits for the insert. Sending and the X1 / X2 retries (1, 5, 30 min,
// 4xx no retry, LINE refused → MAIL) are lib/notify/queue's; B1 adds no retry of its own.
import { Prisma } from "@prisma/client";
import { bookingVars, recipientOf } from "@/lib/booking/notify";
import { addDays, dbDate, jstInstant, todayJst, toHhmm, toIsoDate } from "@/lib/datetime";
import { log } from "@/lib/logger";
import { deliver, holdVars } from "@/lib/notify/queue";
import { prisma } from "@/lib/prisma";
import { lockKeyOf, SKIPPED, withLock } from "@/lib/batch/lock";
import type { Job, JobResult } from "@/lib/batch/runner";

// Q-033: a clinic's targets are read in chunks (memory bounded by the chunk) and every chunk is sent in the same run, so
// nobody is left unreminded; the total is bounded by the day's frames. A run stopped by an error is re-run by hand
// (idempotent: only the unsent are sent).
export const B1_CHUNK = 2_000;
const DAY_MS = 24 * 3_600_000;

export type B1Counts = { read: number; queued: number; noRecipient: number; within24h: number; already: number; skipped: number; failed: number };
const zero = (): B1Counts => ({ read: 0, queued: 0, noRecipient: 0, within24h: 0, already: 0, skipped: 0, failed: 0 });

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

type Target = { id: string; patientId: string; slotDate: Date; startTime: Date; createdAt: Date };

/** the reminders of one clinic for `date` (tomorrow); `runStart` bounds created_at (06 B1 Input); `chunk` = rows per read */
export async function remindClinic(clinicId: string, date: string, runStart: Date, dryRun: boolean, chunk = B1_CHUNK): Promise<B1Counts> {
  const c = zero();
  let after: string | undefined;
  for (;;) {
    // keyset by id: a row cancelled between two chunks cannot shift the next chunk
    const rows: Target[] = await prisma.booking.findMany({
      where: { clinicId, slotDate: dbDate(date), status: "RESERVED", createdAt: { lt: runStart }, ...(after && { id: { gt: after } }) },
      select: { id: true, patientId: true, slotDate: true, startTime: true, createdAt: true },
      orderBy: { id: "asc" },
      take: chunk,
    });
    c.read += rows.length;
    for (const b of rows) await remindOne(b, c, runStart, dryRun);
    if (rows.length < chunk) return c;
    after = rows[rows.length - 1].id;
  }
}

async function remindOne(b: Target, c: B1Counts, runStart: Date, dryRun: boolean) {
  if (jstInstant(toIsoDate(b.slotDate), toHhmm(b.startTime)).getTime() - b.createdAt.getTime() < DAY_MS) {
    c.within24h++;
    return;
  }
  if (await prisma.notification.count({ where: { bookingId: b.id, event: "NT02_REMIND" } })) {
    c.already++;
    return;
  }
  const r = await recipientOf(b.patientId);
  if (!r) {
    c.noRecipient++;
    return;
  }
  if (dryRun) {
    c.queued++;
    return;
  }
  let id: string | null;
  try {
    id = await prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ status: string }[]>`SELECT status::text FROM bookings WHERE id = ${b.id}::uuid FOR SHARE`;
      if (row?.status !== "RESERVED") return null;
      const n = await tx.notification.create({
        data: {
          event: "NT02_REMIND", channel: r.channel, language: r.language, toAddress: r.to, accountId: r.accountId, patientId: b.patientId,
          bookingId: b.id, status: "QUEUED", queuedAt: new Date(), nextAttemptAt: new Date(),
        },
      });
      holdVars(n.id, await bookingVars(b.id, r.language, tx));
      return n.id;
    });
  } catch (e) {
    if (!isUnique(e)) throw e;
    c.already++; // another runner inserted it first
    return;
  }
  if (!id) {
    c.skipped++; // cancelled / checked in since the read
    return;
  }
  c.queued++;
  try {
    const sent = await deliver(id, runStart); // the run's clock: quiet hours and retry times (tests move it)
    // Q-042 (answered): a failure only when the notice reached no channel — a LINE refusal delivered (or still being
    // delivered) by the MAIL fallback is not one
    if (sent.status === "FAILED" && !(await prisma.notification.count({ where: { bookingId: b.id, event: "NT02_REMIND", status: { in: ["SENT", "QUEUED", "SENDING"] } } }))) {
      c.failed++;
    }
  } catch (e) {
    c.failed++;
    log("error", "B1 render / send failed", { notificationId: id, error: e instanceof Error ? e.message : String(e) });
    await prisma.notification.update({ where: { id }, data: { status: "FAILED", nextAttemptAt: null, lastError: String(e instanceof Error ? e.message : e).slice(0, 500) } });
  }
}

/** params: `date` (ISO; default tomorrow JST). Clinic = ctx.clinicId (the scheduler's per-clinic run) or every active clinic. */
export const b1Job: Job = async (ctx) => {
  const runStart = new Date();
  const date = ctx.params.date === undefined ? addDays(todayJst(runStart), 1) : String(ctx.params.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || toIsoDate(dbDate(date)) !== date || date <= todayJst(runStart)) throw new Error(`bad parameter date: ${date} (a future day)`);
  const clinics = await prisma.clinic.findMany({ where: ctx.clinicId ? { id: ctx.clinicId } : { isActive: true }, orderBy: { displayOrder: "asc" }, select: { id: true, code: true } });
  const total = zero();
  const failedClinics: string[] = [];
  const busy: string[] = [];
  for (const cl of clinics) {
    try {
      const work = () => remindClinic(cl.id, date, runStart, ctx.dryRun);
      // a per-clinic run holds its clinic's lock in the runner; an all-clinic run takes each clinic's lock here
      const c = ctx.clinicId || ctx.dryRun ? await work() : await withLock(lockKeyOf("B1", cl.id), work);
      if (!c) {
        busy.push(cl.code);
        continue;
      }
      for (const k of Object.keys(total) as Array<keyof B1Counts>) total[k] += c[k];
    } catch (e) {
      failedClinics.push(`${cl.code}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const message = [
    `${date} 送信${ctx.dryRun ? "予定" : ""}${total.queued}`, `通知先なし${total.noRecipient}`, `24時間以内${total.within24h}`, `送信済${total.already}`,
    `取消等${total.skipped}`, `失敗${total.failed}`, ...(busy.length ? [`${SKIPPED} ${busy.join(", ")}`] : []),
    ...(failedClinics.length ? [`エラー ${failedClinics.join("; ")}`] : []),
  ].join("・").slice(0, 500);
  // 06 B1 Failure: PARTIAL when a notification is FAILED at the end of the run; a clinic that could not run at all → FAILED / PARTIAL
  const status: JobResult["status"] = failedClinics.length === clinics.length && clinics.length > 0 ? "FAILED"
    : failedClinics.length || total.failed ? "PARTIAL" : "SUCCESS";
  return { status, read: total.read, written: total.queued, errors: total.failed + failedClinics.length, message };
};
