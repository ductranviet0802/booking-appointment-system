// Booking notifications NT-01 … NT-04, NT-07 (F6-01, 04 §6): recipient (Q9 standing answer), placeholders (04 §6.1)
// and the outbox row written inside the booking transaction, delivered after the commit (X1 / X2 via lib/notify/queue).
import type { Language, NotificationEvent, NotifyChannel, Prisma } from "@prisma/client";
import { APP_CONFIG } from "@/lib/config";
import { toHhmm, toIsoDate } from "@/lib/datetime";
import type { Lang } from "@/lib/i18n";
import { formatDate, formatDateTime, formatTimeRange } from "@/lib/i18n/format";
import { label } from "@/lib/i18n/labels";
import { log } from "@/lib/logger";
import { deliver, holdVars } from "@/lib/notify/queue";
import { prisma } from "@/lib/prisma";
import { formatPhone } from "@/lib/public/phone";
import { doctorName, nameOf, pick } from "@/lib/public/text";
import { deadlineOf, policyOf } from "./policy";

type Db = Prisma.TransactionClient | typeof prisma;
export type Recipient = { channel: NotifyChannel; to: string; language: Language; accountId: string | null };

const e164 = (phone: string) => `+81${phone.replace(/^0/, "")}`;

/**
 * Q9: the account holder of the visiting person (a family member has no account): `accounts.notify_channel`, SMS to
 * the holder's SELF phone, LINE only while linked and followed; a channel that cannot be used falls back to MAIL (X2).
 * A patient without an account (registered by staff): SMS when `sms_opt_in` and a phone, else none (S02 SW021).
 */
export async function recipientOf(patientId: string, db: Db = prisma): Promise<Recipient | null> {
  const p = await db.patient.findUniqueOrThrow({ where: { id: patientId }, include: { account: true } });
  const a = p.account;
  if (!a) return p.smsOptIn && p.phone ? { channel: "SMS", to: e164(p.phone), language: "JA", accountId: null } : null;
  const base = { language: a.language, accountId: a.id };
  if (a.notifyChannel === "LINE" && a.lineUserId && a.lineFriend === "FOLLOWING") return { ...base, channel: "LINE", to: a.lineUserId };
  if (a.notifyChannel === "SMS") {
    const self = p.relation === "SELF" ? p : await db.patient.findFirst({ where: { accountId: a.id, relation: "SELF" } });
    if (self?.phone) return { ...base, channel: "SMS", to: e164(self.phone) };
  }
  return { ...base, channel: "MAIL", to: a.email };
}

/** 04 §6.1 placeholder values of a booking in the recipient's language */
export async function bookingVars(bookingId: string, language: Language, db: Db = prisma): Promise<Record<string, string>> {
  const b = await db.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { patient: true, clinic: true, department: true, visitType: true, doctor: true },
  });
  const lang = language.toLowerCase() as Lang;
  const date = toIsoDate(b.slotDate);
  const start = toHhmm(b.startTime);
  const policy = await policyOf(b.clinicId, db);
  const p = b.patient;
  const v = b.visitType;
  return {
    // ja 姓 名; en / vi given family for romaji names (04 §6.1); never with 様
    patient_name: lang !== "ja" && p.nameType === "ROMAJI" ? `${p.givenName} ${p.familyName}` : `${p.familyName} ${p.givenName}`,
    clinic_name: nameOf(b.clinic, lang),
    clinic_phone: formatPhone(b.clinic.phone),
    booking_no: `${b.bookingNo.slice(0, 4)}-${b.bookingNo.slice(4)}`,
    visit_date: formatDate(date, lang),
    visit_time: formatTimeRange(start, toHhmm(b.endTime), lang),
    department: nameOf(b.department, lang),
    visit_type: nameOf(v, lang),
    doctor_name: b.doctorRequested ? doctorName(b.doctor, lang) : label("noPreference", lang),
    notice: v.noticeJa ? pick(lang, v.noticeJa, v.noticeEn, v.noticeVi) : "",
    deadline: formatDateTime(deadlineOf(policy, date, start), lang),
    booking_url: `${APP_CONFIG.baseUrl}/bookings/${b.id}`,
  };
}

/** write the outbox row (QUEUED) in the caller's transaction; returns its id for deliverAfterCommit, null without recipient */
export async function enqueueBookingNotice(tx: Db, bookingId: string, event: NotificationEvent): Promise<string | null> {
  const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { patientId: true } });
  const r = await recipientOf(b.patientId, tx);
  if (!r) return null;
  const row = await tx.notification.create({
    data: {
      event, channel: r.channel, language: r.language, toAddress: r.to, accountId: r.accountId, patientId: b.patientId,
      bookingId, status: "QUEUED", queuedAt: new Date(), nextAttemptAt: new Date(),
    },
  });
  holdVars(row.id, await bookingVars(bookingId, r.language, tx));
  return row.id;
}

/** first send attempt after the commit; a failure is logged, the worker (deliverDue) retries per X1 / X2 */
export async function deliverAfterCommit(ids: Array<string | null>) {
  for (const id of ids) {
    if (!id) continue;
    try {
      await deliver(id);
    } catch (e) {
      log("error", "booking notification delivery failed", { notificationId: id, error: e instanceof Error ? e.message : String(e) });
    }
  }
}
