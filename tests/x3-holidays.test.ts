import { readFileSync } from "node:fs";
import { fetchHolidayFile, parseHolidayCsv, X3_HEADER, X3HttpError, X3ValidationError } from "@/lib/adapters/x3-holidays";
import { addDays, dbDate, jstInstant, todayJst, toHhmm, toIsoDate, weekdayOf, dbTime } from "@/lib/datetime";

const fixture = readFileSync("fixtures/x3/syukujitsu.csv");
// a test file = the fixture's Shift_JIS header line + ASCII rows
const sjisOf = (rows: string[]) => {
  const head = fixture.subarray(0, fixture.indexOf(0x0a) + 1);
  return Buffer.concat([head, Buffer.from(rows.map((r) => `${r}\r\n`).join(""), "ascii")]);
};

describe("X3 holiday CSV", () => {
  it("reads the fixture from the current year on, with 07 §4 names", () => {
    const rows = parseHolidayCsv(fixture, 2026);
    expect(rows[0]).toEqual({ date: "2026-01-01", nameJa: "元日", nameEn: "New Year's Day", nameVi: "Tết Dương lịch" });
    expect(rows.some((r) => r.date.startsWith("2025"))).toBe(false);
    expect(rows.find((r) => r.date === "2026-05-06")?.nameEn).toBe("Substitute holiday");
  });

  it("rejects the whole file on a broken rule (SE041)", () => {
    expect(() => parseHolidayCsv(Buffer.from("date,name\r\n2026/1/1,x\r\n"), 2026)).toThrow(X3ValidationError);
    expect(() => parseHolidayCsv(sjisOf(["2026/1/1,a", "2026/1/1,b", "2027/1/1,c"]), 2026)).toThrow(/duplicate/);
    expect(() => parseHolidayCsv(sjisOf(["2026/2/30,a", "2027/1/1,c"]), 2026)).toThrow(/invalid date/);
    expect(() => parseHolidayCsv(sjisOf(["2026/1/1,a"]), 2026)).toThrow(/no row for 2027/);
    expect(X3_HEADER).toContain("国民の祝日");
  });

  it("keeps an unknown name with en/vi null", () => {
    expect(parseHolidayCsv(sjisOf(["2026/8/1,new", "2027/1/1,c"]), 2026)[0]).toMatchObject({ nameEn: null, nameVi: null });
  });

  it("refuses a plain-http source (05 X3: HTTPS)", async () => {
    await expect(fetchHolidayFile("http://x.example/syukujitsu.csv")).rejects.toBeInstanceOf(X3HttpError);
  });
});

describe("JST date helpers", () => {
  it("map DATE / TIME values and today in Asia/Tokyo", () => {
    expect(toIsoDate(dbDate("2026-10-23"))).toBe("2026-10-23");
    expect(toHhmm(dbTime("09:30"))).toBe("09:30");
    expect(todayJst(new Date("2026-10-22T15:00:00Z"))).toBe("2026-10-23"); // 00:00 JST
    expect(todayJst(new Date("2026-10-22T14:59:59Z"))).toBe("2026-10-22");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekdayOf("2026-10-25")).toBe(0); // Sunday
    expect(jstInstant("2026-10-23", "09:00").toISOString()).toBe("2026-10-23T00:00:00.000Z");
  });
});
