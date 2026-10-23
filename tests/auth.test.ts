// Auth foundation (F9-01…F9-07, F10-02, F17-02, N-SEC-03/04/08) against the real, seeded database. Every failure mode
// of the module has a test here; rows created by the suite carry MARK / TEST_IP and are removed in afterAll.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import bcrypt from "bcrypt";
import { NextRequest } from "next/server";
import type { Language, Role } from "@prisma/client";
import { pool, prisma } from "@/lib/prisma";
import { SEED_ACCOUNTS, SEED_PASSWORD } from "@/prisma/seed-accounts";
import { dbDate, todayJst } from "@/lib/datetime";
import { internalPath } from "@/lib/auth/access";
import { guardScreen, requireOwnBooking, requireOwnPatient, requireStaffClinic, resolveSession } from "@/lib/auth/context";
import { createGuard, readGuard, GUARD_TTL_MS } from "@/lib/auth/guard-store";
import { AUTH_LIMITS, overAuthLimit, resetAuthLimits } from "@/lib/auth/rate-limit";
import { currentConsentDocuments } from "@/lib/auth/scope";
import {
  agreeConsents, checkResetToken, firstPasswordChange, login, logout, maskEmail, register, requestPasswordReset,
  resendVerification, resetPassword, switchClinic, verifyEmail, type Result,
} from "@/lib/auth/service";
import { newSecret, readSession, sha256 } from "@/lib/auth/session";
import { POST as loginRoute } from "@/app/api/auth/login/route";

process.env.NOTIFY_OUTBOX_DIR = mkdtempSync(path.join(tmpdir(), "auth-outbox-"));
process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true"; // what experimental.authInterrupts sets in a Next build

const mockJar: { sid?: string; path: string } = { path: "/" };
jest.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sid" && mockJar.sid ? { value: mockJar.sid } : undefined) }),
  headers: async () => ({ get: (n: string) => (n === "x-pathname" ? mockJar.path : null) }),
}));

jest.setTimeout(120_000);

const MARK = "authtest";
const TEST_IP = "203.0.113.77";
const PW = "Test5678";
const client = { ip: TEST_IP, userAgent: "jest" };
const MIN = 60_000;
let pwHash = "";
let seq = 0;

/** outcome of a Next interrupt thrown by guardScreen / require*: "redirect:/x", "http:403", or "allow" */
async function outcome(fn: () => Promise<unknown>) {
  try {
    await fn();
    return "allow";
  } catch (e) {
    const d = (e as { digest?: string }).digest ?? "";
    if (d.startsWith("NEXT_REDIRECT")) return `redirect:${d.split(";")[2]}`;
    if (d.startsWith("NEXT_HTTP_ERROR_FALLBACK")) return `http:${d.split(";")[1]}`;
    throw e;
  }
}
const guard = (screen: Parameters<typeof guardScreen>[0], sid: string | undefined, p = "/") => {
  mockJar.sid = sid;
  mockJar.path = p;
  return outcome(() => guardScreen(screen));
};

const person = {
  nameType: "JP" as const, familyName: "試験", givenName: "太郎", familyNameKana: "シケン", givenNameKana: "タロウ",
  birthDate: new Date("1990-01-01T00:00:00Z"), sex: "MALE" as const, postcode: "1000001", prefecture: "東京都",
  city: "千代田区", addressLine: "1-1", phone: "0312345678",
};

async function clinicIds(codes: string[]) {
  const rows = await prisma.clinic.findMany({ where: { code: { in: codes } }, orderBy: { displayOrder: "asc" } });
  return rows.map((r) => r.id);
}

/** a test account (patients get a SELF patient and consents of the current documents unless consent = "old") */
async function makeAccount(o: {
  role?: Role; status?: "ACTIVE" | "PENDING" | "DISABLED" | "LOCKED"; clinics?: string[]; mustChangePassword?: boolean;
  language?: Language; consent?: "current" | "old"; email?: string;
} = {}) {
  const role = o.role ?? "PATIENT";
  const email = o.email ?? `u${++seq}.${Date.now()}.${MARK}@example.jp`;
  const acc = await prisma.account.create({
    data: {
      email, passwordHash: pwHash, role, status: o.status ?? "ACTIVE", language: o.language ?? "JA",
      displayName: role === "PATIENT" ? null : "試験 職員", mustChangePassword: o.mustChangePassword ?? false,
    },
  });
  if (role === "PATIENT") {
    await prisma.patient.create({ data: { ...person, accountId: acc.id, relation: "SELF", createdByKind: "PATIENT" } });
    const docs = await currentConsentDocuments(acc.language);
    await prisma.consent.createMany({
      data: docs.map((d) => ({ accountId: acc.id, kind: d.kind, version: o.consent === "old" ? "0.0" : d.version, agreedAt: new Date() })),
    });
  }
  if (o.clinics?.length) {
    await prisma.staffClinic.createMany({ data: (await clinicIds(o.clinics)).map((clinicId) => ({ accountId: acc.id, clinicId })) });
  }
  return acc;
}

const loginAs = (email: string, password = PW, extra: Partial<Parameters<typeof login>[0]> = {}) =>
  login({ ...client, email, password, ...extra });

function sid(r: Result) {
  if (!r.ok || !r.session) throw new Error(`no session: ${JSON.stringify(r)}`);
  return r.session.token;
}
const codeOf = (r: Result) => (r.ok ? (r.body.code as string | undefined) ?? "ok" : r.code);

function registrationBody(email: string, extra: Record<string, unknown> = {}) {
  return {
    email, password: PW, passwordConfirm: PW, nameType: "JP", familyName: "登録", givenName: "花子",
    familyNameKana: "トウロク", givenNameKana: "ハナコ", birthDate: "1988-04-12", sex: "2", postcode: "100-0001",
    prefecture: "東京都", city: "千代田区", addressLine: "1-1-1", phone: "090-1234-5678", agreeTerms: true, agreePrivacy: true,
    ...extra,
  };
}

