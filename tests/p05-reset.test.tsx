// spec-screen: P05 — reset token: 30 min expiry (Q-007) → PE021, single use, every open token void, every session
// revoked, new password logs in and the old one not; the route's PI021 flag for P02; both modes of the screen.
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import bcrypt from "bcrypt";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }), usePathname: () => "/password/reset" }));
jest.mock("next/link", () => ({ __esModule: true, default: (p: { href: string; children: React.ReactNode; className?: string }) => <a href={p.href} className={p.className}>{p.children}</a> }));
process.env.NOTIFY_OUTBOX_DIR = mkdtempSync(path.join(tmpdir(), "p05-outbox-"));

import { pool, prisma } from "@/lib/prisma";
import { resetAuthLimits } from "@/lib/auth/rate-limit";
import { checkResetToken, login, requestPasswordReset, RESET_TOKEN_MS, resetPassword } from "@/lib/auth/service";
import { readSession } from "@/lib/auth/session";
import { POST as resetRoute } from "@/app/api/auth/password/reset/route";
import { ToastProvider } from "@/components/ui/Toast";
import { NewPasswordForm } from "@/components/patient/NewPasswordForm";

jest.setTimeout(60_000);
const MARK = "p05test";
const client = { ip: "203.0.113.85", userAgent: "jest" };
let seq = 0;

async function patient() {
  const email = `p${++seq}.${MARK}@example.jp`;
  return prisma.account.create({ data: { email, passwordHash: await bcrypt.hash("Old12345", 4), role: "PATIENT", status: "ACTIVE" } });
}
async function tokenFor(email: string, now = new Date()) {
  await requestPasswordReset({ ...client, email, now });
  const dir = process.env.NOTIFY_OUTBOX_DIR!;
  const lines = readdirSync(dir).flatMap((f) => readFileSync(path.join(dir, f), "utf8").trim().split("\n"));
  const mail = lines.map((l) => JSON.parse(l) as { to: string; body: string }).filter((m) => m.to === email).at(-1)!;
  return mail.body.match(/token=([A-Za-z0-9_-]+)/)![1];
}
const reset = (token: string, password: string, now?: Date) => resetPassword({ ...client, token, password, passwordConfirm: password, now });
const code = (r: { ok: boolean; code?: string; body?: Record<string, unknown> }) => (r.ok ? "ok" : r.code);

beforeEach(() => resetAuthLimits());
afterAll(async () => {
  const ids = (await prisma.account.findMany({ where: { email: { contains: MARK } }, select: { id: true } })).map((a) => a.id);
  for (const m of [prisma.session, prisma.auditLog, prisma.notification, prisma.authToken] as const) {
    await (m as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({ where: { accountId: { in: ids } } });
  }
  await prisma.account.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
  await pool.end();
});

describe("P05 reset token", () => {
  it("valid until 30 min after issue, PE021 from then on (screen and submit)", async () => {
    const a = await patient();
    const t0 = new Date();
    const token = await tokenFor(a.email, t0);
    expect(RESET_TOKEN_MS).toBe(30 * 60_000);
    expect(code(await checkResetToken(token, new Date(t0.getTime() + RESET_TOKEN_MS - 1000)))).toBe("ok");
    expect(code(await checkResetToken(token, new Date(t0.getTime() + RESET_TOKEN_MS)))).toBe("PE021");
    expect(code(await reset(token, "Newpass123", new Date(t0.getTime() + RESET_TOKEN_MS)))).toBe("PE021");
    expect((await prisma.account.findUniqueOrThrow({ where: { id: a.id } })).passwordHash).toBe(a.passwordHash);
  });

  it("single use; every other open token void; every session revoked; new password logs in, the old one not", async () => {
    const a = await patient();
    const s1 = await login({ ...client, email: a.email, password: "Old12345" });
    const s2 = await login({ ...client, email: a.email, password: "Old12345" });
    const older = await tokenFor(a.email);
    const token = await tokenFor(a.email);
    expect(code(await reset(token, "Newpass123"))).toBe("ok");
    expect(code(await reset(token, "Again1234"))).toBe("PE021"); // second use
    expect(code(await reset(older, "Again1234"))).toBe("PE021"); // voided by the reset (更新2, Q6)
    for (const s of [s1, s2]) expect((await readSession(s.ok ? s.session!.token : "")).state).toBe("invalid");
    expect(await prisma.session.count({ where: { accountId: a.id, revokedAt: null } })).toBe(0);
    expect(code(await login({ ...client, email: a.email, password: "Old12345" }))).toBe("PE010");
    expect(code(await login({ ...client, email: a.email, password: "Newpass123" }))).toBe("ok");
  });

  it("the route drops the browser's session cookie and flags PI021 for P02", async () => {
    const a = await patient();
    const token = await tokenFor(a.email);
    const res = await resetRoute(new NextRequest("http://localhost:3002/api/auth/password/reset", {
      method: "POST", body: JSON.stringify({ token, password: "Newpass123", passwordConfirm: "Newpass123" }),
      headers: { "content-type": "application/json", origin: "http://localhost:3002", cookie: "sid=abc" },
    }));
    expect(await res.json()).toMatchObject({ ok: true, destination: "/login", code: "PI021" });
    const set = res.headers.getSetCookie().join("\n");
    expect(set).toMatch(/flash=PI021/);
    expect(set).toMatch(/sid=;/);
  });
});

describe("P05 screen", () => {
  const render = (props: Parameters<typeof NewPasswordForm>[0]) =>
    renderToStaticMarkup(<ToastProvider lang={props.lang}><NewPasswordForm {...props} /></ToastProvider>);

  it("token mode: masked address, rule text, note 6-1, button disabled", () => {
    const html = render({ lang: "ja", mode: "token", token: "x", valid: true, email: "ya***@example.jp" });
    expect(html).toContain("対象:");
    expect(html).toContain("ya***@example.jp");
    expect(html).toContain("8〜64文字、英字と数字をそれぞれ1文字以上");
    expect(html).toContain("変更すると、ログイン中のすべての端末からログアウトします。");
    expect(html).toMatch(/class="btn bdis bw" disabled="">変更する/);
    expect(html).not.toContain("初回ログインのため");
  });
  it("① invalid token: PE021 and もう一度申し込む → P04 only", () => {
    const html = render({ lang: "ja", mode: "token", token: "x", valid: false, email: "" });
    expect(html).toContain("このリンクは無効か、有効期限が切れています。");
    expect(html).toContain('href="/password/forgot"');
    expect(html).not.toContain("新しいパスワード");
  });
  it("② 初回変更: PI022 banner, unmasked address, no note 6-1", () => {
    const html = render({ lang: "ja", mode: "first", valid: true, email: "reception.firstlogin@example.jp" });
    expect(html).toContain("初回ログインのため、パスワードを変更してください。");
    expect(html).toContain("reception.firstlogin@example.jp");
    expect(html).not.toContain("すべての端末からログアウト");
  });
});
