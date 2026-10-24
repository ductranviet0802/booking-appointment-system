// spec-screen: P02 — access per screen of the slot (P02–P07, brief "Access per screen"), the guidance box (Q2), the
// staff-logout and reset flags, the form states. Login / lock / rate limit against the DB: tests/auth.test.ts.
import bcrypt from "bcrypt";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";

const mockJar: { sid?: string; path: string } = { path: "/" };
jest.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sid" && mockJar.sid ? { value: mockJar.sid } : undefined) }),
  headers: async () => ({ get: (n: string) => (n === "x-pathname" ? mockJar.path : null) }),
}));
jest.mock("next/navigation", () => ({
  ...jest.requireActual("next/navigation"),
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => "/login",
}));
jest.mock("next/link", () => ({ __esModule: true, default: (p: { href: string; children: React.ReactNode; className?: string }) => <a href={p.href} className={p.className}>{p.children}</a> }));
process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";

import { pool, prisma } from "@/lib/prisma";
import { guardScreen } from "@/lib/auth/context";
import type { ScreenId } from "@/lib/auth/context";
import { login } from "@/lib/auth/service";
import { resetAuthLimits } from "@/lib/auth/rate-limit";
import { SEED_PASSWORD } from "@/prisma/seed-accounts";
import { guidanceOf } from "@/lib/patient/login";
import { ToastProvider } from "@/components/ui/Toast";
import { LoginForm } from "@/components/patient/LoginForm";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";

jest.setTimeout(60_000);
const MARK = "p02test";
const client = { ip: "203.0.113.82", userAgent: "jest" };

async function outcome(screen: ScreenId, sid: string | undefined, path: string) {
  mockJar.sid = sid;
  mockJar.path = path;
  try {
    await guardScreen(screen);
    return "allow";
  } catch (e) {
    const d = (e as { digest?: string }).digest ?? "";
    if (d.startsWith("NEXT_REDIRECT")) return `redirect:${d.split(";")[2]}`;
    if (d.startsWith("NEXT_HTTP_ERROR_FALLBACK")) return `http:${d.split(";")[1]}`;
    throw e;
  }
}
async function sidOf(email: string) {
  const r = await login({ ...client, email, password: SEED_PASSWORD });
  if (!r.ok || !r.session) throw new Error(JSON.stringify(r));
  return r.session.token;
}

let patient = "", reception = "", firstChange = "";
beforeAll(async () => {
  resetAuthLimits();
  patient = await sidOf("yamada.taro@example.jp");
  reception = await sidOf("reception.honin@example.jp");
  firstChange = await sidOf("reception.firstlogin@example.jp");
});
afterAll(async () => {
  await prisma.session.deleteMany({ where: { ip: client.ip } });
  await prisma.auditLog.deleteMany({ where: { ip: client.ip } });
  await prisma.account.deleteMany({ where: { email: { contains: MARK } } });
  await prisma.$disconnect();
  await pool.end();
});

