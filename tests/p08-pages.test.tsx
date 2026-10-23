// spec-screen: P08 — the page against the seed: guard, ER-02 on a tampered query, cards, carried query, no-result state, ja / en / vi.
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("@/lib/auth/context", () => ({ guardScreen: jest.fn(async () => null) }));
jest.mock("@/lib/frame/data", () => ({ getLanguage: jest.fn(async () => "ja") }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("next/link", () => ({ __esModule: true, default: (p: { href: string; children: React.ReactNode; className?: string }) => <a href={p.href} className={p.className}>{p.children}</a> }));

import { guardScreen } from "@/lib/auth/context";
import { getLanguage } from "@/lib/frame/data";
import { prisma, pool } from "@/lib/prisma";
import DoctorsPage from "@/app/(patient)/doctors/page";
import { DoctorResults } from "@/components/public/DoctorResults";
import { FinderShell, Pager } from "@/components/public/DoctorFinder";
import { EMPTY_QUERY, loadOptions, searchDoctors, type DoctorQuery } from "@/lib/public/doctors";
import type { Lang } from "@/lib/i18n";

jest.setTimeout(60_000);
afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

async function draw(q: Partial<DoctorQuery>, lang: Lang) {
  const options = await loadOptions(lang);
  const query = { ...EMPTY_QUERY, ...q };
  const result = await searchDoctors(query, lang);
  return renderToStaticMarkup(
    <FinderShell lang={lang} options={options} query={query}>
      <DoctorResults query={query} result={result} lang={lang} />
    </FinderShell>,
  );
}

describe("P08 page", () => {
  it("calls the guard first; a tampered query string is ER-02 (the page throws)", async () => {
    await expect(DoctorsPage({ searchParams: Promise.resolve({ page: "0" }) })).rejects.toThrow(/PE090/);
    await expect(DoctorsPage({ searchParams: Promise.resolve({ keyword: "あ".repeat(51) }) })).rejects.toThrow(/PE090/);
    expect(guardScreen).toHaveBeenCalledWith("P08");
    const ok = await DoctorsPage({ searchParams: Promise.resolve({ keyword: "田中", page: "9" }) });
    expect(ok).toBeTruthy();
  });

  it("ja: heading, labels, placeholder, count, card with the carried query, language codes, silhouette", async () => {
    const html = await draw({ keyword: "田中" }, "ja");
    expect(html).toContain("医師を探す");
    expect(html).toContain('placeholder="医師名・ふりがな・診療科"');
    expect(html).toContain("対応言語");
    expect(html).toContain("1件中 1〜1件を表示");
    expect(html).toMatch(/href="\/doctors\/[0-9a-f-]{36}\?from=keyword%3D%25E7%2594%25B0%25E4%25B8%25AD"/);
    expect(html).toContain("田中 誠");
    expect(html).toContain("院長");
    expect(html).toContain(">JA<");
    expect(html).toContain(">EN<");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("p08-pager"); // ≤ 12
  });

  it("no condition → no `from`; a photo is drawn as an img with the name as alt", async () => {
    const d = await prisma.doctor.findUniqueOrThrow({ where: { code: "D001" } });
    await prisma.doctor.update({ where: { code: "D001" }, data: { photoUrl: "/api/photos/d001.jpg" } });
    try {
      const html = await draw({}, "ja");
      expect(html).toMatch(/href="\/doctors\/[0-9a-f-]{36}"/);
      expect(html).toContain('<img src="/api/photos/d001.jpg" alt="田中 誠"');
    } finally {
      await prisma.doctor.update({ where: { code: "D001" }, data: { photoUrl: d.photoUrl } });
    }
  });

  it("state ②: PI031 with the two actions; count and cards hidden", async () => {
    const html = await draw({ keyword: "存在しない" }, "ja");
    expect(html).toContain("条件に合う医師が見つかりませんでした。条件を変えてお探しください。");
    expect(html).toContain('href="/clinics"');
    expect(html).toContain("クリニック案内を見る");
    expect(html).not.toContain("p08-count");
    expect(html).not.toContain("p08-cards");
  });

  it("page control: 前へ disabled on page 1, numbers with the current one not a link, 次へ disabled on the last page, 「1 / 3」 for mobile", () => {
    const first = renderToStaticMarkup(<Pager query={{ ...EMPTY_QUERY, clinic: "honin" }} page={1} pages={3} lang="ja" />);
    expect(first).toContain('aria-disabled="true">前へ');
    expect(first).toContain('href="/doctors?clinic=honin&amp;page=2"');
    expect(first).toContain('aria-current="page">1<');
    expect(first).toContain("1 / 3");
    const last = renderToStaticMarkup(<Pager query={EMPTY_QUERY} page={3} pages={3} lang="ja" />);
    expect(last).toContain('aria-disabled="true">次へ');
    expect(last).toContain('href="/doctors?page=2"');
    expect(last).toContain('href="/doctors"'); // page 1 omits the parameter
  });

  it("en: romaji names, UI-language masters; vi: labels (an empty en / vi master falls back to ja)", async () => {
    const en = await draw({ keyword: "tanaka" }, "en");
    expect(en).toContain("Makoto Tanaka");
    expect(en).toContain("Director");
    expect(en).toContain("Showing 1–1 of 1");
    expect(en).toContain("Languages spoken");
    const before = await prisma.department.findUniqueOrThrow({ where: { code: "naika" } });
    await prisma.department.update({ where: { code: "naika" }, data: { nameVi: null } });
    try {
      const vi = await draw({ keyword: "tanaka" }, "vi");
      expect(vi).toContain("Viện trưởng");
      expect(vi).toContain("Tìm bác sĩ");
      expect(vi).toContain(before.nameJa); // empty vi name → ja
      expect(vi).toContain("Hiển thị 1–1 trên 1");
    } finally {
      await prisma.department.update({ where: { code: "naika" }, data: { nameVi: before.nameVi } });
    }
    expect(getLanguage).toBeDefined();
  });
});
