// Server-side sessions (F9-05, 03 §3.18): the cookie holds 32 random bytes, the table only their SHA-256.
import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE = "sid";
export const LANG_COOKIE = "lang";
export const GUARD_COOKIE = "gid";
export const LANG_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** F9-05; staff idle 30 min per Q-008 (not the 60 of _common 抽出8) */
export const SESSION_LIFETIME = {
  PATIENT: { absoluteMs: 30 * DAY, idleMs: 7 * DAY },
  STAFF: { absoluteMs: 12 * HOUR, idleMs: 30 * MIN },
} as const;

export const lifetimeOf = (role: Role) => (role === "PATIENT" ? SESSION_LIFETIME.PATIENT : SESSION_LIFETIME.STAFF);

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** a random secret (cookie value or mail-link token) and the hash stored for it */
export function newSecret() {
  const value = randomBytes(32).toString("base64url");
  return { value, hash: sha256(value) };
}

type Db = PrismaClient | Prisma.TransactionClient;

export type NewSession = { token: string; expiresAt: Date; sessionId: string };

export async function createSession(
  db: Db,
  input: { accountId: string; role: Role; clinicId: string | null; ip: string | null; userAgent: string | null; now: Date },
): Promise<NewSession> {
  const secret = newSecret();
  const expiresAt = new Date(input.now.getTime() + lifetimeOf(input.role).absoluteMs);
  const row = await db.session.create({
    data: {
      tokenHash: secret.hash, accountId: input.accountId, expiresAt, lastSeenAt: input.now,
      clinicId: input.clinicId, ip: input.ip, userAgent: input.userAgent,
    },
  });
  return { token: secret.value, expiresAt, sessionId: row.id };
}

/** 更新3 of _common: revoke the session of a cookie value (no-op when unknown or already revoked) */
export async function revokeSessionToken(db: Db, token: string | undefined, now = new Date()) {
  if (!token) return;
  await db.session.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: now } });
}

export const sessionCookieOptions = (expiresAt: Date) => ({
  httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", expires: expiresAt,
});

/**
 * 抽出8: the session row of a cookie value when it is still valid (not revoked, absolute and idle time not passed,
 * account still able to log in); last_seen_at is moved to now (_common Q12). "invalid" = a cookie that no longer opens.
 */
export async function readSession(token: string | undefined, now = new Date()) {
  if (!token) return { state: "anonymous" as const };
  const row = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { account: true } });
  if (
    !row || row.revokedAt || row.expiresAt <= now
    || row.lastSeenAt.getTime() + lifetimeOf(row.account.role).idleMs <= now.getTime()
    || row.account.status === "DISABLED" || row.account.status === "WITHDRAWN" || row.account.status === "PENDING"
  ) {
    return { state: "invalid" as const };
  }
  await prisma.session.update({ where: { id: row.id }, data: { lastSeenAt: now } });
  return { state: "valid" as const, session: row };
}
