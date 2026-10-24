// spec-screen: P10 — the screen against the seeded database: list state, one-clinic redirect, ER-01, closure list, render in ja / en / vi.
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("@/lib/auth/context", () => ({ guardScreen: jest.fn(async () => null) }));
jest.mock("@/lib/frame/data", () => ({ getLanguage: jest.fn(async () => "ja") }));
jest.mock("next/link", () => ({ __esModule: true, default: (p: { href: string; children: React.ReactNode; className?: string }) => <a href={p.href} className={p.className}>{p.children}</a> }));

import { guardScreen } from "@/lib/auth/context";
import { getLanguage } from "@/lib/frame/data";
import { prisma, pool } from "@/lib/prisma";
import { addDays, todayJst } from "@/lib/datetime";
import { loadClinicIndex, loadClinicPage } from "@/lib/public/p10";
import { ClinicDetail } from "@/components/public/ClinicDetail";
import { ClinicList } from "@/components/public/ClinicList";
import ClinicsPage from "@/app/(patient)/clinics/page";
import ClinicPage from "@/app/(patient)/clinics/[clinicCode]/page";

jest.setTimeout(60_000);
afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

/** the outcome of a Next interrupt thrown by a page */
async function outcome(fn: () => Promise<unknown>) {
  try {
    await fn();
    return "ok";
  } catch (e) {
    const d = (e as { digest?: string }).digest ?? "";
    if (d.startsWith("NEXT_REDIRECT")) return `redirect:${d.split(";")[2]}`;
    if (d.startsWith("NEXT_HTTP_ERROR_FALLBACK")) return `http:${d.split(";")[1]}`;
    throw e;
  }
}

describe("P10 clinic-list state", () => {
  it("calls the guard first and draws one card per active clinic in display order", async () => {
    const idx = await loadClinicIndex("ja");
    expect(idx.kind).toBe("list");
    if (idx.kind !== "list") return;
    expect(idx.cards.map((c) => c.code)).toEqual(["honin", "ekimae", "nishiguchi"]);
    expect(idx.cards[0]).toMatchObject({ name: "たなか内科クリニック 本院", address: "東京都千代田区丸の内1-2-3 丸の内中央ビル2階", phone: "0312345678" });
    const html = renderToStaticMarkup(<ClinicList cards={idx.cards} lang="ja" />);
    expect(html).toContain('href="/clinics/ekimae"');
    expect(html).toContain("03-1234-5678");
    expect(html).not.toContain("〒"); // the card has no postcode
    expect(html).toMatch(/本日 |本日は休診日です/);
    expect(await outcome(() => ClinicsPage())).toBe("ok");
    expect(guardScreen).toHaveBeenCalledWith("P10");
  });

  it("with exactly one active clinic the list is skipped; with none ER-01", async () => {
    await prisma.clinic.updateMany({ where: { code: { not: "ekimae" } }, data: { isActive: false } });
    try {
      expect(await loadClinicIndex("ja")).toEqual({ kind: "redirect", code: "ekimae" });
      expect(await outcome(() => ClinicsPage())).toBe("redirect:/clinics/ekimae");
      await prisma.clinic.updateMany({ data: { isActive: false } });
      expect(await outcome(() => ClinicsPage())).toBe("http:404");
    } finally {
      await prisma.clinic.updateMany({ data: { isActive: true } });
    }
  });
});

