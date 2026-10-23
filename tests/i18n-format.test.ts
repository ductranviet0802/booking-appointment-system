import { LANGS, messageIds, t } from "@/lib/i18n";
import {
  firstWeekday,
  formatDate,
  formatDateShort,
  formatDateTime,
  formatMonthHeading,
  formatPrice,
  formatTimeRange,
} from "@/lib/i18n/format";
import { resolveLanguage } from "@/lib/frame/data";
import { maintenanceEnd, pickGroupName } from "@/lib/frame/settings";
import { trimSpaces } from "@/lib/forms";
import type { SessionContext } from "@/lib/auth/context";

const asSession = (role: string, language: string) => ({ account: { role, language } }) as unknown as SessionContext;

describe("F13-04 formats", () => {
  it("full and short date", () => {
    expect(formatDate("2026-10-20", "ja")).toBe("2026年10月20日(火)");
    expect(formatDate("2026-10-20", "en")).toBe("Tue, 20 Oct 2026");
    expect(formatDate("2026-10-20", "vi")).toBe("Thứ Ba, 20/10/2026");
    expect(formatDateShort("2026-10-20", "ja")).toBe("10月20日(火)");
    expect(formatDateShort("2026-10-20", "en")).toBe("Tue, 20 Oct");
    expect(formatDateShort("2026-10-20", "vi")).toBe("Thứ Ba, 20/10");
  });
  it("month heading, time range, price, first weekday", () => {
    expect(formatMonthHeading(2026, 10, "ja")).toBe("2026年10月");
    expect(formatMonthHeading(2026, 10, "en")).toBe("October 2026");
    expect(formatMonthHeading(2026, 10, "vi")).toBe("Tháng 10/2026");
    expect(formatTimeRange("09:00", "09:30", "ja")).toBe("9:00〜9:30");
    expect(formatTimeRange("09:00", "09:30", "en")).toBe("9:00–9:30");
    expect(formatPrice(4000, "ja")).toBe("4,000円");
    expect(formatPrice(4000, "en")).toBe("¥4,000");
    expect(formatPrice(4000, "vi")).toBe("4.000 yên");
    expect(firstWeekday("vi")).toBe(1);
    expect(firstWeekday("en")).toBe(0);
  });
  it("formats an instant in Asia/Tokyo", () => {
    expect(formatDateTime(new Date("2026-10-20T21:00:00Z"), "ja")).toBe("2026年10月21日(水) 6:00");
  });
});

describe("message catalog", () => {
  // counts follow 04 §7
  const ids = messageIds();
  const count = (p: string) => ids.filter((i) => i.startsWith(p)).length;

  it("has every id counted in 04 §7", () => {
    expect([count("PE"), count("PW"), count("PI")]).toEqual([44, 6, 41]);
    expect([count("SE"), count("SW"), count("SI")]).toEqual([34, 14, 30]);
    expect(ids).toHaveLength(169);
  });
  it("has ja / en / vi for every patient id, with no empty text", () => {
    for (const id of ids.filter((i) => /^P[EWI]/.test(i))) {
      for (const l of LANGS) expect(t(id, l)).not.toBe("");
      expect(t(id, "en")).not.toBe(t(id, "ja"));
      expect(t(id, "vi")).not.toBe(t(id, "ja"));
    }
  });
  it("fills placeholders and keeps staff ids ja", () => {
    expect(t("SW012", "en", { n: 3 })).toBe(t("SW012", "ja", { n: 3 }));
    expect(t("SW012", "ja", { n: 3 })).toContain("3件");
  });
});

describe("language and frame rules", () => {
  it("F13-01 language resolution", () => {
    expect(resolveLanguage(asSession("PATIENT", "EN"), "vi")).toBe("en");
    expect(resolveLanguage(asSession("ADMIN", "EN"), "vi")).toBe("ja");
    expect(resolveLanguage(null, "vi")).toBe("vi");
    expect(resolveLanguage(null, "xx")).toBe("ja");
    expect(resolveLanguage(null, undefined)).toBe("ja");
  });
  it("group name falls back to ja", () => {
    expect(pickGroupName({ group_name_ja: "A", group_name_en: "" }, "en")).toBe("A");
    expect(pickGroupName({ group_name_ja: "A", group_name_en: "B" }, "en")).toBe("B");
  });
  it("ER-04 only while both values are set and now is inside", () => {
    const s = { maintenance_from: "2026-10-21 01:00", maintenance_to: "2026-10-21 06:00" };
    expect(maintenanceEnd(s, new Date("2026-10-20T17:00:00Z"))).toEqual(new Date("2026-10-20T21:00:00Z"));
    expect(maintenanceEnd(s, new Date("2026-10-20T21:00:00Z"))).toBeNull();
    expect(maintenanceEnd({ maintenance_from: s.maintenance_from }, new Date("2026-10-20T17:00:00Z"))).toBeNull();
  });
  it("trims half and full width spaces (F17-05)", () => {
    expect(trimSpaces(" 　山田 　")).toBe("山田");
  });
});
