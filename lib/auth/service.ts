// Server side of P02–P05 and of the session events of _common (4, 8, 9, 11). Each function mirrors one event and
// returns either the 04 id of the answer or the data for the route handler (cookie, destination). No request objects
// here, so the tests drive it against the real database.
import bcrypt from "bcrypt";
import type { Language, Prisma, PrismaClient, Role } from "@prisma/client";
import {
  CONSENT_PATH, decideAccess, FIRST_CHANGE_PATH, internalPath, PATIENT_HOME, screenOfPath, STAFF_HOME,
} from "@/lib/auth/access";
import { resolveSession, type SessionContext } from "@/lib/auth/context";
import { takeGuard } from "@/lib/auth/guard-store";
import { overAuthLimit } from "@/lib/auth/rate-limit";
import { CONSENT_KINDS, currentConsentDocuments, initialClinicId, staffClinics } from "@/lib/auth/scope";
import { createSession, newSecret, revokeSessionToken, sha256, type NewSession } from "@/lib/auth/session";
import {
  blank, checkEmail, checkNewPassword, checkRegistration, normEmail, str, type FieldError,
} from "@/lib/auth/validate";
import { APP_CONFIG } from "@/lib/config";
import { queueNotification } from "@/lib/notify/queue";
import { prisma } from "@/lib/prisma";

type Db = PrismaClient | Prisma.TransactionClient;
export type Client = { ip: string | null; userAgent: string | null; now?: Date };

export type Fail = { ok: false; status: number; code: string; params?: Record<string, string | number>; errors?: FieldError[] };
export type Done = { ok: true; body: Record<string, unknown>; session?: NewSession; language?: Language };
export type Result = Fail | Done;

const fail = (status: number, code: string, params?: Fail["params"], errors?: FieldError[]): Fail =>
  ({ ok: false, status, code, ...(params && { params }), ...(errors && { errors }) });
const fieldFail = (errors: FieldError[]) => fail(400, errors[0].code, errors[0].params, errors);
const done = (body: Record<string, unknown>, extra: Omit<Done, "ok" | "body"> = {}): Done => ({ ok: true, body, ...extra });

export const LOCK_AFTER_FAILURES = 5;
export const LOCK_MS = 15 * 60_000;
export const VERIFY_TOKEN_MS = 24 * 60 * 60_000; // F9-06
export const RESET_TOKEN_MS = 30 * 60_000; // F9-02, Q-007
/** P04 §6 3-1 / Q4 = A: every answer of event 3 leaves after this time, so 3-1 and 3-2 cannot be told apart */
export const RESET_MIN_RESPONSE_MS = 400;

const audit = (db: Db, a: { accountId: string | null; role: Role | null; action: string; ip: string | null; now: Date }) =>
  db.auditLog.create({ data: { at: a.now, accountId: a.accountId, role: a.role, action: a.action, ip: a.ip } });

let dummyHash: Promise<string> | null = null;
/** an unknown e-mail still costs one bcrypt compare (no timing difference to a wrong password) */
const dummy = () => (dummyHash ??= bcrypt.hash("not-a-password-0", APP_CONFIG.auth.bcryptRounds));

const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === "P2002";
class Rollback extends Error {}
const rollbackAsNull = (e: unknown) => {
  if (e instanceof Rollback) return null;
  throw e;
};

const locked = (until: Date, now: Date) =>
  fail(423, "PE011", { n: Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000)) });

/**
 * Where a fresh login lands (P02 event 5 order: CF-04 → 初回変更 → return target → default). The guard record is taken
 * only when it is used, so a target survives CF-04.
 */
export function landing(ctx: SessionContext, guardId: string | undefined, now: Date) {
  if (ctx.account.role === "PATIENT" && ctx.reconsent.length > 0) return CONSENT_PATH;
  if (ctx.account.role !== "PATIENT" && ctx.account.mustChangePassword) return FIRST_CHANGE_PATH;
  const home = ctx.account.role === "PATIENT" ? PATIENT_HOME : STAFF_HOME;
  const target = internalPath(takeGuard(guardId, now.getTime())?.target);
  const screen = target ? screenOfPath(target) : null;
  return target && screen && decideAccess(screen, { state: "valid", ctx }, target).kind === "allow" ? target : home;
}