/** the token of the newest NT-05 / NT-06 mail to an address, read from the fake outbox */
async function tokenMailedTo(email: string) {
  const { readdirSync, readFileSync } = await import("node:fs");
  const dir = process.env.NOTIFY_OUTBOX_DIR!;
  const lines = readdirSync(dir).flatMap((f) => readFileSync(path.join(dir, f), "utf8").trim().split("\n"));
  const mine = lines.map((l) => JSON.parse(l) as { to: string; body: string }).filter((m) => m.to === email);
  const m = mine.at(-1)?.body.match(/token=([A-Za-z0-9_-]+)/);
  if (!m) throw new Error(`no mail with a token to ${email}`);
  return { token: m[1], body: mine.at(-1)!.body };
}

beforeAll(async () => {
  pwHash = await bcrypt.hash(PW, 12);
});

beforeEach(() => resetAuthLimits());

afterAll(async () => {
  const ids = (await prisma.account.findMany({ where: { email: { contains: MARK } }, select: { id: true } })).map((a) => a.id);
  await prisma.session.deleteMany({ where: { OR: [{ ip: TEST_IP }, { accountId: { in: ids } }] } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ ip: TEST_IP }, { accountId: { in: ids } }] } });
  await prisma.notification.deleteMany({ where: { OR: [{ toAddress: { contains: MARK } }, { accountId: { in: ids } }] } });
  await prisma.patient.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.staffClinic.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.account.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
  await pool.end();
});

// ── seeded logins ───────────────────────────────────────────────────────────────────────────────────────────────

describe("every seeded account logs in with SEED_PASSWORD as SEED_ACCOUNTS says", () => {
  it.each(SEED_ACCOUNTS.map((a) => [a.email, a] as const))("%s", async (_email, a) => {
    const r = await loginAs(a.email, SEED_PASSWORD);
    if (a.status === "DISABLED") return expect(codeOf(r)).toBe("PE010");
    if (a.status === "PENDING") return expect(codeOf(r)).toBe("PE017");
    expect(r.ok).toBe(true);
    const s = await resolveSession(sid(r));
    if (s.state !== "valid") throw new Error("session not valid");
    expect(s.ctx.account.role).toBe(a.role);

    if (a.mustChangePassword) {
      expect(r.ok && r.body.destination).toBe("/password/change");
      expect(await guard("S01", sid(r), "/staff/ledger")).toBe("redirect:/password/change");
      return;
    }
    if (a.role === "PATIENT") {
      expect(r.ok && r.body.destination).toBe("/mypage");
      expect(s.ctx.clinicId).toBeNull();
      const self = await prisma.patient.findFirstOrThrow({ where: { account: { email: a.email }, relation: "SELF" } });
      expect(s.ctx.account.displayName).toBe(`${self.familyName} ${self.givenName}`);
      return;
    }
    // staff: initial clinic per F17-02
    let expected: string | null;
    if (a.role === "DOCTOR") {
      const d = await prisma.doctor.findFirstOrThrow({ where: { code: a.doctorCode } });
      const first = await prisma.slot.findFirst({ where: { doctorId: d.id, slotDate: dbDate(todayJst()) }, orderBy: { startTime: "asc" } });
      expected = first?.clinicId ?? d.primaryClinicId;
    } else if (a.allClinics) {
      expected = (await prisma.clinic.findFirst({ where: { isActive: true }, orderBy: { displayOrder: "asc" } }))!.id;
    } else {
      expected = (await clinicIds(a.clinics ?? []))[0] ?? null;
    }
    expect(s.ctx.clinicId).toBe(expected);
    expect(s.ctx.account.displayName).toBe(a.displayName);
    if (a.loginOpensSession) {
      expect(r.ok && r.body.destination).toBe("/staff/ledger");
      expect(await guard("S01", sid(r), "/staff/ledger")).toBe("allow");
    } else {
      // no clinic → ER-03 (SE091)
      expect(s.ctx.clinics).toEqual([]);
      expect(await guard("S01", sid(r), "/staff/ledger")).toBe("http:403");
    }
  });
});

// ── F9-01 lockout ───────────────────────────────────────────────────────────────────────────────────────────────

