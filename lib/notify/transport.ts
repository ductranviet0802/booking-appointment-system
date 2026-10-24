// X1 mail / X2 LINE · SMS transport (05 X1, X2). NOTIFY_TRANSPORT=fake (default) writes each message as one JSON
// line to NOTIFY_OUTBOX_DIR (default var/outbox) instead of calling a provider; providers are chosen at go-live (05).
import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { NotificationEvent, NotifyChannel } from "@prisma/client";

export type OutboundMessage = {
  /** notifications.id; for BATCH_ALERT the batch_runs.id (an operator mail has no notifications row: 03 §3.27 is the patient notice log) */
  notificationId: string;
  /** NT-xx of a patient notice, or BATCH_ALERT: the J-08 operator / admin mail of a FAILED / PARTIAL run (N-OPS-06) */
  event: NotificationEvent | "BATCH_ALERT";
  channel: NotifyChannel;
  to: string;
  subject: string | null;
  body: string;
};

export type SendResult =
  | { ok: true; providerMessageId: string }
  /** retry: 5xx / timeout / 429 (X1, X2); not retried: other 4xx, LINE 400 (blocked / not a friend), SMS carrier error */
  | { ok: false; retry: boolean; error: string };

export async function send(msg: OutboundMessage): Promise<SendResult> {
  const transport = process.env.NOTIFY_TRANSPORT ?? "fake";
  if (transport !== "fake") return { ok: false, retry: false, error: `transport ${transport} is not configured` };
  return fakeSend(msg);
}

// The fake provider answers by the address, so every X1 / X2 state can be produced locally:
// "fail500" / "fail429" / "timeout" → retryable error, "fail400" → permanent error, anything else → sent.
async function fakeSend(msg: OutboundMessage): Promise<SendResult> {
  if (/fail500|fail429|timeout/.test(msg.to)) return { ok: false, retry: true, error: `fake: ${msg.to.match(/fail500|fail429|timeout/)![0]}` };
  if (/fail400/.test(msg.to)) return { ok: false, retry: false, error: "fake: HTTP 400" };

  const providerMessageId = `fake-${randomUUID()}`;
  const dir = process.env.NOTIFY_OUTBOX_DIR ?? "var/outbox";
  await mkdir(dir, { recursive: true });
  const line = JSON.stringify({ at: new Date().toISOString(), providerMessageId, ...msg });
  await appendFile(path.join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`), `${line}\n`);
  return { ok: true, providerMessageId };
}
