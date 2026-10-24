// Server side of P06 (events 7, 9, 11, 12, 13, 14 and the LINE link of event 5). The SELF patient is the one of the
// session's account (reading 3); nothing names a patient in the request.
import bcrypt from "bcrypt";
import type { NotifyChannel, Prisma } from "@prisma/client";
import { audit, hashPassword, revokeAccountSessions, type Result } from "@/lib/auth/service";
import { countPwChangeFailure, pwChangeBlocked } from "@/lib/auth/rate-limit";
import { newSecret, sha256 } from "@/lib/auth/session";
import { blank, checkEmail, checkNewPassword, checkPerson, normEmail, personBody, str, type FieldError } from "@/lib/auth/validate";
import { APP_CONFIG } from "@/lib/config";
import { dbDate, todayJst } from "@/lib/datetime";
import { queueNotification } from "@/lib/notify/queue";
import { prisma } from "@/lib/prisma";
import { formatPhone } from "@/lib/public/phone";
import { activeClinics, CardTaken, cardField, cardRows, checkCards, writeCards } from "./cards";
import { fail, tampered, type Actor } from "./route";

export const EMAIL_CHANGE_MS = 24 * 60 * 60_000; // F9-08

const fieldFail = (errors: FieldError[]): Result => ({ ok: false, status: 400, code: errors[0].code, params: errors[0].params, errors });
const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";

/** bookings whose start time has not passed (JST): status RESERVED and (date after today, or today and start later) */
export function futureReserved(now: Date): Prisma.BookingWhereInput {
  const jst = new Date(now.getTime() + 9 * 3600_000).toISOString();
  const today = dbDate(todayJst(now));
  return { status: "RESERVED", OR: [{ slotDate: { gt: today } }, { slotDate: today, startTime: { gt: new Date(`1970-01-01T${jst.slice(11, 19)}Z`) } }] };
}

/** lock the account row: serialises the writes of one account (P06 save / withdrawal, P07 add / delete) */
export const lockAccount = (tx: Prisma.TransactionClient, accountId: string) =>
  tx.$queryRaw`SELECT 1 FROM accounts WHERE id = ${accountId}::uuid FOR UPDATE`;

// ── event 1 初期表示 (抽出1–3) ─────────────────────────────────────────────────────────────────────────────────────

export async function loadMypage(accountId: string, lang: "ja" | "en" | "vi") {
  const acc = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  const self = await prisma.patient.findFirstOrThrow({ where: { accountId, relation: "SELF" } });
  const p = personBody(self);
  const cards = await cardRows(self.id);
  return {
    values: { ...p, ...splitBirth(p.birthDate), phone: self.phone ? formatPhone(self.phone) : "", postcode: formatPostcode(self.postcode) },
    email: acc.email, pendingEmail: acc.pendingEmail, notifyChannel: acc.notifyChannel ?? "MAIL", smsOptIn: acc.smsOptIn,
    lineLinked: !!acc.lineUserId, lineFriend: acc.lineFriend, bounced: !!acc.emailBouncedAt,
    cards: cards.map((c) => ({ clinicId: c.clinicId, name: c.names[lang] || c.names.ja, cardNo: c.cardNo, confirmed: c.confirmed })),
  };
}

/** "1000005" → "100-0005" (shown with the hyphen, P07 item 13; P06 item 9 3-4) */
export const formatPostcode = (digits: string) => (/^\d{7}$/.test(digits) ? `${digits.slice(0, 3)}-${digits.slice(3)}` : digits);
const splitBirth = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return { bY: y, bM: String(Number(m)), bD: String(Number(d)) };
};

// ── event 7 保存する ─────────────────────────────────────────────────────────────────────────────────────────────