describe("F9-01 lockout", () => {
  it("5th consecutive failure locks 15 min with PE011; during the lock nothing is verified or counted; success after resets", async () => {
    const a = await makeAccount();
    const t0 = new Date();
    for (let i = 1; i <= 4; i++) expect(codeOf(await loginAs(a.email, "Wrong9999", { now: t0 }))).toBe("PE010");
    const fifth = await loginAs(a.email, "Wrong9999", { now: t0 });
    expect(fifth).toMatchObject({ ok: false, code: "PE011", params: { n: 15 } });
    let row = await prisma.account.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.failedLoginCount).toBe(5);
    expect(row.status).toBe("ACTIVE");
    const until = row.lockedUntil!;
    expect(until.getTime() - t0.getTime()).toBe(15 * MIN);

    // correct password during the lock: PE011 with {n} rounded up, nothing counted or extended
    const during = await loginAs(a.email, PW, { now: new Date(t0.getTime() + 10 * MIN + 1000) });
    expect(during).toMatchObject({ ok: false, code: "PE011", params: { n: 5 } });
    row = await prisma.account.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.failedLoginCount).toBe(5);
    expect(row.lockedUntil).toEqual(until);
    expect(await prisma.session.count({ where: { accountId: a.id } })).toBe(0);

    const after = await loginAs(a.email, PW, { now: new Date(t0.getTime() + 16 * MIN) });
    expect(after.ok).toBe(true);
    row = await prisma.account.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.failedLoginCount).toBe(0);
    expect(row.lockedUntil).toBeNull();
    expect(await prisma.auditLog.count({ where: { accountId: a.id, action: "LOGIN_NG" } })).toBe(6);
    expect(await prisma.auditLog.count({ where: { accountId: a.id, action: "LOGIN_OK" } })).toBe(1);
  });

  it("race: 8 concurrent wrong passwords count exactly to the lock (5), never past it", async () => {
    const a = await makeAccount();
    const now = new Date();
    const rs = await Promise.all(Array.from({ length: 8 }, () => loginAs(a.email, "Wrong9999", { now })));
    const row = await prisma.account.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.failedLoginCount).toBe(5);
    expect(row.lockedUntil!.getTime()).toBe(now.getTime() + 15 * MIN);
    expect(rs.filter((r) => codeOf(r) === "PE011").length).toBeGreaterThanOrEqual(1);
  });

  it("race: a correct login racing the locking failure never opens a session on a locked account", async () => {
    const a = await makeAccount();
    const now = new Date();
    await prisma.account.update({ where: { id: a.id }, data: { failedLoginCount: 4 } });
    const [bad, good] = await Promise.all([loginAs(a.email, "Wrong9999", { now }), loginAs(a.email, PW, { now })]);
    const row = await prisma.account.findUniqueOrThrow({ where: { id: a.id } });
    const sessions = await prisma.session.count({ where: { accountId: a.id, revokedAt: null } });
    if (good.ok) {
      // success committed first: the failure then counts from 0
      expect(sessions).toBe(1);
      expect(row.lockedUntil).toBeNull();
      expect(codeOf(bad)).toBe("PE010");
    } else {
      expect(codeOf(good)).toBe("PE011");
      expect(sessions).toBe(0);
      expect(row.lockedUntil).not.toBeNull();
    }
  });

  it("unknown e-mail and wrong password give the same PE010; WITHDRAWN is unknown; DISABLED with correct password PE010", async () => {
    expect(codeOf(await loginAs(`nobody.${MARK}@example.jp`))).toBe("PE010");
    const d = await makeAccount({ status: "DISABLED" });
    expect(codeOf(await loginAs(d.email))).toBe("PE010");
    const w = await makeAccount();
    await prisma.account.update({ where: { id: w.id }, data: { status: "WITHDRAWN" } });
    expect(codeOf(await loginAs(w.email))).toBe("PE010");
    expect((await prisma.account.findUniqueOrThrow({ where: { id: w.id } })).failedLoginCount).toBe(0);
  });

  it("server re-check: empty / malformed input → PE001 / PE002, nothing counted or audited", async () => {
    const a = await makeAccount();
    expect(codeOf(await loginAs(a.email, ""))).toBe("PE001");
    expect(codeOf(await loginAs("not-an-address", PW))).toBe("PE002");
    expect(await prisma.auditLog.count({ where: { accountId: a.id } })).toBe(0);
  });
});

// ── N-SEC-03 rate limits ────────────────────────────────────────────────────────────────────────────────────────

describe("N-SEC-03 rate limits", () => {
  it("login: the 11th request for one address in 15 min is PE092 and nothing is read or written", async () => {
    const a = await makeAccount();
    for (let i = 0; i < 10; i++) await loginAs(a.email, "Wrong9999", { now: new Date() });
    await prisma.account.update({ where: { id: a.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    const before = await prisma.auditLog.count({ where: { accountId: a.id } });
    const over = await loginAs(a.email, PW);
    expect(codeOf(over)).toBe("PE092");
    expect(await prisma.auditLog.count({ where: { accountId: a.id } })).toBe(before);
    expect(await prisma.session.count({ where: { accountId: a.id } })).toBe(0);
  });

  it.each(Object.entries(AUTH_LIMITS))("%s: per address and per IP limits, window reset", (action, l) => {
    const t = 1_000_000;
    const act = action as keyof typeof AUTH_LIMITS;
    for (let i = 0; i < l.perAddress; i++) expect(overAuthLimit(act, "a@x.jp", "198.51.100.1", t)).toBe(false);
    expect(overAuthLimit(act, "a@x.jp", "198.51.100.2", t)).toBe(true);
    resetAuthLimits();
    for (let i = 0; i < l.perIp; i++) expect(overAuthLimit(act, `u${i}@x.jp`, "198.51.100.3", t)).toBe(false);
    expect(overAuthLimit(act, "new@x.jp", "198.51.100.3", t)).toBe(true);
    expect(overAuthLimit(act, "new@x.jp", "198.51.100.3", t + l.windowMs)).toBe(false);
  });

  it("register, resend and reset answer PE092 over the address limit with nothing written", async () => {
    const email = `limit.${Date.now()}.${MARK}@example.jp`;
    for (let i = 0; i < 5; i++) await resendVerification({ ...client, email });
    expect(codeOf(await resendVerification({ ...client, email }))).toBe("PE092");
    for (let i = 0; i < 5; i++) await register({ ...client, body: { email }, language: "JA" });
    expect(codeOf(await register({ ...client, body: registrationBody(email), language: "JA" }))).toBe("PE092");
    expect(await prisma.account.count({ where: { email } })).toBe(0);
    for (let i = 0; i < 5; i++) await requestPasswordReset({ ...client, email });
    expect(codeOf(await requestPasswordReset({ ...client, email }))).toBe("PE092");
  });
});

// ── F9-05 sessions ──────────────────────────────────────────────────────────────────────────────────────────────

describe("F9-05 sessions", () => {
  it("cookie = 32 random bytes, table = SHA-256 only; last_seen_at moves on each read", async () => {
    const a = await makeAccount();
    const t0 = new Date();
    const token = sid(await loginAs(a.email, PW, { now: t0 }));
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    const row = await prisma.session.findFirstOrThrow({ where: { accountId: a.id } });
    expect(row.tokenHash).toBe(sha256(token));
    expect(row.expiresAt.getTime() - t0.getTime()).toBe(30 * 24 * 60 * MIN);
    const t1 = new Date(t0.getTime() + 5 * MIN);
    await readSession(token, t1);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: row.id } })).lastSeenAt).toEqual(t1);
  });

  it("patient: idle 7 days and absolute 30 days; staff: idle 30 min and absolute 12 h", async () => {
    const p = await makeAccount();
    const t0 = new Date();
    const pt = sid(await loginAs(p.email, PW, { now: t0 }));
    expect((await readSession(pt, new Date(t0.getTime() + 6 * 24 * 60 * MIN))).state).toBe("valid");
    expect((await readSession(pt, new Date(t0.getTime() + 13 * 24 * 60 * MIN))).state).toBe("invalid"); // idle from day 6
    const p2 = sid(await loginAs(p.email, PW, { now: t0 }));
    for (let d = 6; d < 30; d += 6) expect((await readSession(p2, new Date(t0.getTime() + d * 24 * 60 * MIN))).state).toBe("valid");
    expect((await readSession(p2, new Date(t0.getTime() + 30 * 24 * 60 * MIN))).state).toBe("invalid");

    const s = await makeAccount({ role: "RECEPTION", clinics: ["honin"] });
    const st = sid(await loginAs(s.email, PW, { now: t0 }));
    expect((await readSession(st, new Date(t0.getTime() + 29 * MIN))).state).toBe("valid");
    expect((await readSession(st, new Date(t0.getTime() + 60 * MIN))).state).toBe("invalid");
    const st2 = sid(await loginAs(s.email, PW, { now: t0 }));
    for (let m = 25; m < 12 * 60; m += 25) await readSession(st2, new Date(t0.getTime() + m * MIN));
    expect((await readSession(st2, new Date(t0.getTime() + 12 * 60 * MIN))).state).toBe("invalid");
  });

  it("logout revokes (更新3); a retried logout is a no-op; the old cookie answers ER-05 on any screen but P02–P05", async () => {
    const a = await makeAccount();
    const token = sid(await loginAs(a.email));
    expect(codeOf(await logout(token))).toBe("PI011");
    expect((await logout(token)).ok).toBe(true);
    expect((await readSession(token)).state).toBe("invalid");
    expect(await guard("P06", token, "/mypage")).toBe("http:401");
    expect(await guard("P01", token, "/")).toBe("http:401");
    expect(await guard("P02", token, "/login")).toBe("allow");
    const staff = await makeAccount({ role: "ADMIN", clinics: ["honin"] });
    expect((await logout(sid(await loginAs(staff.email)))).ok && "ok").toBe("ok");
    expect((await logout(sid(await loginAs(staff.email)))).body.destination).toBe("/login");
  });

  it("a session of an account disabled meanwhile no longer opens", async () => {
    const a = await makeAccount();
    const token = sid(await loginAs(a.email));
    await prisma.account.update({ where: { id: a.id }, data: { status: "DISABLED" } });
    expect((await readSession(token)).state).toBe("invalid");
  });

  it("a forged or unknown cookie is invalid, an absent one anonymous", async () => {
    expect((await readSession(newSecret().value)).state).toBe("invalid");
    expect((await readSession(undefined)).state).toBe("anonymous");
  });
});

