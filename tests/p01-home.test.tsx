// spec-screen: P01 — maintenance notice (抽出3, Q1, Q2), clinic cards and notices from the seed, render in ja / en / vi, keyword box.
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("@/lib/auth/context", () => ({ guardScreen: jest.fn(async () => null) }));
jest.mock("@/lib/frame/data", () => ({
  getLanguage: jest.fn(async () => "ja"),
  getSettings: jest.fn(async () => ({})),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("next/link", () => ({ __esModule: true, default: (p: { href: string; children: React.ReactNode; className?: string }) => <a href={p.href} className={p.className}>{p.children}</a> }));

import { guardScreen } from "@/lib/auth/context";
import { prisma, pool } from "@/lib/prisma";
import { Home } from "@/components/public/Home";
import { cutKeyword } from "@/components/public/HomeSearch";
import HomePage from "@/app/(patient)/page";
import { loadHome, maintenanceNotice } from "@/lib/public/home";

jest.setTimeout(60_000);
afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

describe("maintenance notice (item 1)", () => {
  const settings = { maintenance_from: "2026-11-03 02:00", maintenance_to: "2026-11-03T06:00" };
  const at = (iso: string) => new Date(iso);
  it("full date and time with year for both ends (Q1 A)", () =>
    expect(maintenanceNotice(settings, "ja", at("2026-10-30T00:00:00+09:00"))).toBe(
      "2026年11月3日(火) 2:00〜2026年11月3日(火) 6:00はメンテナンスのためご利用いただけません。",
    ));
  it("starts at exactly from − 7 × 24 h (Q2 a)", () => {
    expect(maintenanceNotice(settings, "ja", at("2026-10-27T02:00:00+09:00"))).not.toBeNull();
    expect(maintenanceNotice(settings, "ja", at("2026-10-27T01:59:59+09:00"))).toBeNull();
  });
  it("ends at maintenance_to", () => {
    expect(maintenanceNotice(settings, "ja", at("2026-11-03T06:00:00+09:00"))).not.toBeNull();
    expect(maintenanceNotice(settings, "ja", at("2026-11-03T06:00:01+09:00"))).toBeNull();
  });
  it("a key empty or not a date hides it, without an error (Q2 b)", () => {
    const now = at("2026-11-01T00:00:00+09:00");
    expect(maintenanceNotice({ ...settings, maintenance_to: "" }, "ja", now)).toBeNull();
    expect(maintenanceNotice({ ...settings, maintenance_from: "soon" }, "ja", now)).toBeNull();
    expect(maintenanceNotice({}, "ja", now)).toBeNull();
  });
  it("en / vi use their PI093 text", () => {
    const now = at("2026-11-01T00:00:00+09:00");
    expect(maintenanceNotice(settings, "en", now)).toMatch(/^The service will be unavailable for maintenance from .*2026.* to .*2026/);
    expect(maintenanceNotice(settings, "vi", now)).toMatch(/^Hệ thống sẽ tạm ngừng để bảo trì/);
  });
});

describe("keyword box (items 5, 6)", () => {
  it("a paste is cut at 50 characters counted after trimming", () => {
    expect(Array.from(cutKeyword("あ".repeat(60))).length).toBe(50);
    expect(cutKeyword("  " + "a".repeat(50) + "  ")).toBe("  " + "a".repeat(50) + "  "); // within 50 after trimming: untouched
    expect(cutKeyword("a".repeat(51))).toBe("a".repeat(50));
  });
});

describe("top page from the seed", () => {
  it("calls the guard first and draws it", async () => {
    await HomePage();
    expect(guardScreen).toHaveBeenCalledWith("P01");
  });

  it("cards in display order with hours / chips, notices by clinic, ja", async () => {
    const data = await loadHome("ja", new Date());
    expect(data.cards.map((c) => c.code)).toEqual(["honin", "ekimae", "nishiguchi"]);
    expect(data.cards[0].departments).toEqual(expect.arrayContaining(["内科"]));
    expect(data.notices.map((n) => n.code)).toContain("honin");
    const html = renderToStaticMarkup(<Home data={data} lang="ja" />);
    expect(html).toContain("24時間いつでもWeb予約");
    expect(html).toContain('placeholder="医師名・ふりがな・診療科"');
    expect(html).toContain("【○○クリニック 本院】");
    expect(html).toContain('href="/clinics/honin"');
    expect(html).toContain('href="tel:0312345678"');
    expect(html).toContain("03-1234-5678");
    expect(html).toContain("このクリニックの詳細");
    expect(html).not.toContain("〒");
  });

  it("no maintenance and no notice → the notice area is not drawn at all (state ③)", async () => {
    const data = await loadHome("ja");
    const html = renderToStaticMarkup(<Home data={{ ...data, maintenance: null, notices: [] }} lang="ja" />);
    expect(html).not.toContain("p01-notices");
  });

  it("closed today is a red 「本日は休診日です」 with the card otherwise as usual", async () => {
    const data = await loadHome("ja");
    const html = renderToStaticMarkup(<Home data={{ ...data, cards: data.cards.map((c) => ({ ...c, todayText: null })) }} lang="ja" />);
    expect(html).toContain("本日は休診日です");
    expect(html).toContain("このクリニックの詳細");
  });

  it("en and vi: UI-language masters, an empty text falls back to ja", async () => {
    const before = await prisma.clinic.findUniqueOrThrow({ where: { code: "ekimae" } });
    await prisma.clinic.update({ where: { code: "ekimae" }, data: { noticeVi: null } });
    const en = await loadHome("en");
    expect(en.cards[0].name).toBe("○○ Clinic Main");
    const enHtml = renderToStaticMarkup(<Home data={en} lang="en" />);
    expect(enHtml).toContain("Book an appointment");
    expect(enHtml).toContain("Leave the box empty to list all doctors.");
    const vi = await loadHome("vi");
    const viHtml = renderToStaticMarkup(<Home data={vi} lang="vi" />);
    expect(viHtml).toContain("Đặt lịch");
    expect(viHtml).toContain("Tìm bác sĩ");
    await prisma.clinic.update({ where: { code: "ekimae" }, data: { noticeVi: before.noticeVi } });
    if (before.noticeJa) expect(vi.notices.find((n) => n.code === "ekimae")?.text).toBe(before.noticeJa.replace(/\s*[\r\n]+\s*/g, " ").trim());
  });
});
