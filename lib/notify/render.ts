// Template text of a notification (03 §3.26, F6-03): the clinic's row for event × channel × language, missing
// language → ja. NT-05 / NT-06 belong to no clinic: they use the first active clinic by display_order (Q-009).
import type { Language, NotificationEvent, NotifyChannel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MAIL_DEFAULTS, SMS_DEFAULTS } from "@/lib/notify/templates-default";

export function fill(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

export async function renderNotification(
  n: { event: NotificationEvent; channel: NotifyChannel; language: Language; bookingId: string | null },
  vars: Record<string, string>,
): Promise<{ subject: string | null; body: string }> {
  const clinicId = n.bookingId
    ? (await prisma.booking.findUniqueOrThrow({ where: { id: n.bookingId }, select: { clinicId: true } })).clinicId
    : (await prisma.clinic.findFirst({ where: { isActive: true }, orderBy: { displayOrder: "asc" }, select: { id: true } }))?.id;

  const rows = clinicId
    ? await prisma.notificationTemplate.findMany({
        where: { clinicId, event: n.event, channel: n.channel, language: { in: [n.language, "JA"] } },
      })
    : [];
  const row = rows.find((r) => r.language === n.language) ?? rows.find((r) => r.language === "JA");
  if (row) return { subject: row.subject ? fill(row.subject, vars) : null, body: fill(row.body, vars) };

  // no template rows (e.g. an empty database in tests): the 04 §6 defaults
  const mail = MAIL_DEFAULTS[n.event];
  const body = n.channel === "SMS" ? SMS_DEFAULTS[n.event]?.[n.language] : mail.body[n.language];
  if (!body) throw new Error(`no ${n.channel} text for ${n.event}`);
  return { subject: n.channel === "MAIL" ? fill(mail.subject[n.language], vars) : null, body: fill(body, vars) };
}
