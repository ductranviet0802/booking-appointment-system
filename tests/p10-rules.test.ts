// spec-screen: P10 — pure rules: phone format (P10 Q6 A), today's hours (P10 Q1 / P01 抽出2), hours table (Q2, Q3), closure list (Q4).
import { formatPhone, telHref } from "@/lib/public/phone";
import { buildHoursTable, joinBands, openBandsOfDay, type HourRow } from "@/lib/public/hours";
import { addMonths, buildClosures } from "@/lib/public/closures";

describe("phone format", () => {
  it.each([
    ["0312345678", "03-1234-5678"],
    ["0612345678", "06-1234-5678"],
    ["09012345678", "090-1234-5678"],
    ["08012345678", "080-1234-5678"],
    ["07012345678", "070-1234-5678"],
    ["0451234567", "045-123-4567"],
    ["0120123456", "012-012-3456"],
    ["01201234567", "012-0123-4567"],
  ])("%s → %s", (digits, shown) => expect(formatPhone(digits)).toBe(shown));
  it("tel: href keeps digits only", () => {
    expect(telHref("0312345678")).toBe("tel:0312345678");
    expect(telHref("03-1234-5678")).toBe("tel:0312345678");
  });
  it("leaves a value that is not 10 / 11 digits as it is", () => expect(formatPhone("123")).toBe("123"));
});

const H = (weekday: number, band: "AM" | "PM", open: string, close: string, reception: string | null = null): HourRow => ({ weekday, band, open, close, reception });
const weekdayRows = [H(1, "AM", "09:00", "12:00", "11:30"), H(1, "PM", "15:00", "18:00", "17:30"), H(3, "AM", "09:00", "12:00", "11:30")];
const NO_CAL = null;

describe("today's hours (calendar exception first, then holiday, then weekday rows)", () => {
  const day = (o: Partial<Parameters<typeof openBandsOfDay>[0]> = {}) =>
    openBandsOfDay({ weekday: 1, hours: weekdayRows, calendar: NO_CAL, isHoliday: false, ...o });
  it("weekday rows, AM then PM", () => expect(joinBands(day(), "ja")).toBe("9:00〜12:00 / 15:00〜18:00"));
  it("en uses an en dash", () => expect(joinBands(day(), "en")).toBe("9:00–12:00 / 15:00–18:00"));
  it("a weekday without a band is open in the other band only", () => expect(day({ weekday: 3 })).toEqual([{ band: "AM", open: "09:00", close: "12:00" }]));
  it("a weekday without rows is closed", () => expect(day({ weekday: 2 })).toEqual([]));
  it("CLOSED closes the day", () => expect(day({ calendar: { kind: "CLOSED", amOpen: null, amClose: null, pmOpen: null, pmClose: null } })).toEqual([]));
  it("AM_CLOSED keeps the PM band with its regular hours", () =>
    expect(day({ calendar: { kind: "AM_CLOSED", amOpen: null, amClose: null, pmOpen: null, pmClose: null } })).toEqual([{ band: "PM", open: "15:00", close: "18:00" }]));
  it("PM_CLOSED keeps the AM band", () =>
    expect(day({ calendar: { kind: "PM_CLOSED", amOpen: null, amClose: null, pmOpen: null, pmClose: null } })).toEqual([{ band: "AM", open: "09:00", close: "12:00" }]));
  it("SPECIAL_OPEN uses the times of the row, also on a holiday and on a weekday without hours", () =>
    expect(day({ weekday: 0, isHoliday: true, calendar: { kind: "SPECIAL_OPEN", amOpen: "10:00", amClose: "12:00", pmOpen: null, pmClose: null } })).toEqual([
      { band: "AM", open: "10:00", close: "12:00" },
    ]));
  it("an active holiday without a calendar row is closed", () => expect(day({ isHoliday: true })).toEqual([]));
});

