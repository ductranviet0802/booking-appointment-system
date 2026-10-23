// spec-screen: P08 — keyword normalisation, conditions, order, paging, server re-check of the query string.
import { prisma, pool } from "@/lib/prisma";
import { addDays, dbDate, todayJst } from "@/lib/datetime";
import { EMPTY_QUERY, departmentsFor, doctorQueryString, loadOptions, parseDoctorQuery, searchDoctors, type DoctorQuery } from "@/lib/public/doctors";
import { clampKeyword, keywordWords, matchesKeyword, normalizeText, trimKeyword } from "@/lib/public/keyword";

jest.setTimeout(60_000);
afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

describe("keyword rules (F12-02)", () => {
  it("NFKC width, hiragana ↔ katakana, case", () => {
    expect(normalizeText("ＡＢＣ１２")).toBe("abc12");
    expect(normalizeText("たなか")).toBe("タナカ");
    expect(normalizeText("ﾀﾅｶ")).toBe("タナカ");
    expect(normalizeText("Tanaka")).toBe("tanaka");
  });
  it("trims half- and full-width spaces; spaces only = empty", () => {
    expect(trimKeyword("　 田中 　")).toBe("田中");
    expect(trimKeyword(" 　 ")).toBe("");
    expect(keywordWords(" 　 ")).toEqual([]);
  });
  it("a full-width space separates words", () => expect(keywordWords("田中　誠")).toEqual(["田中", "誠"]));
  it("every word must match some field (AND), substring", () => {
    const fields = ["田中", "誠", "タナカ", "マコト", "Makoto Tanaka", "内科", "ナイカ"];
    expect(matchesKeyword(keywordWords("たな まこ"), fields)).toBe(true);
    expect(matchesKeyword(keywordWords("田中 高橋"), fields)).toBe(false);
    expect(matchesKeyword([], fields)).toBe(true);
  });
  it("clampKeyword cuts at 50 after trimming", () => {
    expect(clampKeyword("  " + "あ".repeat(60))).toBe("あ".repeat(50));
  });
});

const codes = async (q: Partial<DoctorQuery>, now?: Date) => {
  const r = await searchDoctors({ ...EMPTY_QUERY, ...q }, "ja", now);
  const ids = await prisma.doctor.findMany({ where: { id: { in: r.cards.map((c) => c.id) } }, select: { id: true, code: true } });
  return r.cards.map((c) => ids.find((i) => i.id === c.id)?.code);
};

describe("conditions on the seeded doctors", () => {
  it("no condition: all active doctors in display order, 12 per page", async () => {
    const r = await searchDoctors(EMPTY_QUERY, "ja");
    expect(r).toMatchObject({ total: 7, pages: 1, page: 1, from: 1, to: 7 });
    expect(await codes({})).toEqual(["D001", "D002", "D003", "D004", "D005", "D006", "D007"]);
  });
  it("keyword: kanji, hiragana kana, romaji case-insensitive, department in ja / en", async () => {
    expect(await codes({ keyword: "田中" })).toEqual(["D001"]);
    expect(await codes({ keyword: "たなか" })).toEqual(["D001"]);
    expect(await codes({ keyword: "TANAKA" })).toEqual(["D001"]);
    expect(await codes({ keyword: "田中 誠" })).toEqual(["D001"]);
    expect(await codes({ keyword: "田中 高橋" })).toEqual([]);
    expect(await codes({ keyword: "皮膚科" })).toEqual(["D005", "D006"]);
    expect(await codes({ keyword: "田中 内科" })).toEqual(["D001"]);
    const dept = await prisma.department.findUniqueOrThrow({ where: { code: "hifuka" } });
    expect(await codes({ keyword: (dept.nameEn ?? "").toUpperCase() })).toEqual(["D005", "D006"]);
  });
  it("clinic: via shift patterns (not the primary clinic)", async () => {
    expect(await codes({ clinic: "ekimae" })).toEqual(["D002", "D005", "D007"]);
    expect(await codes({ clinic: "honin" })).toEqual(["D001", "D002", "D003", "D004", "D006"]);
  });
  it("department, language, and AND of all conditions", async () => {
    expect(await codes({ department: "hifuka" })).toEqual(["D005", "D006"]);
    expect(await codes({ language: "vi" })).toEqual(["D006"]);
    expect(await codes({ language: "en" })).toEqual(["D001", "D005", "D007"]);
    expect(await codes({ clinic: "ekimae", department: "naika", language: "en" })).toEqual(["D007"]);
  });
  it("an inactive doctor is not found", async () => {
    await prisma.doctor.update({ where: { code: "D001" }, data: { isActive: false } });
    try {
      expect(await codes({})).not.toContain("D001");
      expect((await loadOptions("ja")).languages).toEqual(["ja", "en", "vi"]);
    } finally {
      await prisma.doctor.update({ where: { code: "D001" }, data: { isActive: true } });
    }
  });
});