// ── 02 §2 access, role escalation, N-SEC-08 scope ──────────────────────────────────────────────────────────────

describe("guardScreen (02 §2) and scope helpers", () => {
  let patient: string, reception: string, admin: string, doctor: string, firstChange: string, reconsent: string;
  let patientAccountId: string;

  beforeAll(async () => {
    const p = await makeAccount();
    patientAccountId = p.id;
    patient = sid(await loginAs(p.email));
    reception = sid(await loginAs((await makeAccount({ role: "RECEPTION", clinics: ["honin"] })).email));
    admin = sid(await loginAs((await makeAccount({ role: "ADMIN", clinics: ["honin", "ekimae"] })).email));
    doctor = sid(await loginAs("doctor.tanaka@example.jp", SEED_PASSWORD));
    firstChange = sid(await loginAs((await makeAccount({ role: "ADMIN", clinics: ["honin"], mustChangePassword: true })).email));
    reconsent = sid(await loginAs((await makeAccount({ consent: "old" })).email));
  });

  it("anonymous: public screens open, login screens go through the guard with the target kept", async () => {
    expect(await guard("P01", undefined)).toBe("allow");
    expect(await guard("P11", undefined, "/booking/new")).toBe("allow");
    expect(await guard("P06", undefined, "/mypage?tab=1")).toBe(`redirect:/api/auth/guard?next=${encodeURIComponent("/mypage?tab=1")}`);
    expect(await guard("S01", undefined, "/staff/ledger")).toMatch(/^redirect:\/api\/auth\/guard/);
    expect(await guard("P05", undefined, "/password/change")).toMatch(/^redirect:\/api\/auth\/guard/);
  });

  it("logged-in redirects (F9-04, 02 §2)", async () => {
    for (const s of ["P02", "P03", "P04"] as const) expect(await guard(s, patient)).toBe("redirect:/mypage");
    for (const s of ["P01", "P02", "P06", "P08"] as const) expect(await guard(s, reception)).toBe("redirect:/staff/ledger");
    expect(await guard("P11", reception, "/booking/new")).toBe("redirect:/staff/booking");
    expect(await guard("P11", admin, "/booking/new")).toBe("redirect:/staff/booking");
    expect(await guard("P11", doctor, "/booking/new")).toBe("redirect:/staff/ledger");
    expect(await guard("P05", patient, "/password/change")).toBe("redirect:/mypage");
    expect(await guard("P05", reception, "/password/change")).toBe("redirect:/staff/ledger");
    expect(await guard("P05", patient, "/password/reset?token=x")).toBe("allow"); // token mode whatever the session
  });

  it("role escalation: a role without the screen gets ER-03; a patient never reaches a staff screen", async () => {
    expect(await guard("S02", doctor)).toBe("http:403");
    expect(await guard("A01", doctor)).toBe("http:403");
    expect(await guard("A02", doctor)).toBe("allow");
    for (const s of ["A04", "A05"] as const) expect(await guard(s, reception)).toBe("http:403");
    expect(await guard("A03", reception)).toBe("allow"); // Q-006
    for (const s of ["A04", "A05", "S03"] as const) expect(await guard(s, admin)).toBe("allow");
    expect(await guard("S01", patient, "/staff/ledger")).toBe("redirect:/mypage");
    expect(await guard("A05", patient, "/admin/staff")).toBe("redirect:/mypage");
  });

  it("must_change_password: every URL → P05 初回変更 until changed; re-consent: every patient URL → CF-04", async () => {
    for (const s of ["S01", "A05", "P01"] as const) expect(await guard(s, firstChange)).toBe("redirect:/password/change");
    expect(await guard("P05", firstChange, "/password/change")).toBe("allow");
    for (const s of ["P01", "P06", "P15", "P02"] as const) expect(await guard(s, reconsent)).toBe("redirect:/consent");
  });

  it("requireStaffClinic (N-SEC-08): outside the session's clinics → ER-03; patients and anonymous refused", async () => {
    const [honin, , nishiguchi] = await clinicIds(["honin", "ekimae", "nishiguchi"]);
    mockJar.sid = reception;
    expect(await outcome(() => requireStaffClinic(honin))).toBe("allow");
    expect(await outcome(() => requireStaffClinic(nishiguchi))).toBe("http:403");
    expect(await outcome(() => requireStaffClinic("not-a-uuid"))).toBe("http:403");
    mockJar.sid = patient;
    expect(await outcome(() => requireStaffClinic(honin))).toBe("http:403");
    mockJar.sid = firstChange;
    expect(await outcome(() => requireStaffClinic(honin))).toBe("http:403");
    mockJar.sid = undefined;
    expect(await outcome(() => requireStaffClinic(honin))).toBe("http:401");
  });

  it("requireOwnPatient / requireOwnBooking (F8-01): another account's records answer ER-01", async () => {
    const own = await prisma.patient.findFirstOrThrow({ where: { accountId: patientAccountId } });
    const other = await prisma.patient.findFirstOrThrow({ where: { account: { email: "yamada.taro@example.jp" } } });
    const othersBooking = await prisma.booking.findFirst({ where: { patient: { accountId: { not: patientAccountId } } } });
    mockJar.sid = patient;
    expect(await outcome(() => requireOwnPatient(own.id))).toBe("allow");
    expect(await outcome(() => requireOwnPatient(other.id))).toBe("http:404");
    expect(await outcome(() => requireOwnPatient("../etc"))).toBe("http:404");
    if (othersBooking) expect(await outcome(() => requireOwnBooking(othersBooking.id))).toBe("http:404");
    mockJar.sid = reception;
    expect(await outcome(() => requireOwnPatient(own.id))).toBe("http:404");
  });

  it("clinic switch (更新4): inside 抽出4 written; outside, patient, first-change, malformed → SE091 and nothing written", async () => {
    const [honin, ekimae, nishiguchi] = await clinicIds(["honin", "ekimae", "nishiguchi"]);
    expect((await switchClinic(admin, ekimae)).ok).toBe(true);
    const s = await resolveSession(admin);
    expect(s.state === "valid" && s.ctx.clinicId).toBe(ekimae);
    for (const [token, id] of [[admin, nishiguchi], [patient, honin], [firstChange, honin], [admin, 42]] as const) {
      expect(codeOf(await switchClinic(token, id))).toBe("SE091");
    }
    const after = await resolveSession(admin);
    expect(after.state === "valid" && after.ctx.clinicId).toBe(ekimae);
    expect(codeOf(await switchClinic(undefined, honin))).toBe("PI013");
  });
});