export async function saveMypage(a: Actor, body: Record<string, unknown>): Promise<Result> {
  const person = checkPerson(body, a.now);
  const channel = body.notifyChannel;
  const clinics = await activeClinics();
  const cards = checkCards(body.cards, clinics.map((c) => c.id));
  if (!person || !cards || (channel !== "MAIL" && channel !== "LINE" && channel !== "SMS") || typeof body.smsOptIn !== "boolean") {
    return tampered();
  }
  const account = await prisma.account.findUniqueOrThrow({ where: { id: a.accountId } });
  const errors = [...person.errors];
  const emailError = checkEmail(body.email);
  if (emailError) errors.push(emailError);
  if (channel === "LINE" && !account.lineUserId) errors.push({ field: "notifyChannel", code: "PE050" }); // 7-4
  if (channel === "SMS" && !body.smsOptIn) errors.push({ field: "notifyChannel", code: "PE051" });
  errors.push(...cards.errors);
  if (errors.length) return fieldFail(errors); // 7-3 / 7-4: nothing written

  const email = normEmail(body.email);
  const changed = email !== account.email;
  const secret = newSecret();
  try {
    await prisma.$transaction(async (tx) => {
      await lockAccount(tx, a.accountId);
      if (changed) {
        // 抽出6 / 7-5: the whole save is refused
        const taken = await tx.account.count({ where: { email, status: { not: "WITHDRAWN" }, id: { not: a.accountId } } });
        if (taken) throw new EmailTaken();
      }
      const self = await tx.patient.findFirstOrThrow({ where: { accountId: a.accountId, relation: "SELF" }, select: { id: true } });
      await tx.patient.update({ where: { id: self.id }, data: { ...person.input, birthDate: dbDate(person.input.birthDate) } });
      await writeCards(tx, self.id, cards.rows);
      // 7-2 / 7-7 (更新17): the open EMAIL_CHANGE tokens are void whenever the pending address is set again or dropped
      if (changed || account.pendingEmail) {
        await tx.authToken.updateMany({ where: { accountId: a.accountId, purpose: "EMAIL_CHANGE", usedAt: null }, data: { usedAt: a.now } });
      }
      await tx.account.update({
        where: { id: a.accountId },
        data: {
          notifyChannel: channel as NotifyChannel, smsOptIn: body.smsOptIn as boolean, emailBouncedAt: null,
          pendingEmail: changed ? email : null,
        },
      });
      if (changed) {
        await tx.authToken.create({
          data: { tokenHash: secret.hash, accountId: a.accountId, purpose: "EMAIL_CHANGE", expiresAt: new Date(a.now.getTime() + EMAIL_CHANGE_MS) },
        });
      }
    });
  } catch (e) {
    if (e instanceof EmailTaken) return fieldFail([{ field: "email", code: "PE005" }]);
    if (e instanceof CardTaken) return fieldFail([{ field: cardField(e.clinicId), code: "PE053" }]);
    throw e;
  }
  if (changed) {
    // 更新5; shortcut: queued after the commit (queueNotification has no transaction parameter); a lost mail is fixed by saving again
    await queueNotification({
      event: "NT06_VERIFY", channel: "MAIL", language: account.language, toAddress: email, accountId: a.accountId,
      vars: { verify_url: `${APP_CONFIG.baseUrl}/api/mypage/email?token=${secret.value}`, valid_hours: "24" },
    });
  }
  return { ok: true, body: { code: "PI040", ...(changed && { pendingEmail: email }) } };
}

class EmailTaken extends Error {}

// ── event 12 パスワードを変更する ─────────────────────────────────────────────────────────────────────────────────

export async function changePassword(a: Actor, body: Record<string, unknown>): Promise<Result> {
  const errors: FieldError[] = [];
  if (blank(body.currentPassword)) errors.push({ field: "currentPassword", code: "PE001" });
  errors.push(...checkNewPassword(body.newPassword, body.newPasswordConfirm, "newPassword", "newPasswordConfirm"));
  if (errors.length) return fieldFail(errors); // 12-3: the current password is not verified
  if (pwChangeBlocked(a.accountId, a.now.getTime())) return fail(429, "PE092"); // 12-2: unverified until the window has passed
  const account = await prisma.account.findUniqueOrThrow({ where: { id: a.accountId }, select: { passwordHash: true, role: true } });
  if (!(await bcrypt.compare(str(body.currentPassword), account.passwordHash))) {
    countPwChangeFailure(a.accountId, a.now.getTime());
    return fieldFail([{ field: "currentPassword", code: "PE018" }]);
  }
  const passwordHash = await hashPassword(str(body.newPassword));
  await prisma.$transaction(async (tx) => {
    await tx.account.update({ where: { id: a.accountId }, data: { passwordHash } }); // 更新8
    await revokeAccountSessions(tx, a.accountId, a.now, a.sessionId); // 更新9: the current session stays
    await audit(tx, { accountId: a.accountId, role: account.role, action: "PASSWORD_CHANGE", ip: a.ip, now: a.now }); // 更新10
  });
  return { ok: true, body: { code: "PI049" } };
}