async function landingOf(token: string, guardId: string | undefined, now: Date) {
  const s = await resolveSession(token, now);
  if (s.state !== "valid") throw new Error("fresh session not readable");
  return landing(s.ctx, guardId, now);
}

// ── P02 event 4 / 5 ──────────────────────────────────────────────────────────────────────────────────────────────

export async function login(input: Client & { email: unknown; password: unknown; guardId?: string }): Promise<Result> {
  const now = input.now ?? new Date();
  const email = normEmail(input.email);
  if (overAuthLimit("login", email, input.ip, now.getTime())) return fail(429, "PE092");

  const errors: FieldError[] = [];
  const emailError = checkEmail(input.email);
  if (emailError) errors.push(emailError);
  if (blank(input.password)) errors.push({ field: "password", code: "PE001" });
  if (errors.length) return fieldFail(errors);
  const password = str(input.password);

  const account = await prisma.account.findFirst({ where: { email, status: { not: "WITHDRAWN" } } });
  if (!account) {
    await bcrypt.compare(password, await dummy());
    await audit(prisma, { accountId: null, role: null, action: "LOGIN_NG", ip: input.ip, now });
    return fail(401, "PE010");
  }
  const loginNg = () => audit(prisma, { accountId: account.id, role: account.role, action: "LOGIN_NG", ip: input.ip, now });

  // 4-2: during the lock nothing is verified, counted or extended
  if (account.lockedUntil && account.lockedUntil > now) {
    await loginNg();
    return locked(account.lockedUntil, now);
  }

  if (!(await bcrypt.compare(password, account.passwordHash))) {
    // 4-3 / 更新1, atomic so that concurrent failures are all counted; a row locked meanwhile is not touched
    const rows = await prisma.$queryRaw<Array<{ locked_until: Date | null }>>`
      UPDATE accounts SET failed_login_count = failed_login_count + 1,
        locked_until = CASE WHEN failed_login_count + 1 >= ${LOCK_AFTER_FAILURES}
                            THEN ${new Date(now.getTime() + LOCK_MS)} ELSE locked_until END,
        updated_at = ${now}
      WHERE id = ${account.id}::uuid AND (locked_until IS NULL OR locked_until <= ${now})
      RETURNING locked_until`;
    await loginNg();
    const until = rows[0] ? rows[0].locked_until : (await prisma.account.findUnique({ where: { id: account.id } }))?.lockedUntil;
    return until && until > now ? locked(until, now) : fail(401, "PE010");
  }

  if (account.status === "DISABLED") {
    await loginNg();
    return fail(401, "PE010");
  }
  if (account.status === "PENDING") {
    await loginNg();
    return fail(403, "PE017");
  }

  // 5-1
  const clinics = await staffClinics(account, now);
  const clinicId = await initialClinicId(account, clinics, now);
  const session = await prisma.$transaction(async (tx) => {
    // re-checked in the write: a lock set by a concurrent failure wins over this success
    const upd = await tx.account.updateMany({
      where: { id: account.id, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });
    if (upd.count === 0) return null;
    const s = await createSession(tx, { accountId: account.id, role: account.role, clinicId, ip: input.ip, userAgent: input.userAgent, now });
    await audit(tx, { accountId: account.id, role: account.role, action: "LOGIN_OK", ip: input.ip, now });
    return s;
  });
  if (!session) return locked(new Date(now.getTime() + LOCK_MS), now);

  const destination = await landingOf(session.token, input.guardId, now);
  return done(
    { destination, role: account.role },
    { session, language: account.role === "PATIENT" ? account.language : undefined },
  );
}

// ── _common events 4, 8, 11 (更新3) ─────────────────────────────────────────────────────────────────────────────

export async function logout(sessionToken: string | undefined, now = new Date()): Promise<Done> {
  const row = sessionToken
    ? await prisma.session.findUnique({ where: { tokenHash: sha256(sessionToken) }, select: { account: { select: { role: true } } } })
    : null;
  await revokeSessionToken(prisma, sessionToken, now);
  // T004 → P01 (patients), T089 → P02 (staff)
  return done({ destination: row && row.account.role !== "PATIENT" ? "/login" : "/" });
}

// ── _common event 9 (更新4) ─────────────────────────────────────────────────────────────────────────────────────

export async function switchClinic(sessionToken: string | undefined, clinicId: unknown, now = new Date()): Promise<Result> {
  const s = await resolveSession(sessionToken, now);
  if (s.state !== "valid") return fail(401, "PI013");
  const { account, clinics } = s.ctx;
  if (account.role === "PATIENT" || account.mustChangePassword || typeof clinicId !== "string" || !clinics.some((c) => c.id === clinicId)) {
    return fail(403, "SE091");
  }
  await prisma.session.update({ where: { id: s.ctx.sessionId }, data: { clinicId } });
  return done({ clinicId });
}

// ── P03 events 5, 6, 8 · P02 event 8 ───────────────────────────────────────────────────────────────────────────

const verifyUrl = (token: string) => `${APP_CONFIG.baseUrl}/api/auth/verify?token=${token}`;

/** P03 Q6 = A: the versions shown when the screen opened; unknown → null (a value the UI cannot produce) */
async function shownVersions(raw: unknown, language: Language, now: Date) {
  const current = await currentConsentDocuments(language, now);
  const given = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Array<{ kind: string; version: string }> = [];
  for (const kind of CONSENT_KINDS) {
    const version = given[kind] === undefined ? current.find((d) => d.kind === kind)?.version : given[kind];
    if (typeof version !== "string") return null;
    const doc = await prisma.consentDocument.findFirst({ where: { kind, version, language, effectiveFrom: { lte: now } } });
    if (!doc) return null;
    out.push({ kind, version });
  }
  return out;
}

export async function register(input: Client & { body: Record<string, unknown>; language: Language }): Promise<Result> {
  const now = input.now ?? new Date();
  const email = normEmail(input.body.email);
  if (overAuthLimit("register", email, input.ip, now.getTime())) return fail(429, "PE092");

  const checked = checkRegistration(input.body, now);
  if (checked.tampered) return fail(400, "PE090");
  const versions = await shownVersions(input.body.consentVersions, input.language, now);
  if (!versions) return fail(400, "PE090");
  if (checked.errors.length) return fieldFail(checked.errors);

  const v = checked.input;
  const passwordHash = await bcrypt.hash(v.password, APP_CONFIG.auth.bcryptRounds);
  const secret = newSecret();
  const person = {
    nameType: v.nameType, familyName: v.familyName, givenName: v.givenName, familyNameKana: v.familyNameKana,
    givenNameKana: v.givenNameKana, birthDate: new Date(`${v.birthDate}T00:00:00Z`), sex: v.sex, postcode: v.postcode,
    prefecture: v.prefecture, city: v.city, town: v.town, addressLine: v.addressLine, building: v.building, phone: v.phone,
  };
  const taken = fail(409, "PE005", undefined, [{ field: "email", code: "PE005" }]);

  let accountId: string | null;
  try {
    accountId = await prisma.$transaction(async (tx) => {
      const existing = await tx.account.findFirst({ where: { email, status: { not: "WITHDRAWN" } }, select: { id: true } });
      let id: string;
      if (existing) {
        // 5-2: overwrite a PENDING account (F9-06); the row lock serialises two overwrites of one address
        const [row] = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM accounts WHERE id = ${existing.id}::uuid FOR UPDATE`;
        if (row?.status !== "PENDING") return null;
        id = existing.id;
        await tx.account.update({ where: { id }, data: { passwordHash, language: input.language } });
        const self = await tx.patient.findFirst({ where: { accountId: id, relation: "SELF" }, select: { id: true } });
        if (self) await tx.patient.update({ where: { id: self.id }, data: person });
        else await tx.patient.create({ data: { ...person, accountId: id, relation: "SELF", createdByKind: "PATIENT" } });
        await tx.authToken.updateMany({ where: { accountId: id, purpose: "EMAIL_VERIFY", usedAt: null }, data: { usedAt: now } });
      } else {
        id = (await tx.account.create({
          data: { email, passwordHash, role: "PATIENT", status: "PENDING", language: input.language, notifyChannel: "MAIL" },
        })).id;
        await tx.patient.create({ data: { ...person, accountId: id, relation: "SELF", createdByKind: "PATIENT" } });
      }
      await tx.consent.createMany({ data: versions.map((c) => ({ accountId: id, ...c, agreedAt: now, ip: input.ip })) });
      await tx.authToken.create({
        data: { tokenHash: secret.hash, accountId: id, purpose: "EMAIL_VERIFY", expiresAt: new Date(now.getTime() + VERIFY_TOKEN_MS) },
      });
      return id;
    });
  } catch (e) {
    if (isUniqueViolation(e)) return taken; // two registrations of one address at once: the unique index passes one
    throw e;
  }
  if (!accountId) return taken;

  // shortcut: queued after the commit (queueNotification has no transaction parameter); a failed queue leaves a
  // PENDING account whose owner can use 再送
  await queueNotification({
    event: "NT06_VERIFY", channel: "MAIL", language: input.language, toAddress: email, accountId,
    vars: { verify_url: verifyUrl(secret.value), valid_hours: "24" },
  });
  return done({ code: "PI001", params: { email } });
}

/** P02 event 8 / P03 event 8: always PI001; a token and NT-06 only for a PENDING account */
export async function resendVerification(input: Client & { email: unknown; screen?: unknown }): Promise<Result> {
  const now = input.now ?? new Date();
  const email = normEmail(input.email);
  if (overAuthLimit("resend", email, input.ip, now.getTime())) return fail(429, "PE092");
  const emailError = checkEmail(input.email, "email", input.screen === "P03");
  if (emailError) return fieldFail([emailError]);

  const secret = newSecret();
  const target = await prisma.$transaction(async (tx) => {
    const acc = await tx.account.findFirst({ where: { email, status: "PENDING" }, select: { id: true, language: true } });
    if (!acc) return null;
    await tx.$queryRaw`SELECT 1 FROM accounts WHERE id = ${acc.id}::uuid FOR UPDATE`;
    await tx.authToken.updateMany({ where: { accountId: acc.id, purpose: "EMAIL_VERIFY", usedAt: null }, data: { usedAt: now } });
    await tx.authToken.create({
      data: { tokenHash: secret.hash, accountId: acc.id, purpose: "EMAIL_VERIFY", expiresAt: new Date(now.getTime() + VERIFY_TOKEN_MS) },
    });
    return acc;
  });
  if (target) {
    await queueNotification({
      event: "NT06_VERIFY", channel: "MAIL", language: target.language, toAddress: email, accountId: target.id,
      vars: { verify_url: verifyUrl(secret.value), valid_hours: "24" },
    });
  }
  return done({ code: "PI001", params: { email } });
}

/** P03 event 6 / 7: activate, log in (replacing any current session), LOGIN_OK; anything else → PE004, nothing written */
export async function verifyEmail(
  input: Client & { token: unknown; currentSessionToken?: string; guardId?: string },
): Promise<Result> {
  const now = input.now ?? new Date();
  const token = str(input.token);
  if (!token) return fail(400, "PE004");
  const hash = sha256(token);
  const result = await prisma.$transaction(async (tx) => {
    // single use: only one concurrent opener claims the token
    const claimed = await tx.authToken.updateMany({
      where: { tokenHash: hash, purpose: "EMAIL_VERIFY", usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now },
    });
    if (claimed.count !== 1) return null;
    const { accountId } = await tx.authToken.findUniqueOrThrow({ where: { tokenHash: hash }, select: { accountId: true } });
    const activated = await tx.account.updateMany({
      where: { id: accountId, status: "PENDING" }, data: { status: "ACTIVE", emailVerifiedAt: now, lastLoginAt: now },
    });
    if (activated.count !== 1) throw new Rollback(); // 6-2: not PENDING any more → PE004, the claim is rolled back
    const account = await tx.account.findUniqueOrThrow({ where: { id: accountId }, select: { id: true, role: true, language: true } });
    await revokeSessionToken(tx, input.currentSessionToken, now);
    const session = await createSession(tx, { accountId, role: account.role, clinicId: null, ip: input.ip, userAgent: input.userAgent, now });
    await audit(tx, { accountId, role: account.role, action: "LOGIN_OK", ip: input.ip, now });
    return { session, account };
  }).catch(rollbackAsNull);
  if (!result) return fail(400, "PE004");
  const destination = await landingOf(result.session.token, input.guardId, now);
  return done({ destination, code: "PI002" }, { session: result.session, language: result.account.language });
}

// ── P04 event 3 ────────────────────────────────────────────────────────────────────────────────────────────────

export async function requestPasswordReset(input: Client & { email: unknown }): Promise<Result> {
  const started = Date.now();
  try {
    const now = input.now ?? new Date();
    const emailError = checkEmail(input.email); // 3-5 before the rate limit (Q5 = A)
    if (emailError) return fieldFail([emailError]);
    const email = normEmail(input.email);
    if (overAuthLimit("reset", email, input.ip, now.getTime())) return fail(429, "PE092");
    const account = await prisma.account.findFirst({
      where: { email, role: "PATIENT", status: { in: ["ACTIVE", "LOCKED"] } }, select: { id: true, language: true },
    });
    if (account) {
      const secret = newSecret();
      await prisma.authToken.create({
        data: { tokenHash: secret.hash, accountId: account.id, purpose: "PASSWORD_RESET", expiresAt: new Date(now.getTime() + RESET_TOKEN_MS) },
      });
      await queueNotification({
        event: "NT05_PW_RESET", channel: "MAIL", language: account.language, toAddress: email, accountId: account.id,
        vars: { reset_url: `${APP_CONFIG.baseUrl}/password/reset?token=${secret.value}`, valid_minutes: "30" },
      });
    }
    return done({ code: "PI020" });
  } finally {
    const wait = RESET_MIN_RESPONSE_MS - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}

// ── P05 ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** P05 item 1 / Q2 = A: first 2 characters of the local part + *** + @domain (≤ 2 characters: the first one) */
export function maskEmail(email: string) {
  const at = email.lastIndexOf("@");
  const local = email.slice(0, at);
  return `${local.slice(0, local.length <= 2 ? 1 : 2)}***${email.slice(at)}`;
}

/** P05 event 1 (token mode): input state with the masked address, or PE021 */
export async function checkResetToken(token: unknown, now = new Date()): Promise<Result> {
  const t = str(token);
  const row = t
    ? await prisma.authToken.findUnique({ where: { tokenHash: sha256(t) }, include: { account: { select: { email: true, status: true } } } })
    : null;
  if (
    !row || row.purpose !== "PASSWORD_RESET" || row.usedAt || row.expiresAt <= now
    || (row.account.status !== "ACTIVE" && row.account.status !== "LOCKED")
  ) {
    return fail(400, "PE021");
  }
  return done({ maskedEmail: maskEmail(row.account.email) });
}

/** P05 event 3 (token mode, F9-02) */
export async function resetPassword(
  input: Client & { token: unknown; password: unknown; passwordConfirm: unknown },
): Promise<Result> {
  const now = input.now ?? new Date();
  const errors = checkNewPassword(input.password, input.passwordConfirm);
  if (errors.length) return fieldFail(errors); // 3-3: the token stays unused
  const hash = sha256(str(input.token));
  const passwordHash = await bcrypt.hash(str(input.password), APP_CONFIG.auth.bcryptRounds);
  const ok = await prisma.$transaction(async (tx) => {
    const claimed = await tx.authToken.updateMany({
      where: { tokenHash: hash, purpose: "PASSWORD_RESET", usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now },
    });
    if (claimed.count !== 1) return null;
    const { accountId } = await tx.authToken.findUniqueOrThrow({ where: { tokenHash: hash }, select: { accountId: true } });
    // 更新1; DISABLED / WITHDRAWN / PENDING → PE021 with nothing written (the claim rolls back)
    const upd = await tx.account.updateMany({
      where: { id: accountId, status: { in: ["ACTIVE", "LOCKED"] } },
      data: { passwordHash, failedLoginCount: 0, lockedUntil: null, status: "ACTIVE", mustChangePassword: false },
    });
    if (upd.count !== 1) throw new Rollback();
    const { role } = await tx.account.findUniqueOrThrow({ where: { id: accountId }, select: { role: true } });
    await tx.authToken.updateMany({ where: { accountId, purpose: "PASSWORD_RESET", usedAt: null }, data: { usedAt: now } }); // 更新2
    await tx.session.updateMany({ where: { accountId, revokedAt: null }, data: { revokedAt: now } }); // 更新3
    await audit(tx, { accountId, role, action: "PASSWORD_CHANGE", ip: input.ip, now }); // 更新6
    return true;
  }).catch(rollbackAsNull);
  if (!ok) return fail(400, "PE021");
  return done({ destination: "/login", code: "PI021" });
}

/** P05 event 7 (初回変更 mode): the current staff session with must_change_password */
export async function firstPasswordChange(
  input: Client & { sessionToken: string | undefined; password: unknown; passwordConfirm: unknown },
): Promise<Result> {
  const now = input.now ?? new Date();
  const s = await resolveSession(input.sessionToken, now);
  if (s.state !== "valid") return fail(401, "PI013");
  const { account, sessionId } = s.ctx;
  if (account.role === "PATIENT" || !account.mustChangePassword) return fail(403, "SE091");
  const errors = checkNewPassword(input.password, input.passwordConfirm);
  if (errors.length) return fieldFail(errors);
  const { passwordHash: current } = await prisma.account.findUniqueOrThrow({ where: { id: account.id }, select: { passwordHash: true } });
  if (await bcrypt.compare(str(input.password), current)) return fieldFail([{ field: "password", code: "PE022" }]);
  const passwordHash = await bcrypt.hash(str(input.password), APP_CONFIG.auth.bcryptRounds);
  const changed = await prisma.$transaction(async (tx) => {
    const upd = await tx.account.updateMany({ where: { id: account.id, mustChangePassword: true }, data: { passwordHash, mustChangePassword: false } });
    if (upd.count !== 1) return false; // a second submit after the first one committed
    await tx.session.updateMany({ where: { accountId: account.id, revokedAt: null, id: { not: sessionId } }, data: { revokedAt: now } });
    await audit(tx, { accountId: account.id, role: account.role, action: "PASSWORD_CHANGE", ip: input.ip, now });
    return true;
  });
  if (!changed) return fail(403, "SE091");
  return done({ destination: STAFF_HOME });
}

// ── CF-04 event 7 (更新2) ──────────────────────────────────────────────────────────────────────────────────────

/** body.versions = { TERMS?: "<version shown>", PRIVACY?: … }: a kind present = its check was set */
export async function agreeConsents(
  input: Client & { sessionToken: string | undefined; versions: unknown; guardId?: string },
): Promise<Result> {
  const now = input.now ?? new Date();
  const s = await resolveSession(input.sessionToken, now);
  if (s.state !== "valid") return fail(401, "PI013");
  const { account, reconsent } = s.ctx;
  if (account.role !== "PATIENT") return fail(404, "PE091");
  if (reconsent.length > 0) {
    const shown = (input.versions && typeof input.versions === "object" ? input.versions : {}) as Record<string, unknown>;
    const missing = reconsent.filter((k) => typeof shown[k] !== "string");
    if (missing.length) return fieldFail(missing.map((k) => ({ field: k === "TERMS" ? "agreeTerms" : "agreePrivacy", code: "PE008" })));
    for (const kind of reconsent) {
      const doc = await prisma.consentDocument.findFirst({
        where: { kind, version: shown[kind] as string, language: account.language, effectiveFrom: { lte: now } },
      });
      if (!doc) return fail(400, "PE090");
    }
    await prisma.consent.createMany({
      data: reconsent.map((kind) => ({ accountId: account.id, kind, version: shown[kind] as string, agreedAt: now, ip: input.ip })),
    });
  }
  const after = await resolveSession(input.sessionToken, now);
  if (after.state !== "valid") return fail(401, "PI013");
  return done({ destination: landing(after.ctx, input.guardId, now) });
}