// ── F9-03 login guard, open redirect ────────────────────────────────────────────────────────────────────────────

describe("F9-03 login guard and open redirect", () => {
  it("internalPath keeps same-origin paths only", () => {
    expect(internalPath("/bookings?x=1")).toBe("/bookings?x=1");
    for (const bad of ["//evil.example", "https://evil.example/", "/\\evil.example", "javascript:alert(1)", "evil", "/\u0000x", 42, null]) {
      expect(internalPath(bad)).toBeNull();
    }
    expect(internalPath("/a/../..//evil.example")).toBeNull(); // normalises to "//evil.example"
  });

  it("the target is restored once after login; a target the role cannot open falls back to the default", async () => {
    const p = await makeAccount();
    const g = createGuard("/bookings");
    expect((await loginAs(p.email, PW, { guardId: g })).ok && "x").toBe("x");
    const r1 = await loginAs(p.email, PW, { guardId: createGuard("/bookings") });
    expect(r1.ok && r1.body.destination).toBe("/bookings");
    const reuse = await loginAs(p.email, PW, { guardId: g });
    expect(reuse.ok && reuse.body.destination).toBe("/mypage");
    const staff = await makeAccount({ role: "RECEPTION", clinics: ["honin"] });
    const r2 = await loginAs(staff.email, PW, { guardId: createGuard("/bookings") });
    expect(r2.ok && r2.body.destination).toBe("/staff/ledger");
    const r3 = await loginAs(staff.email, PW, { guardId: createGuard("/admin/staff") });
    expect(r3.ok && r3.body.destination).toBe("/staff/ledger");
    const r4 = await loginAs(staff.email, PW, { guardId: createGuard("//evil.example/x") });
    expect(r4.ok && r4.body.destination).toBe("/staff/ledger");
  });

  it("the guard record lives 30 min", () => {
    const t = Date.now();
    const g = createGuard("/bookings", t);
    expect(readGuard(g, t + GUARD_TTL_MS - 1)?.target).toBe("/bookings");
    expect(readGuard(g, t + GUARD_TTL_MS)).toBeNull();
  });
});

// ── F10-02 re-consent ───────────────────────────────────────────────────────────────────────────────────────────

describe("F10-02 re-consent (CF-04)", () => {
  it("login lands on CF-04; only the changed kinds are required and written with the shown version; then the target", async () => {
    const a = await makeAccount({ consent: "old" });
    await prisma.consent.deleteMany({ where: { accountId: a.id, kind: "PRIVACY" } });
    const docs = await currentConsentDocuments("JA");
    const privacy = docs.find((d) => d.kind === "PRIVACY")!;
    const terms = docs.find((d) => d.kind === "TERMS")!;
    await prisma.consent.create({ data: { accountId: a.id, kind: "PRIVACY", version: privacy.version, agreedAt: new Date() } });

    const g = createGuard("/bookings");
    const r = await loginAs(a.email, PW, { guardId: g });
    expect(r.ok && [r.body.destination, r.body.code]).toEqual(["/consent", "PW006"]);
    const token = sid(r);
    expect(codeOf(await agreeConsents({ ...client, sessionToken: token, versions: {} }))).toBe("PE008");
    expect(codeOf(await agreeConsents({ ...client, sessionToken: token, versions: { TERMS: "9.9" } }))).toBe("PE090");
    const ok = await agreeConsents({ ...client, sessionToken: token, versions: { TERMS: terms.version }, guardId: g });
    expect(ok.ok && ok.body.destination).toBe("/bookings");
    const rows = await prisma.consent.findMany({ where: { accountId: a.id }, orderBy: { agreedAt: "asc" } });
    expect(rows.filter((c) => c.kind === "PRIVACY")).toHaveLength(1);
    expect(rows.filter((c) => c.kind === "TERMS").map((c) => c.version)).toEqual(["0.0", terms.version]);
  });
});