describe("order and paging", () => {
  const prefix = "T9";
  let primaryClinicId = "";
  let deptId = "";
  beforeAll(async () => {
    primaryClinicId = (await prisma.clinic.findUniqueOrThrow({ where: { code: "honin" } })).id;
    deptId = (await prisma.department.findUniqueOrThrow({ where: { code: "naika" } })).id;
    // 14 doctors on display_order 100: T901 / T902 share a reading (tie → code), the rest ascend by reading
    for (let i = 1; i <= 14; i++) {
      const kana = i <= 2 ? "アアア" : `ア${String.fromCharCode(0x30a1 + i)}`;
      const n = String(i).padStart(2, "0");
      const d = await prisma.doctor.create({
        data: {
          code: `${prefix}${n}`, familyName: "試験", givenName: n, familyNameKana: kana, givenNameKana: "テスト", nameRomaji: `Test ${n}`,
          title: "DOCTOR", profileJa: "x", primaryClinicId, displayOrder: 100,
          departments: { create: { departmentId: deptId } },
        },
      });
      // T914 had a pattern that ended yesterday: not "valid today"
      await prisma.doctorShiftPattern.create({
        data: {
          doctorId: d.id, clinicId: primaryClinicId, departmentId: deptId, weekday: 3, band: "AM", startTime: new Date("1970-01-01T09:00:00Z"), endTime: new Date("1970-01-01T12:00:00Z"),
          validFrom: dbDate(addDays(todayJst(), -60)), validTo: i === 14 ? dbDate(addDays(todayJst(), -1)) : null,
        },
      });
    }
  });
  afterAll(async () => {
    await prisma.doctorShiftPattern.deleteMany({ where: { doctor: { code: { startsWith: prefix } } } });
    await prisma.doctor.deleteMany({ where: { code: { startsWith: prefix } } });
  });

  it("display_order, then reading, then code; 12 per page; count range", async () => {
    const p1 = await searchDoctors(EMPTY_QUERY, "ja");
    expect(p1).toMatchObject({ total: 21, pages: 2, page: 1, from: 1, to: 12 });
    expect(p1.cards).toHaveLength(12);
    const p2 = await searchDoctors({ ...EMPTY_QUERY, page: 2 }, "ja");
    expect(p2).toMatchObject({ page: 2, from: 13, to: 21 });
    expect(p2.cards).toHaveLength(9);
    const order = await codes({ keyword: "試験" });
    expect(order.slice(0, 2)).toEqual(["T901", "T902"]);
    expect(order.slice(0, 12)).toEqual(order.slice(0, 12).slice().sort((a, b) => (a! < b! ? -1 : 1)));
  });
  it("a page beyond the last page shows the last page (Q5 A, 質疑 Q-012)", async () => {
    const r = await searchDoctors({ ...EMPTY_QUERY, page: 99 }, "ja");
    expect(r).toMatchObject({ page: 2, from: 13, to: 21 });
  });
  it("total 0 with any page → no cards", async () => {
    const r = await searchDoctors({ ...EMPTY_QUERY, keyword: "存在しない名前", page: 5 }, "ja");
    expect(r).toMatchObject({ total: 0, cards: [] });
  });
  it("a shift pattern that ended yesterday does not count for the clinic condition", async () => {
    expect(await codes({ clinic: "honin", keyword: "試験 13" })).toEqual(["T913"]);
    expect(await codes({ clinic: "honin", keyword: "試験 14" })).toEqual([]);
    expect(await codes({ keyword: "試験 14" })).toEqual(["T914"]);
  });
});

describe("server re-check of the query string (4.2 rows 3–5)", () => {
  let options: Awaited<ReturnType<typeof loadOptions>>;
  beforeAll(async () => {
    options = await loadOptions("ja");
  });
  const parse = (raw: Record<string, string | string[] | undefined>) => parseDoctorQuery(raw, options);
  it("no parameters → the default state", () => expect(parse({})).toEqual(EMPTY_QUERY));
  it("valid values and the trimmed keyword", () =>
    expect(parse({ keyword: " 田中 ", clinic: "honin", department: "naika", language: "en", page: "2" })).toEqual({
      keyword: "田中", clinic: "honin", department: "naika", language: "en", page: 2,
    }));
  it("spaces only = no keyword; 50 characters pass, 51 are ER-02 (counted after trimming)", () => {
    expect(parse({ keyword: " 　 " })?.keyword).toBe("");
    expect(parse({ keyword: " " + "あ".repeat(50) + " " })).not.toBeNull();
    expect(parse({ keyword: "あ".repeat(51) })).toBeNull();
  });
  it.each([
    [{ clinic: "nope" }], [{ clinic: "" }], [{ department: "nope" }], [{ language: "zz" }], [{ language: "" }],
    [{ page: "0" }], [{ page: "-1" }], [{ page: "1.5" }], [{ page: "abc" }], [{ page: "" }], [{ clinic: ["honin", "ekimae"] }],
  ])("%j → ER-02", (raw) => expect(parse(raw)).toBeNull());
  it("an inactive clinic is no option", async () => {
    await prisma.clinic.update({ where: { code: "nishiguchi" }, data: { isActive: false } });
    try {
      expect(parseDoctorQuery({ clinic: "nishiguchi" }, await loadOptions("ja"))).toBeNull();
    } finally {
      await prisma.clinic.update({ where: { code: "nishiguchi" }, data: { isActive: true } });
    }
  });
  it("query string: parameters left out when empty / page 1", () => {
    expect(doctorQueryString(EMPTY_QUERY)).toBe("");
    expect(doctorQueryString({ keyword: "田中", page: 2 })).toBe("keyword=%E7%94%B0%E4%B8%AD&page=2");
  });
  it("department options narrow to the chosen clinic; all without one", () => {
    const all = departmentsFor(options, "").map((d) => d.code);
    expect(all).toEqual(expect.arrayContaining(["naika", "shonika", "hifuka"]));
    expect(departmentsFor(options, "honin").map((d) => d.code).every((c) => all.includes(c))).toBe(true);
  });
});
