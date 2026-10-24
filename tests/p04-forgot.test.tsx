// spec-screen: P04 — no account enumeration (same status, body and minimum time for every kind of address), rate limit
// with nothing written, older tokens left open (Q7), the screen states.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import bcrypt from "bcrypt";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }), usePathname: () => "/password/forgot" }));
jest.mock("next/link", () => ({ __esModule: true, default: (p: { href: string; children: React.ReactNode; className?: string }) => <a href={p.href} className={p.className}>{p.children}</a> }));
process.env.NOTIFY_OUTBOX_DIR = mkdtempSync(path.join(tmpdir(), "p04-outbox-"));

import { pool, prisma } from "@/lib/prisma";
import { resetAuthLimits } from "@/lib/auth/rate-limit";
import { RESET_MIN_RESPONSE_MS, requestPasswordReset } from "@/lib/auth/service";
import { POST as forgotRoute } from "@/app/api/auth/password/forgot/route";
import { ToastProvider } from "@/components/ui/Toast";
import { ForgotForm } from "@/components/patient/ForgotForm";

jest.setTimeout(60_000);
const MARK = "p04test";
const IP = "203.0.113.84";
let seq = 0;

async function account(status: "ACTIVE" | "PENDING" | "DISABLED" | "WITHDRAWN" | "LOCKED", role: "PATIENT" | "RECEPTION" = "PATIENT") {
  const email = `a${++seq}.${status.toLowerCase()}.${MARK}@example.jp`;
  return prisma.account.create({
    data: { email, passwordHash: await bcrypt.hash("Test1234", 4), role, status, displayName: role === "PATIENT" ? null : "職員" },
  });
}
const post = (email: unknown, ip = IP) => forgotRoute(new NextRequest("http://localhost:3002/api/auth/password/forgot", {
  method: "POST", body: JSON.stringify({ email }),
  headers: { "content-type": "application/json", origin: "http://localhost:3002", "x-forwarded-for": ip },
}));

beforeEach(() => resetAuthLimits());
afterAll(async () => {
  const ids = (await prisma.account.findMany({ where: { email: { contains: MARK } }, select: { id: true } })).map((a) => a.id);
  await prisma.notification.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.authToken.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.account.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
  await pool.end();
});

describe("P04 no account enumeration (F9-02, 3-1 / 3-2, Q4)", () => {
  it("known, unknown, PENDING, DISABLED, WITHDRAWN and staff addresses: same status and body, none faster than the minimum", async () => {
    const known = await account("ACTIVE");
    const addresses = [
      known.email, `nobody.${MARK}@example.jp`, (await account("PENDING")).email, (await account("DISABLED")).email,
      (await account("WITHDRAWN")).email, (await account("ACTIVE", "RECEPTION")).email,
    ];
    const answers: Array<{ status: number; body: string; ms: number }> = [];
    for (const [i, email] of addresses.entries()) {
      const t0 = Date.now();
      const res = await post(email, `198.51.100.${10 + i}`);
      answers.push({ status: res.status, body: await res.text(), ms: Date.now() - t0 });
    }
    for (const a of answers) {
      expect(a.status).toBe(200);
      expect(a.body).toBe(answers[0].body);
      expect(JSON.parse(a.body)).toEqual({ ok: true, code: "PI020" });
      expect(a.ms).toBeGreaterThanOrEqual(RESET_MIN_RESPONSE_MS - 5);
    }
    const ms = answers.map((a) => a.ms);
    expect(Math.max(...ms) - Math.min(...ms)).toBeLessThan(100); // 3-1: test tolerance ±100 ms
    // only the eligible patient got a token and NT-05
    const tokens = await prisma.authToken.findMany({ where: { account: { email: { contains: MARK } }, purpose: "PASSWORD_RESET" } });
    expect(tokens.map((t) => t.accountId)).toEqual([known.id]);
  });

  it("a malformed address is a field error (3-5), also after the minimum time", async () => {
    const t0 = Date.now();
    const res = await post("not-an-address");
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("PE002");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(RESET_MIN_RESPONSE_MS - 5);
  });

  it("rate limit: the 6th request for one address in 15 min → PE092, nothing written", async () => {
    const a = await account("ACTIVE");
    for (let i = 0; i < 5; i++) expect((await requestPasswordReset({ ip: IP, userAgent: null, email: a.email })).ok).toBe(true);
    const before = await prisma.authToken.count({ where: { accountId: a.id } });
    const notes = await prisma.notification.count({ where: { accountId: a.id } });
    const r = await requestPasswordReset({ ip: IP, userAgent: null, email: a.email });
    expect(r.ok ? "ok" : r.code).toBe("PE092");
    expect(await prisma.authToken.count({ where: { accountId: a.id } })).toBe(before);
    expect(await prisma.notification.count({ where: { accountId: a.id } })).toBe(notes);
  });

  it("a second request leaves the first token open (Q7 = A: P05 voids them all at use)", async () => {
    const a = await account("ACTIVE");
    await requestPasswordReset({ ip: IP, userAgent: null, email: a.email });
    await requestPasswordReset({ ip: IP, userAgent: null, email: a.email });
    expect(await prisma.authToken.count({ where: { accountId: a.id, usedAt: null } })).toBe(2);
  });
});

describe("P04 screen", () => {
  it("基: lead text, empty field, 送信する disabled, link back to P02; en / vi", () => {
    const html = renderToStaticMarkup(<ToastProvider lang="ja"><ForgotForm lang="ja" /></ToastProvider>);
    expect(html).toContain("パスワードの再設定");
    expect(html).toContain("ご登録のメールアドレスを入力してください。");
    expect(html).toMatch(/class="btn bdis bw" disabled="">送信する/);
    expect(html).toContain('href="/login"');
    expect(renderToStaticMarkup(<ToastProvider lang="vi"><ForgotForm lang="vi" /></ToastProvider>)).toContain("Gửi");
  });
});