// ── P03 registration and verification (F9-06) ───────────────────────────────────────────────────────────────────

describe("P03 registration and NT-06 verification", () => {
  it("creates PENDING account, SELF patient, two consents, a 24 h token and NT-06 with /register?token=", async () => {
    const email = `reg.${Date.now()}.${MARK}@example.jp`;
    const t0 = new Date();
    const r = await register({ ...client, body: registrationBody(email.toUpperCase()), language: "EN", now: t0 });
    expect(r.ok && r.body).toEqual({ code: "PI001", params: { email } });
    const acc = await prisma.account.findFirstOrThrow({ where: { email }, include: { patients: true, consents: true, authTokens: true } });
    expect([acc.role, acc.status, acc.language, acc.notifyChannel]).toEqual(["PATIENT", "PENDING", "EN", "MAIL"]);
    expect(acc.patients).toHaveLength(1);
    expect(acc.patients[0]).toMatchObject({ relation: "SELF", phone: "09012345678", postcode: "1000001", sex: "FEMALE" });
    expect(acc.consents.map((c) => c.kind).sort()).toEqual(["PRIVACY", "TERMS"]);
    expect(acc.authTokens).toHaveLength(1);
    expect(acc.authTokens[0].expiresAt.getTime() - t0.getTime()).toBe(24 * 60 * MIN);
    expect(await bcrypt.getRounds(acc.passwordHash)).toBeGreaterThanOrEqual(12); // N-SEC-02
    const mail = await tokenMailedTo(email);
    expect(mail.body).toContain(`/register?token=${mail.token}`);
    expect(sha256(mail.token)).toBe(acc.authTokens[0].tokenHash);
    expect(await prisma.notification.count({ where: { accountId: acc.id, event: "NT06_VERIFY" } })).toBe(1);
    expect(codeOf(await loginAs(email, PW))).toBe("PE017");
  });

  it("an address of an ACTIVE account → PE005, nothing written; field errors come first; tampered values → PE090", async () => {
    const a = await makeAccount();
    const before = await prisma.consent.count({ where: { accountId: a.id } });
    expect(codeOf(await register({ ...client, body: registrationBody(a.email), language: "JA" }))).toBe("PE005");
    expect(await prisma.consent.count({ where: { accountId: a.id } })).toBe(before);
    expect(codeOf(await register({ ...client, body: registrationBody(a.email, { password: "short" }), language: "JA" }))).toBe("PE006");
    expect(codeOf(await register({ ...client, body: registrationBody(`x.${MARK}@example.jp`, { prefecture: "火星" }), language: "JA" }))).toBe("PE090");
    expect(codeOf(await register({ ...client, body: registrationBody(`x.${MARK}@example.jp`, { agreePrivacy: false }), language: "JA" }))).toBe("PE008");
  });

  it("re-register of a PENDING address overwrites it: same account, old tokens void, consents appended, created_at kept", async () => {
    const email = `rereg.${Date.now()}.${MARK}@example.jp`;
    await register({ ...client, body: registrationBody(email), language: "JA" });
    const first = await prisma.account.findFirstOrThrow({ where: { email } });
    const firstToken = (await tokenMailedTo(email)).token;
    await register({ ...client, body: registrationBody(email, { familyName: "上書", password: "Other1234", passwordConfirm: "Other1234" }), language: "VI" });
    const accs = await prisma.account.findMany({ where: { email }, include: { patients: true, consents: true, authTokens: true } });
    expect(accs).toHaveLength(1);
    expect(accs[0].id).toBe(first.id);
    expect(accs[0].createdAt).toEqual(first.createdAt);
    expect(accs[0].language).toBe("VI");
    expect(accs[0].patients.map((p) => p.familyName)).toEqual(["上書"]);
    expect(accs[0].consents).toHaveLength(4);
    expect(accs[0].authTokens.filter((t) => t.usedAt === null)).toHaveLength(1);
    expect(codeOf(await verifyEmail({ ...client, token: firstToken }))).toBe("PE004");
  });

  it("race: two registrations of one new address at once → one passes, the other PE005 (unique index accounts_email_active_key)", async () => {
    const email = `race.${Date.now()}.${MARK}@example.jp`;
    const rs = await Promise.all([1, 2, 3].map(() => register({ ...client, body: registrationBody(email), language: "JA" })));
    const codes = rs.map(codeOf).sort();
    expect(await prisma.account.count({ where: { email } })).toBe(1);
    // a racer that saw the committed PENDING row overwrites it (5-2) instead; never two accounts
    expect(codes.every((c) => c === "PI001" || c === "PE005")).toBe(true);
    expect(codes).toContain("PI001");
  });

  it("the DB refuses a second live account per address even without the app check", async () => {
    const a = await makeAccount();
    await expect(prisma.account.create({ data: { email: a.email, passwordHash: pwHash, role: "PATIENT", status: "PENDING" } })).rejects.toMatchObject({ code: "P2002" });
  });

  it("verify: activates, logs in replacing the current session, LOGIN_OK; reuse / expired / not PENDING → PE004", async () => {
    const email = `ver.${Date.now()}.${MARK}@example.jp`;
    await register({ ...client, body: registrationBody(email), language: "JA" });
    const { token } = await tokenMailedTo(email);
    const other = sid(await loginAs((await makeAccount()).email));
    const r = await verifyEmail({ ...client, token, currentSessionToken: other });
    expect(r.ok && [r.body.destination, r.body.code]).toEqual(["/mypage", "PI002"]);
    const acc = await prisma.account.findFirstOrThrow({ where: { email } });
    expect(acc.status).toBe("ACTIVE");
    expect(acc.emailVerifiedAt).not.toBeNull();
    expect((await readSession(other)).state).toBe("invalid");
    expect((await readSession(sid(r))).state).toBe("valid");
    expect(await prisma.auditLog.count({ where: { accountId: acc.id, action: "LOGIN_OK" } })).toBe(1);
    expect(codeOf(await verifyEmail({ ...client, token }))).toBe("PE004"); // token reuse

    // expired
    const email2 = `ver2.${Date.now()}.${MARK}@example.jp`;
    await register({ ...client, body: registrationBody(email2), language: "JA" });
    const t2 = (await tokenMailedTo(email2)).token;
    expect(codeOf(await verifyEmail({ ...client, token: t2, now: new Date(Date.now() + 24 * 60 * MIN + 1000) }))).toBe("PE004");
    expect((await prisma.account.findFirstOrThrow({ where: { email: email2 } })).status).toBe("PENDING");

    // valid token, account DISABLED meanwhile → PE004, nothing written (token stays unused)
    await prisma.account.updateMany({ where: { email: email2 }, data: { status: "DISABLED" } });
    expect(codeOf(await verifyEmail({ ...client, token: t2 }))).toBe("PE004");
    expect((await prisma.authToken.findUniqueOrThrow({ where: { tokenHash: sha256(t2) } })).usedAt).toBeNull();
    expect(codeOf(await verifyEmail({ ...client, token: "" }))).toBe("PE004");
  });

  it("race: the NT-06 link opened twice at once logs in exactly once", async () => {
    const email = `ver3.${Date.now()}.${MARK}@example.jp`;
    await register({ ...client, body: registrationBody(email), language: "JA" });
    const { token } = await tokenMailedTo(email);
    const rs = await Promise.all([1, 2, 3].map(() => verifyEmail({ ...client, token })));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    const acc = await prisma.account.findFirstOrThrow({ where: { email } });
    expect(await prisma.session.count({ where: { accountId: acc.id } })).toBe(1);
  });

  it("resend: always PI001; only a PENDING account gets a new token, the old one void", async () => {
    const active = await makeAccount();
    expect(codeOf(await resendVerification({ ...client, email: active.email }))).toBe("PI001");
    expect(await prisma.authToken.count({ where: { accountId: active.id } })).toBe(0);
    expect(codeOf(await resendVerification({ ...client, email: `none.${MARK}@example.jp` }))).toBe("PI001");
    const email = `resend.${Date.now()}.${MARK}@example.jp`;
    await register({ ...client, body: registrationBody(email), language: "JA" });
    const old = (await tokenMailedTo(email)).token;
    expect(codeOf(await resendVerification({ ...client, email }))).toBe("PI001");
    const fresh = (await tokenMailedTo(email)).token;
    expect(fresh).not.toBe(old);
    expect(codeOf(await verifyEmail({ ...client, token: old }))).toBe("PE004");
    expect((await verifyEmail({ ...client, token: fresh })).ok).toBe(true);
  });
});

