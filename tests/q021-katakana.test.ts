// Q-021 answer: one katakana set for patients and clinics (ァ…ヺ, ー, ・, space); half-width spaces are stored full-width.
import { validateDepartment } from "@/lib/admin/masters-rules";
import { checkPerson, fullWidthSpaces, katakanaOk, KATAKANA } from "@/lib/auth/validate";

const body = (over: Record<string, unknown> = {}) => ({
  nameType: "JP", familyName: "山田", givenName: "太郎", familyNameKana: "ヤマダ", givenNameKana: "タロウ", birthDate: "1990-01-01", sex: "1",
  postcode: "1000005", prefecture: "東京都", city: "千代田区", addressLine: "1-1", phone: "0312345678", ...over,
});

describe("Q-021 katakana set", () => {
  it("the same set for patients and clinics: ・ allowed, ヸ ヺ allowed, hiragana and latin refused", () => {
    for (const ok of ["ジョン・スミス", "ヴァン アン", "ヸ", "ヺ", "ヶ", "ヨーコ"]) {
      expect(katakanaOk(ok)).toBe(true);
      expect(KATAKANA.test(ok)).toBe(true);
    }
    for (const ng of ["やまだ", "Yamada", "ヤマダ1"]) expect(katakanaOk(ng)).toBe(false);
  });

  it("clinic / master kana (department) accepts ・ and ヺ", () => {
    const v = { code: "x", nameJa: "診療科", nameEn: "", nameVi: "", nameKana: "シンリョウ・カヺ", displayOrder: "1", offered: false, clinicOrder: "" };
    expect(validateDepartment(v, true).filter((e) => e.field === "nameKana")).toEqual([]);
  });

  it("half-width spaces are stored as full-width (patient kana)", () => {
    expect(fullWidthSpaces("ジョン スミス")).toBe("ジョン　スミス");
    const r = checkPerson(body({ familyNameKana: "ヤマ ダ・ニ", givenNameKana: "タロ ウ" }));
    expect(r?.errors).toEqual([]);
    expect(r?.input.familyNameKana).toBe("ヤマ　ダ・ニ");
    expect(r?.input.givenNameKana).toBe("タロ　ウ");
  });
});

describe("name length counts characters (judge W5 A-6)", () => {
  it("50 characters outside the BMP pass; 51 answer PE003", () => {
    expect(checkPerson(body({ familyName: "𠮷".repeat(50) }))?.errors).toEqual([]);
    expect(checkPerson(body({ familyName: "𠮷".repeat(51) }))?.errors).toEqual([{ field: "familyName", code: "PE003", params: { n: 50 } }]);
  });
});