// ── events 9 / 11 退会 ──────────────────────────────────────────────────────────────────────────────────────────

/** 抽出4: a future RESERVED booking of the holder or a family member still under the account */
const blockedWithdrawal = (db: Prisma.TransactionClient | typeof prisma, accountId: string, now: Date) =>
  db.booking.count({ where: { ...futureReserved(now), patient: { accountId } } });

export async function withdraw(a: Actor, confirm: boolean): Promise<Result> {
  if (!confirm) return (await blockedWithdrawal(prisma, a.accountId, a.now)) ? fail(409, "PE042") : { ok: true, body: {} }; // event 9
  const done = await prisma.$transaction(async (tx) => {
    await lockAccount(tx, a.accountId);
    if (await blockedWithdrawal(tx, a.accountId, a.now)) return false; // 11-2
    await tx.account.update({ where: { id: a.accountId }, data: { status: "WITHDRAWN", withdrawnAt: a.now } }); // 更新11
    await revokeAccountSessions(tx, a.accountId, a.now); // 更新12: the current session too
    return true;
  });
  return done ? { ok: true, body: { destination: "/", code: "PI041" } } : fail(409, "PE042");
}

// ── event 14 確認リンク (EMAIL_CHANGE) ───────────────────────────────────────────────────────────────────────────

/**
 * 14-1 PI061 / 14-2 PE005 / 14-3 PE004, with the token's account (null when not found). Whatever the session (14-0).
 * Single use: only one opener claims the token (UPDATE … WHERE used_at IS NULL).
 */
export async function confirmEmailChange(token: unknown, now = new Date()): Promise<{ code: "PI061" | "PE005" | "PE004"; accountId: string | null }> {
  const hash = sha256(str(token));
  const run = (forceTaken: boolean) => prisma.$transaction(async (tx) => {
    const claimed = await tx.authToken.updateMany({
      where: { tokenHash: hash, purpose: "EMAIL_CHANGE", usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now },
    });
    if (claimed.count !== 1) return null;
    const { accountId } = await tx.authToken.findUniqueOrThrow({ where: { tokenHash: hash }, select: { accountId: true } });
    const acc = await tx.account.findUniqueOrThrow({ where: { id: accountId }, select: { pendingEmail: true } });
    if (!acc.pendingEmail) throw new NoPending(); // 抽出5 needs a pending address: PE004, the claim rolls back
    const taken = forceTaken || (await tx.account.count({ where: { email: acc.pendingEmail, status: { not: "WITHDRAWN" }, id: { not: accountId } } })) > 0;
    if (taken) {
      await tx.account.update({ where: { id: accountId }, data: { pendingEmail: null } }); // 更新14
      return { code: "PE005" as const, accountId };
    }
    await tx.account.update({
      where: { id: accountId },
      data: { email: acc.pendingEmail, pendingEmail: null, emailVerifiedAt: now, emailBouncedAt: null }, // 更新13
    });
    return { code: "PI061" as const, accountId };
  });
  try {
    return (await run(false)) ?? { code: "PE004", accountId: null };
  } catch (e) {
    if (e instanceof NoPending) return { code: "PE004", accountId: null };
    // accounts_email_active_key: the address was taken between the check and the write → 14-2
    if (isUnique(e)) return (await run(true)) ?? { code: "PE004", accountId: null };
    throw e;
  }
}
class NoPending extends Error {}

// ── events 5 / 13 LINE ──────────────────────────────────────────────────────────────────────────────────────────

/** 更新6: UNIQUE line_user_id (accounts_line_user_id_key) used by another account → PE052, nothing written */
export async function linkLine(accountId: string, lineUserId: string, friend: boolean): Promise<"PI043" | "PE052"> {
  const other = await prisma.account.count({ where: { lineUserId, id: { not: accountId } } });
  if (other) return "PE052";
  try {
    await prisma.account.update({ where: { id: accountId }, data: { lineUserId, ...(friend && { lineFriend: "FOLLOWING" }) } });
    return "PI043";
  } catch (e) {
    if (isUnique(e)) return "PE052";
    throw e;
  }
}

/** 更新7 */
export async function unlinkLine(accountId: string) {
  await prisma.account.update({ where: { id: accountId }, data: { lineUserId: null, lineFriend: null, notifyChannel: "MAIL" } });
}
