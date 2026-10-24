// Template text of a notification (03 §3.26, F6-03): the clinic's row for event × channel × language, missing
// language → ja. NT-05 / NT-06 belong to no clinic: always the 04 §6 default text (Q-009 answer).
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
  // NT-05 / NT-06 are corporate account mails: always the 04 §6 default, A04 edits never apply (Q-009 answer)
  const corporate = n.event === "NT05_PW_RESET" || n.event === "NT06_VERIFY";
  const clinicId = corporate || !n.bookingId
    ? undefined
    : (await prisma.booking.findUniqueOrThrow({ where: { id: n.bookingId }, select: { clinicId: true } })).clinicId;

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