describe("hours table (items 8-1 … 8-3, 9)", () => {
  it("usual time = the most frequent pair, a tie goes to Monday", () => {
    const t = buildHoursTable([H(1, "AM", "09:00", "12:00"), H(2, "AM", "09:00", "12:00"), H(6, "AM", "09:00", "13:00")]);
    expect(t.bands).toEqual([{ band: "AM", open: "09:00", close: "12:00" }]);
    expect(t.cell(6, "AM")).toEqual({ kind: "own", open: "09:00", close: "13:00" });
    expect(t.cell(1, "AM")).toEqual({ kind: "usual" });
    expect(t.cell(3, "AM")).toEqual({ kind: "closed" });
    const tie = buildHoursTable([H(2, "AM", "10:00", "13:00"), H(1, "AM", "09:00", "12:00")]);
    expect(tie.bands[0].open).toBe("09:00");
  });
  it("a band without rows is omitted; no rows at all → every cell closed, no reception note", () => {
    const t = buildHoursTable([H(1, "AM", "09:00", "12:00")]);
    expect(t.bands.map((b) => b.band)).toEqual(["AM"]);
    expect(t.cell(1, "PM")).toEqual({ kind: "closed" });
    const none = buildHoursTable([]);
    expect(none.bands).toEqual([]);
    expect(none.cell(1, "AM")).toEqual({ kind: "closed" });
    expect(none.reception).toBeNull();
  });
  it("reception note per band with the minutes when equal; no minutes when they differ; a null band is left out", () => {
    const t = buildHoursTable(weekdayRows);
    expect(t.reception).toEqual({ items: [{ band: "AM", time: "11:30" }, { band: "PM", time: "17:30" }], minutesBefore: 30 });
    const diff = buildHoursTable([H(1, "AM", "09:00", "12:00", "11:30"), H(1, "PM", "15:00", "18:00", "17:45")]);
    expect(diff.reception?.minutesBefore).toBeNull();
    const nullPm = buildHoursTable([H(1, "AM", "09:00", "12:00", "11:30"), H(1, "PM", "15:00", "18:00", null)]);
    expect(nullPm.reception?.items).toEqual([{ band: "AM", time: "11:30" }]);
    expect(buildHoursTable([H(1, "AM", "09:00", "12:00", null)]).reception).toBeNull();
  });
});

describe("closure list", () => {
  const cal = (date: string, kind: "CLOSED" | "AM_CLOSED" | "PM_CLOSED" | "SPECIAL_OPEN", extra = {}) => ({
    date, kind, amOpen: null, amClose: null, pmOpen: null, pmClose: null, noteJa: null, noteEn: null, noteVi: null, ...extra,
  });
  const base = { from: "2026-10-23", to: "2026-12-23", holidays: [], lang: "ja" as const };
  it("two calendar months, clamped at the month end", () => {
    expect(addMonths("2026-10-23", 2)).toBe("2026-12-23");
    expect(addMonths("2026-12-31", 2)).toBe("2027-02-28");
    expect(addMonths("2027-12-31", 2)).toBe("2028-02-29");
  });
  it("badges and fallback texts of the kinds, ascending by date, both range ends included", () => {
    const rows = buildClosures({
      ...base,
      calendar: [cal("2026-12-23", "AM_CLOSED"), cal("2026-10-23", "CLOSED", { noteJa: "研修" }), cal("2026-11-02", "PM_CLOSED"), cal("2026-12-24", "CLOSED")],
    });
    expect(rows.map((r) => r.date)).toEqual(["2026-10-23", "2026-11-02", "2026-12-23"]);
    expect(rows.map((r) => [r.badge, r.content])).toEqual([["臨時休診", "研修"], ["午前のみ", "午後休診"], ["午後のみ", "午前休診"]]);
  });
  it("a holiday is one row 「休診」 with 「・祝」; a calendar row on a holiday is one row keeping 「・祝」; SPECIAL_OPEN shows the times", () => {
    const rows = buildClosures({
      ...base,
      calendar: [
        cal("2026-11-23", "SPECIAL_OPEN", { amOpen: "09:00", amClose: "12:00", noteJa: "午前のみ診療" }),
        cal("2026-11-03", "CLOSED"),
      ],
      holidays: [
        { date: "2026-11-03", nameJa: "文化の日", nameEn: "Culture Day", nameVi: null },
        { date: "2026-11-23", nameJa: "勤労感謝の日", nameEn: null, nameVi: null },
        { date: "2026-11-24", nameJa: "休日", nameEn: null, nameVi: null },
      ],
    });
    expect(rows.map((r) => r.dateText)).toEqual(["11月3日(火・祝)", "11月23日(月・祝)", "11月24日(火・祝)"]);
    expect(rows[0]).toMatchObject({ badge: "臨時休診", content: "" });
    expect(rows[1]).toMatchObject({ badge: "臨時診療", kind: "special", content: "9:00〜12:00 午前のみ診療" });
    expect(rows[2]).toMatchObject({ badge: "休診", content: "休日" });
  });
  it("en / vi: note and holiday name fall back to ja", () => {
    const rows = buildClosures({
      ...base, lang: "vi",
      calendar: [cal("2026-10-30", "CLOSED", { noteJa: "点検", noteEn: "Check" })],
      holidays: [{ date: "2026-11-03", nameJa: "文化の日", nameEn: "Culture Day", nameVi: null }],
    });
    expect(rows.map((r) => r.content)).toEqual(["点検", "文化の日"]);
  });
  it("empty list", () => expect(buildClosures({ ...base, calendar: [] })).toEqual([]));
});