describe("access per screen (02 §2, reading 1)", () => {
  it("P02, P03, P04 with a patient session → /mypage; anonymous allowed", async () => {
    for (const [s, p] of [["P02", "/login"], ["P03", "/register"], ["P04", "/password/forgot"]] as const) {
      expect(await outcome(s, patient, p)).toBe("redirect:/mypage");
      expect(await outcome(s, undefined, p)).toBe("allow");
      expect(await outcome(s, reception, p)).toBe("redirect:/staff/ledger");
    }
    expect(await outcome("P02", firstChange, "/login")).toBe("redirect:/password/change"); // Q12
  });
  it("P05 token mode for anonymous and for any logged-in user", async () => {
    for (const sid of [undefined, patient, reception, firstChange]) expect(await outcome("P05", sid, "/password/reset?token=x")).toBe("allow");
  });
  it("P05 /password/change: flagged staff allowed, patient → /mypage, other staff → S01, anonymous → login guard", async () => {
    expect(await outcome("P05", firstChange, "/password/change")).toBe("allow");
    expect(await outcome("P05", patient, "/password/change")).toBe("redirect:/mypage");
    expect(await outcome("P05", reception, "/password/change")).toBe("redirect:/staff/ledger");
    expect(await outcome("P05", undefined, "/password/change")).toMatch(/^redirect:\/api\/auth\/guard\?next=/);
  });
  it("P06 / P07: anonymous → login guard with the target, staff → S01, patient allowed", async () => {
    for (const [s, p] of [["P06", "/mypage"], ["P07", "/mypage/family"]] as const) {
      expect(await outcome(s, undefined, p)).toBe(`redirect:/api/auth/guard?next=${encodeURIComponent(p)}`);
      expect(await outcome(s, reception, p)).toBe("redirect:/staff/ledger");
      expect(await outcome(s, patient, p)).toBe("allow");
    }
  });
});

describe("P02 box 1-1 (Q2)", () => {
  it("order PI021 → PI011 → PI014 (target P11) → PI010 (other target); none without arrival", () => {
    expect(guidanceOf("PI021", "/booking/new")).toBe("PI021");
    expect(guidanceOf("PI011", "/bookings")).toBe("PI011");
    expect(guidanceOf(null, "/booking/new?clinic=honin")).toBe("PI014");
    expect(guidanceOf(undefined, "/bookings")).toBe("PI010");
    expect(guidanceOf("PI002", null)).toBeNull();
    expect(guidanceOf(null, null)).toBeNull();
  });

  it("staff logout answers with the PI011 flag for P02; a patient logout does not", async () => {
    const req = (sid: string) => new NextRequest("http://localhost:3002/api/auth/logout", {
      method: "POST", headers: { origin: "http://localhost:3002", cookie: `sid=${sid}` },
    });
    const staff = await logoutRoute(req(await sidOf("reception.honin@example.jp")));
    expect(staff.headers.getSetCookie().join("\n")).toMatch(/flash=PI011;.*Max-Age=60/);
    const pat = await logoutRoute(req(await sidOf("yamada.taro@example.jp")));
    expect(pat.headers.getSetCookie().join("\n")).not.toContain("flash=");
  });
});

describe("P02 screen", () => {
  const render = (guidance: string | null, maintenance: string | null = null, lang: "ja" | "en" | "vi" = "ja") =>
    renderToStaticMarkup(<ToastProvider lang={lang}><LoginForm lang={lang} guidance={guidance} maintenance={maintenance} /></ToastProvider>);

  it("基: empty fields, button disabled, links to P04 / P03, staff note, no box", () => {
    const html = render(null);
    expect(html).not.toContain("p02-guidance");
    expect(html).toMatch(/class="btn bdis bw" disabled="">ログインする/);
    expect(html).toContain('href="/password/forgot"');
    expect(html).toContain('href="/register"');
    expect(html).toContain("スタッフの方も同じ画面からログインします。");
    expect(html).not.toContain("確認メールを再送する");
  });
  it("box texts of 04 and the maintenance banner", () => {
    expect(render("PI014")).toContain("予約を続けるにはログインしてください。");
    expect(render("PI010")).toContain("この画面をご利用いただくにはログインが必要です。");
    expect(render(null, "メンテナンス文")).toContain("メンテナンス文");
    expect(render("PI010", null, "vi")).toContain("Đăng nhập");
  });

  it("a PENDING account's login answers PE017 (the screen then offers 再送)", async () => {
    const email = `pending.${MARK}@example.jp`;
    await prisma.account.create({ data: { email, passwordHash: await bcrypt.hash("Pend1234", 4), role: "PATIENT", status: "PENDING" } });
    const r = await login({ ...client, email, password: "Pend1234" });
    expect(r.ok ? "ok" : r.code).toBe("PE017");
  });
});