// ── P04 / P05 password reset (F9-02) ────────────────────────────────────────────────────────────────────────────

describe("P04 / P05 password reset", () => {
  async function resetTokenFor(email: string, now = new Date()) {
    expect(codeOf(await requestPasswordReset({ ...client, email, now }))).toBe("PI020");
    return (await tokenMailedTo(email)).token;
  }

  it("request: always PI020; a 30 min token and NT-05 only for an eligible account", async () => {
    const before = await prisma.authToken.count({ where: { purpose: "PASSWORD_RESET" } });
    expect(codeOf(await requestPasswordReset({ ...client, email: `none.${MARK}@example.jp` }))).toBe("PI020");
    const pending = await makeAccount({ status: "PENDING" });
    expect(codeOf(await requestPasswordReset({ ...client, email: pending.email }))).toBe("PI020");
    expect(await prisma.authToken.count({ where: { purpose: "PASSWORD_RESET" } })).toBe(before);
    const a = await makeAccount();
    const t0 = new Date();
    const token = await resetTokenFor(a.email, t0);
    const row = await prisma.authToken.findUniqueOrThrow({ where: { tokenHash: sha256(token) } });
    expect(row.expiresAt.getTime() - t0.getTime()).toBe(30 * MIN); // Q-007
    expect(await prisma.notification.count({ where: { accountId: a.id, event: "NT05_PW_RESET" } })).toBe(1);
    expect(codeOf(await checkResetToken(token))).toBe("ok");
    expect(maskEmail("ab@x.jp")).toBe("a***@x.jp");
    expect(maskEmail("abc@x.jp")).toBe("ab***@x.jp");
  });

  it("reset: single use, every open reset token void, all sessions revoked, LOCKED → ACTIVE, flag cleared, audit", async () => {
    const a = await makeAccount();
    const s1 = sid(await loginAs(a.email));
    const t1 = await resetTokenFor(a.email);
    const t2 = await resetTokenFor(a.email);
    await prisma.account.update({
      where: { id: a.id }, data: { status: "LOCKED", failedLoginCount: 5, lockedUntil: new Date(Date.now() + 10 * MIN), mustChangePassword: true },
    });
    const r = await resetPassword({ ...client, token: t2, password: "Newpass123", passwordConfirm: "Newpass123" });
    expect(r.ok && [r.body.destination, r.body.code]).toEqual(["/login", "PI021"]);
    const row = await prisma.account.findUniqueOrThrow({ where: { id: a.id } });
    expect([row.status, row.failedLoginCount, row.lockedUntil, row.mustChangePassword]).toEqual(["ACTIVE", 0, null, false]);
    expect((await readSession(s1)).state).toBe("invalid");
    expect(await prisma.authToken.count({ where: { accountId: a.id, purpose: "PASSWORD_RESET", usedAt: null } })).toBe(0);
    expect(codeOf(await resetPassword({ ...client, token: t1, password: "Other1234", passwordConfirm: "Other1234" }))).toBe("PE021");
    expect(codeOf(await resetPassword({ ...client, token: t2, password: "Other1234", passwordConfirm: "Other1234" }))).toBe("PE021");
    expect((await loginAs(a.email, "Newpass123")).ok).toBe(true);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { accountId: a.id, action: "PASSWORD_CHANGE" } });
    expect([audit.role, audit.ip, audit.detail]).toEqual(["PATIENT", TEST_IP, null]);
  });

  it("reset: weak password keeps the token; expired token / DISABLED / PENDING account → PE021 with nothing written", async () => {
    const a = await makeAccount();
    const t = await resetTokenFor(a.email);
    expect(codeOf(await resetPassword({ ...client, token: t, password: "allletters", passwordConfirm: "allletters" }))).toBe("PE006");
    expect(codeOf(await resetPassword({ ...client, token: t, password: "Newpass123", passwordConfirm: "Newpass124" }))).toBe("PE007");
    expect(codeOf(await resetPassword({ ...client, token: t, password: "Newpass123", passwordConfirm: "Newpass123", now: new Date(Date.now() + 31 * MIN) }))).toBe("PE021");
    await prisma.account.update({ where: { id: a.id }, data: { status: "DISABLED" } });
    expect(codeOf(await checkResetToken(t))).toBe("PE021");
    expect(codeOf(await resetPassword({ ...client, token: t, password: "Newpass123", passwordConfirm: "Newpass123" }))).toBe("PE021");
    const row = await prisma.account.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.passwordHash).toBe(pwHash);
    expect((await prisma.authToken.findUniqueOrThrow({ where: { tokenHash: sha256(t) } })).usedAt).toBeNull();
    expect(await prisma.auditLog.count({ where: { accountId: a.id, action: "PASSWORD_CHANGE" } })).toBe(0);
  });

  it("race: a double submit of one reset token changes the password once", async () => {
    const a = await makeAccount();
    const t = await resetTokenFor(a.email);
    const rs = await Promise.all(["Newpass111", "Newpass222"].map((p) => resetPassword({ ...client, token: t, password: p, passwordConfirm: p })));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { accountId: a.id, action: "PASSWORD_CHANGE" } })).toBe(1);
  });

  it("a reset token is not an e-mail verification token and vice versa", async () => {
    const a = await makeAccount();
    const t = await resetTokenFor(a.email);
    expect(codeOf(await verifyEmail({ ...client, token: t }))).toBe("PE004");
    expect((await prisma.authToken.findUniqueOrThrow({ where: { tokenHash: sha256(t) } })).usedAt).toBeNull();
  });
});

