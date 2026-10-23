// Notification outbox entry point (03 §3.27). Screens and jobs call queueNotification; the X1 / X2 adapters
// (lib/notify, S10-D1 step 3) render the template and send. Until then the row is only queued.
import type { Language, NotificationEvent, NotifyChannel } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type NotificationInput = {
  event: NotificationEvent;
  channel: NotifyChannel;
  language: Language;
  toAddress: string;
  accountId?: string;
  patientId?: string;
  bookingId?: string;
  clinicId?: string;
  /** placeholder values of 04 §6.1 that cannot be rebuilt later, e.g. {{reset_url}} with the token */
  vars?: Record<string, string>;
};

export async function queueNotification(input: NotificationInput) {
  const row = await prisma.notification.create({
    data: {
      event: input.event, channel: input.channel, language: input.language, toAddress: input.toAddress,
      accountId: input.accountId, patientId: input.patientId, bookingId: input.bookingId,
      status: "QUEUED", queuedAt: new Date(),
    },
  });
  return { id: row.id, status: row.status };
}
