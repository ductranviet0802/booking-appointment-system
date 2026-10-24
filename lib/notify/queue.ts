// Notification outbox (03 §3.27) with the X1 / X2 send rules of 05: first attempt at once, retries after 1, 5 and
// 30 min on 5xx / timeout / 429, then FAILED; other 4xx FAILED at once; LINE refused → FAILED and the same notice by
// MAIL (OD-6); LINE / SMS held during the quiet hours 21:00–08:00 JST. deliverDue() is the worker (scheduler, each minute).
import type { Language, Notification, NotificationEvent, NotifyChannel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { renderNotification } from "@/lib/notify/render";
import { send } from "@/lib/notify/transport";

export type NotificationInput = {
  event: NotificationEvent;
  channel: NotifyChannel;
  language: Language;
  toAddress: string;
  accountId?: string;
  patientId?: string;
  bookingId?: string;
  /** placeholder values of 04 §6.1, already formatted in the patient's language ({{reset_url}}, {{visit_date}} …) */
  vars?: Record<string, string>;
};

const RETRY_MINUTES = [1, 5, 30];
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// The rendered body may hold booking data and is not stored (03 §3.27), so the values wait in memory for the retries.
// shortcut: in-process store, lost on restart (such rows end FAILED "vars lost"); move to a shared store before scaling out.
const g = globalThis as unknown as { notifyVars?: Map<string, Record<string, string>> };
const pendingVars = (g.notifyVars ??= new Map());

/** keep the values of a row written by a caller's transaction (lib/booking/notify) until it is sent */
export const holdVars = (id: string, vars: Record<string, string>) => void pendingVars.set(id, vars);

export async function queueNotification(input: NotificationInput, now = new Date()) {
  const row = await prisma.notification.create({
    data: {
      event: input.event, channel: input.channel, language: input.language, toAddress: input.toAddress,
      accountId: input.accountId, patientId: input.patientId, bookingId: input.bookingId,
      status: "QUEUED", queuedAt: new Date(),
    },
  });
  pendingVars.set(row.id, input.vars ?? {});
  return deliver(row.id, now);
}

/** next 08:00 JST when `now` is inside the LINE / SMS quiet hours (X2), else null */
export function quietUntil(channel: NotifyChannel, now: Date): Date | null {
  if (channel === "MAIL") return null;
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const hour = jst.getUTCHours();
  if (hour >= 8 && hour < 21) return null;
  const day = jst.toISOString().slice(0, 10);
  const eight = new Date(`${day}T08:00:00+09:00`);
  return hour >= 21 ? new Date(eight.getTime() + 24 * 60 * 60 * 1000) : eight;
}

export async function deliver(id: string, now = new Date()): Promise<{ id: string; status: Notification["status"] }> {
  const n = await prisma.notification.findUniqueOrThrow({ where: { id } });
  const vars = pendingVars.get(id);
  if (!vars) return finish(n.id, { status: "FAILED", lastError: "vars lost" });
  // a reminder waiting for a retry is not sent once its booking left RESERVED (cancelled / changed state, B1)
  if (n.event === "NT02_REMIND" && n.bookingId) {
    const b = await prisma.booking.findUnique({ where: { id: n.bookingId }, select: { status: true } });
    if (b?.status !== "RESERVED") return finish(id, { status: "SKIPPED", lastError: "booking no longer RESERVED" });
  }

  const hold = quietUntil(n.channel, now);
  if (hold) {
    await prisma.notification.update({ where: { id }, data: { nextAttemptAt: hold } });
    return { id, status: "QUEUED" };
  }

  const text = await renderNotification(n, vars);
  const attempts = n.attempts + 1;
  await prisma.notification.update({ where: { id }, data: { status: "SENDING", attempts } });
  const result = await send({ notificationId: id, event: n.event, channel: n.channel, to: n.toAddress, ...text });

  if (result.ok) return finish(id, { status: "SENT", sentAt: new Date(), providerMessageId: result.providerMessageId });
  if (result.retry && attempts <= RETRY_MINUTES.length) {
    await prisma.notification.update({
      where: { id },
      data: { status: "QUEUED", lastError: result.error, nextAttemptAt: new Date(now.getTime() + RETRY_MINUTES[attempts - 1] * 60_000) },
    });
    return { id, status: "QUEUED" };
  }
  const failed = await finish(id, { status: "FAILED", lastError: result.error });
  if (n.channel === "LINE" && !result.retry && n.accountId) await fallBackToMail(n, vars);
  return failed;
}

/** the worker: every QUEUED row whose retry time has come */
export async function deliverDue(now = new Date()) {
  const due = await prisma.notification.findMany({
    where: { status: "QUEUED", nextAttemptAt: { lte: now } },
    select: { id: true },
    orderBy: { nextAttemptAt: "asc" },
  });
  for (const { id } of due) {
    try {
      await deliver(id, now);
    } catch (e) {
      // one row that cannot be rendered / sent must not block the other due rows every minute
      await finish(id, { status: "FAILED", lastError: (e instanceof Error ? e.message : String(e)).slice(0, 500) });
    }
  }
  return due.length;
}

/** X1 inbound webhook: a hard bounce → BOUNCED; the 3rd BOUNCED MAIL in a row on the current address sets email_bounced_at */
export async function recordMailBounce(providerMessageId: string, hard: boolean) {
  const n = await prisma.notification.findFirst({ where: { providerMessageId, channel: "MAIL" } });
  if (!n || !hard) return; // soft bounces are retried by the provider
  await prisma.notification.update({ where: { id: n.id }, data: { status: "BOUNCED" } });
  if (!n.accountId) return;
  const account = await prisma.account.findUniqueOrThrow({ where: { id: n.accountId } });
  const lastThree = await prisma.notification.findMany({
    where: { accountId: account.id, channel: "MAIL", toAddress: account.email, status: { in: ["SENT", "BOUNCED"] } },
    orderBy: { queuedAt: "desc" },
    take: 3,
    select: { status: true },
  });
  if (lastThree.length === 3 && lastThree.every((r) => r.status === "BOUNCED")) {
    await prisma.account.update({ where: { id: account.id }, data: { emailBouncedAt: new Date() } });
  }
}

async function finish(id: string, data: Partial<Notification>) {
  pendingVars.delete(id);
  const row = await prisma.notification.update({ where: { id }, data: { ...data, nextAttemptAt: null } });
  return { id, status: row.status };
}

async function fallBackToMail(n: Notification, vars: Record<string, string>) {
  const account = await prisma.account.findUnique({ where: { id: n.accountId! } });
  if (!account) return;
  await queueNotification({
    event: n.event, channel: "MAIL", language: n.language, toAddress: account.email,
    accountId: account.id, patientId: n.patientId ?? undefined, bookingId: n.bookingId ?? undefined, vars,
  });
}