describe("P05 初回変更 mode", () => {
  it("new = current → PE022; success clears the flag, revokes the other sessions only, S01; a second submit → SE091", async () => {
    const a = await makeAccount({ role: "RECEPTION", clinics: ["honin"], mustChangePassword: true });
    const other = sid(await loginAs(a.email));
    const r = await loginAs(a.email);
    expect(r.ok && [r.body.destination, r.body.code]).toEqual(["/password/change", "PI022"]);
    const cur = sid(r);
    expect(codeOf(await firstPasswordChange({ ...client, sessionToken: cur, password: PW, passwordConfirm: PW }))).toBe("PE022");
    const ok = await firstPasswordChange({ ...client, sessionToken: cur, password: "Fresh1234", passwordConfirm: "Fresh1234" });
    expect(ok.ok && ok.body.destination).toBe("/staff/ledger");
    expect((await prisma.account.findUniqueOrThrow({ where: { id: a.id } })).mustChangePassword).toBe(false);
    expect((await readSession(other)).state).toBe("invalid");
    expect((await readSession(cur)).state).toBe("valid");
    expect(await guard("S01", cur, "/staff/ledger")).toBe("allow");
    expect(codeOf(await firstPasswordChange({ ...client, sessionToken: cur, password: "Fresh5678", passwordConfirm: "Fresh5678" }))).toBe("SE091");
    expect(await prisma.auditLog.count({ where: { accountId: a.id, action: "PASSWORD_CHANGE" } })).toBe(1);
  });

  it("not for patients, unflagged staff or without a session", async () => {
    const p = sid(await loginAs((await makeAccount()).email));
    expect(codeOf(await firstPasswordChange({ ...client, sessionToken: p, password: "Fresh1234", passwordConfirm: "Fresh1234" }))).toBe("SE091");
    expect(codeOf(await firstPasswordChange({ ...client, sessionToken: undefined, password: "Fresh1234", passwordConfirm: "Fresh1234" }))).toBe("PI013");
  });
});

// ── route handlers: CSRF (N-SEC-04), cookies, language ─────────────────────────────────────────────────────────

describe("route handlers", () => {
  const post = (body: unknown, headers: Record<string, string>) =>
    new NextRequest("http://localhost:3001/api/auth/login", {
      method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-forwarded-for": TEST_IP, ...headers },
    });

  it("a cross-origin login is refused with PE090 before anything is read", async () => {
    const res = await loginRoute(post({ email: "yamada.taro@example.jp", password: SEED_PASSWORD }, { origin: "http://evil.example" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "PE090", params: {} });
  });

  it("same-origin login sets sid (httpOnly, Lax, path /) and lang from the account; errors are { code, params }", async () => {
    const a = await makeAccount({ language: "VI" });
    const res = await loginRoute(post({ email: a.email, password: PW }, { origin: "http://localhost:3001" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, destination: "/mypage", role: "PATIENT", code: "PI012" });
    const cookies = res.headers.getSetCookie().join("\n");
    expect(cookies).toMatch(/sid=[A-Za-z0-9_-]{43};.*Path=\/;.*HttpOnly;.*SameSite=lax/i);
    expect(cookies).toMatch(/lang=vi;.*Max-Age=31536000/i);
    const bad = await loginRoute(post({ email: a.email, password: "Wrong9999" }, { origin: "http://localhost:3001" }));
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ code: "PE010", params: {} });
  });
});