describe("P10 clinic page", () => {
  it.each(["nope", "HONIN", "ho nin", "../x", ""])("malformed or unknown code %p → ER-01", async (code) => {
    expect(await loadClinicPage(code, "ja")).toBeNull();
    expect(await outcome(() => ClinicPage({ params: Promise.resolve({ clinicCode: code }) }))).toBe("http:404");
  });

  it("an inactive clinic → ER-01", async () => {
    await prisma.clinic.update({ where: { code: "nishiguchi" }, data: { isActive: false } });
    try {
      expect(await loadClinicPage("nishiguchi", "ja")).toBeNull();
    } finally {
      await prisma.clinic.update({ where: { code: "nishiguchi" }, data: { isActive: true } });
    }
  });

  it("closure list: today … two months, calendar rows of the clinic only, ascending, a holiday is one row", async () => {
    const today = todayJst();
    const page = await loadClinicPage("honin", "ja");
    expect(page).not.toBeNull();
    const dates = page!.closures.map((c) => c.date);
    expect(dates).toEqual([...dates].sort());
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates).toEqual(expect.arrayContaining([addDays(today, 8), addDays(today, 9)]));
    expect(dates.every((d) => d >= today && d <= addDays(today, 62))).toBe(true);
    // the ekimae closure (today + 14) is not on the honin page
    expect(dates).not.toContain(addDays(today, 14));
    const eki = await loadClinicPage("ekimae", "ja");
    expect(eki!.closures.map((c) => c.date)).toContain(addDays(today, 14));
  });

  it("drawing: tabs, notice, phone, map link, hours, departments, doctors linking to P09, booking link with the clinic code", async () => {
    const page = await loadClinicPage("honin", "ja");
    const html = renderToStaticMarkup(<ClinicDetail data={page!} lang="ja" />);
    expect(html).toContain('href="/clinics/ekimae"');
    expect(html).toContain("院内研修のため臨時休診日があります");
    expect(html).toContain("〒100-0005 東京都千代田区丸の内1-2-3 丸の内中央ビル2階");
    expect(html).toContain('href="tel:0312345678"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("受付は午前 11:30、午後 17:30 まで（診療終了の30分前）");
    expect(html).toContain("午前 9:00〜12:00");
    expect(html).toContain('href="/booking/new?clinic=honin"');
    expect(html).toContain("田中 誠");
    expect(html).toContain("院長・内科");
    expect(html).toMatch(/href="\/doctors\/[0-9a-f-]{36}"/);
    // 本院: Wednesday and Saturday have no PM row
    expect(page!.hours.cell(3, "PM")).toEqual({ kind: "closed" });
  });

  it("Q-015: the title is shown for 院長 / 副院長 only; 非常勤医師 shows the departments alone", async () => {
    const tanaka = await prisma.doctor.findFirstOrThrow({ where: { title: "DIRECTOR", shiftPatterns: { some: { clinic: { code: "honin" } } } } });
    const subOf = async () => (await loadClinicPage("honin", "ja"))!.doctors.find((d) => d.id === tanaka.id)!.sub;
    expect(await subOf()).toBe("院長・内科");
    await prisma.doctor.update({ where: { id: tanaka.id }, data: { title: "PART_TIME" } });
    try {
      expect(await subOf()).toBe("内科");
    } finally {
      await prisma.doctor.update({ where: { id: tanaka.id }, data: { title: "DIRECTOR" } });
    }
  });

  it("no map url → the link is hidden; empty notice and closures → their areas change", async () => {
    const page = await loadClinicPage("ekimae", "ja");
    expect(page!.clinic.mapUrl).toBeNull();
    const html = renderToStaticMarkup(<ClinicDetail data={{ ...page!, closures: [], clinic: { ...page!.clinic, notice: "" } }} lang="ja" />);
    expect(html).not.toContain("地図を見る");
    expect(html).not.toContain("p10-notice");
    expect(html).toContain("予定されている休診日はありません");
  });

  it("en / vi: UI-language texts, an empty text falls back to ja", async () => {
    const before = await prisma.clinic.findUniqueOrThrow({ where: { code: "ekimae" } });
    await prisma.clinic.update({ where: { code: "ekimae" }, data: { accessVi: null } });
    const en = await loadClinicPage("honin", "en");
    expect(en!.clinic.name).toBe("Tanaka Clinic Main");
    expect(en!.clinic.address).toBe("2F Marunouchi Chuo Bldg., 1-2-3 Marunouchi, Chiyoda-ku, Tokyo");
    const enHtml = renderToStaticMarkup(<ClinicDetail data={en!} lang="en" />);
    expect(enHtml).toContain("Business hours");
    expect(enHtml).toContain("Makoto Tanaka");
    expect(enHtml).not.toContain("〒");
    const vi = await loadClinicPage("honin", "vi");
    expect(vi!.clinic.notice).toContain("đào tạo nhân viên");
    expect(vi!.clinic.access).toContain("Marunouchi");
    const eki = await loadClinicPage("ekimae", "vi");
    await prisma.clinic.update({ where: { code: "ekimae" }, data: { accessVi: before.accessVi } });
    expect(eki!.clinic.access).toContain("新宿駅"); // accessVi empty → ja
    expect(renderToStaticMarkup(<ClinicDetail data={vi!} lang="vi" />)).toContain("Giờ khám");
    expect(getLanguage).toBeDefined();
  });
});
