// Shared date picker (components/ui/DatePicker): month rows per language, text parsing, keys, and the grid markup
// (one Tab stop, disabled dates outside the bounds, markers, selection).
import { renderToStaticMarkup } from "react-dom/server";
import { DateField, MonthGrid, monthCells, parseDateText, stepOf } from "@/components/ui/DatePicker";

describe("date picker helpers", () => {
  it("month rows start on Sunday (ja / en) or Monday (vi)", () => {
    const sun = monthCells("2026-10", 0); // 2026-10-01 is a Thursday
    expect(sun.slice(0, 5)).toEqual([null, null, null, null, "2026-10-01"]);
    expect(sun).toHaveLength(4 + 31);
    expect(monthCells("2026-10", 1).slice(0, 4)).toEqual([null, null, null, "2026-10-01"]);
    expect(monthCells("2028-02", 0).filter(Boolean)).toHaveLength(29);
  });

  it("parses YYYY/MM/DD, YYYY-MM-DD and full-width digits; refuses impossible dates", () => {
    expect(parseDateText("2026/10/24")).toBe("2026-10-24");
    expect(parseDateText(" 2026-1-5 ")).toBe("2026-01-05");
    expect(parseDateText("２０２６／１０／２４")).toBe("2026-10-24");
    expect(parseDateText("2026/02/30")).toBeNull();
    expect(parseDateText("20261024")).toBeNull();
  });

  it("arrow keys move by a day or a week", () => {
    expect([stepOf("ArrowLeft"), stepOf("ArrowRight"), stepOf("ArrowUp"), stepOf("ArrowDown"), stepOf("a")]).toEqual([-1, 1, -7, 7, null]);
  });
});

describe("MonthGrid / DateField markup", () => {
  const grid = (o: Partial<Parameters<typeof MonthGrid>[0]> = {}) =>
    renderToStaticMarkup(
      <MonthGrid month="2026-10" onMonth={() => {}} selected="2026-10-24" onPick={() => {}} lang="ja" ariaLabel="日付" min="2026-10-10" max="2026-10-28" {...o} />,
    );

  it("the grid is the only Tab stop of the month; days are tabindex -1 and bounded", () => {
    const html = grid();
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain('role="grid"');
    expect(html).toMatch(/aria-label="2026年10月9日\(金\)"[^>]*disabled=""|disabled=""[^>]*aria-label="2026年10月9日\(金\)"/);
    expect(html).toMatch(/aria-selected="true"[^>]*aria-label="2026年10月24日\(土\)"/);
    expect(html).toContain("2026年10月");
  });

  it("markers and extra disabled dates (P11)", () => {
    const html = grid({ mark: (iso) => (iso === "2026-10-20" ? "△" : "○"), isDisabled: (iso) => iso === "2026-10-21", lang: "en" });
    expect(html).toContain("△");
    expect(html).toContain("October 2026");
    expect(html).toMatch(/disabled=""[^>]*aria-label="Wed, 21 Oct 2026"|aria-label="Wed, 21 Oct 2026"[^>]*disabled=""/);
  });

  it("DateField: a text box with the YYYY/MM/DD placeholder and a calendar button, closed at first", () => {
    const html = renderToStaticMarkup(<DateField id="d" value="2026/10/24" onChange={() => {}} lang="ja" ariaLabel="開始日" />);
    expect(html).toContain('placeholder="YYYY/MM/DD"');
    expect(html).toContain('aria-label="カレンダーから選ぶ"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="grid"');
  });
});
