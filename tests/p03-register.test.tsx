// spec-screen: P03 — S-02 person rules (one test per rule, accept and refuse), the server re-check of register(), the
// page states. Registration / verification / resend against the DB: tests/auth.test.ts.
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }), usePathname: () => "/register" }));
jest.mock("next/link", () => ({ __esModule: true, default: (p: { href: string; children: React.ReactNode; className?: string }) => <a href={p.href} className={p.className}>{p.children}</a> }));

import { ToastProvider } from "@/components/ui/Toast";
import { RegisterForm } from "@/components/patient/RegisterForm";
import {
  birthDateOk, checkPerson, checkRegistration, katakanaOk, phoneOk, postcodeOk, romajiNameOk, digitsOnly,
} from "@/lib/auth/validate";
import type { Lang } from "@/lib/i18n";

const NOW = new Date("2026-10-24T03:00:00Z"); // 12:00 JST
const person = {
  nameType: "JP", familyName: "山田", givenName: "花子", familyNameKana: "ヤマダ", givenNameKana: "ハナコ", birthDate: "1985-04-12",
  sex: "2", postcode: "100-0005", prefecture: "東京都", city: "千代田区", addressLine: "1-2-3", phone: "090-1234-5678",
};
const codes = (body: Record<string, unknown>, phoneRequired = true) => {
  const r = checkPerson(body, NOW, phoneRequired);
  if (!r) return "TAMPERED";
  return r.errors.map((e) => `${e.field}:${e.code}`).join(",");
};

describe("S-02 rules (P03 §4.1 / §4.2, shared by P06 / P07)", () => {
  it("romaji names: A–Z a–z space hyphen apostrophe only", () => {
    for (const ok of ["Smith", "O'Brien", "Van An", "Jean-Luc"]) expect(romajiNameOk(ok)).toBe(true);
    for (const bad of ["Nguyễn", "山田", "Smith1", "Ｓｍｉｔｈ", "Anne.", "José"]) expect(romajiNameOk(bad)).toBe(false);
  });
  it("katakana reading: full-width katakana, ー, full- or half-width space only", () => {
    for (const ok of ["ヤマダ", "ヴァン　アン", "ジョン スミス", "ヨーコ", "ヶ"]) expect(katakanaOk(ok)).toBe(true);
    for (const bad of ["やまだ", "ﾔﾏﾀﾞ", "山田", "Yamada", "ヤマダ1"]) expect(katakanaOk(bad)).toBe(false);
    expect(katakanaOk("マリア・テレサ")).toBe(true); // Q-021 answer: ・ allowed
  });
  it("birth date: a real date 1900-01-01 … today JST", () => {
    expect(birthDateOk("1900-01-01", NOW)).toBe(true);
    expect(birthDateOk("2026-10-24", NOW)).toBe(true);
    for (const bad of ["1899-12-31", "2026-10-25", "2026-02-30", "2026-2-3", ""]) expect(birthDateOk(bad, NOW)).toBe(false);
  });
  it("postcode 7 digits and phone 10–11 digits after normalisation (hyphens, full-width digits)", () => {
    expect(postcodeOk(digitsOnly("１００－０００５"))).toBe(true);
    expect(postcodeOk(digitsOnly("100-005"))).toBe(false);
    expect(phoneOk(digitsOnly("03-1234-5678"))).toBe(true);
    expect(phoneOk(digitsOnly("０９０１２３４５６７８"))).toBe(true);
    expect(phoneOk(digitsOnly("090-123-45"))).toBe(false);
    expect(phoneOk(digitsOnly("090123456789"))).toBe(false);
  });

  it("JP name type: names free, kana checked (PE009); ROMAJI: names checked (PE016), kana free", () => {
    expect(codes(person)).toBe("");
    expect(codes({ ...person, familyNameKana: "やまだ" })).toBe("familyNameKana:PE009");
    expect(codes({ ...person, nameType: "ROMAJI" })).toBe("familyName:PE016,givenName:PE016");
    expect(codes({ ...person, nameType: "ROMAJI", familyName: "Yamada", givenName: "Hanako", familyNameKana: "やまだ" })).toBe("");
  });
  it("required / length: spaces only = empty (PE001), > 50 → PE003 before the character rule", () => {
    expect(codes({ ...person, familyName: "　 " })).toBe("familyName:PE001");
    expect(codes({ ...person, givenNameKana: "ア".repeat(51) })).toBe("givenNameKana:PE003");
    expect(codes({ ...person, city: "x".repeat(51), addressLine: "", building: "b".repeat(101), town: "t".repeat(101) }))
      .toBe("city:PE003,town:PE003,addressLine:PE001,building:PE003");
    expect(codes({ ...person, birthDate: "", sex: "", postcode: "", prefecture: "", phone: "" }))
      .toBe("birthDate:PE001,sex:PE001,postcode:PE001,prefecture:PE001,phone:PE001");
    expect(codes({ ...person, postcode: "12345", phone: "12", birthDate: "2027-01-01" })).toBe("birthDate:PE014,postcode:PE002,phone:PE015");
  });
  it("phone optional for a family member (P07), still PE015 when filled", () => {
    expect(codes({ ...person, phone: "" }, false)).toBe("");
    expect(codes({ ...person, phone: "123" }, false)).toBe("phone:PE015");
  });
  it("values the UI cannot produce → tampered (ER-02, nothing written)", () => {
    for (const bad of [{ nameType: "KANJI" }, { sex: "3" }, { prefecture: "火星" }]) expect(codes({ ...person, ...bad })).toBe("TAMPERED");
  });
  it("normalised values are what is stored: digits only, null for empty optional fields", () => {
    const r = checkPerson({ ...person, town: " ", building: "" }, NOW)!;
    expect(r.input).toMatchObject({ postcode: "1000005", phone: "09012345678", town: null, building: null, sex: "FEMALE" });
  });
  it("registration adds e-mail, password and consents to the person rules", () => {
    const r = checkRegistration({ ...person, email: "a@b", password: "short", passwordConfirm: "x", agreeTerms: true }, NOW);
    expect(r.tampered).toBe(false);
    if (!r.tampered) expect(r.errors.map((e) => `${e.field}:${e.code}`)).toEqual(["email:PE002", "password:PE006", "passwordConfirm:PE007", "agreePrivacy:PE008"]);
  });
});

describe("P03 screen", () => {
  const render = (lang: Lang, resend = false) => renderToStaticMarkup(
    <ToastProvider lang={lang}>
      <RegisterForm lang={lang} terms={{ version: "1.0", url: "https://example.jp/terms" }} privacy={{ version: "1.0", url: "https://example.jp/privacy" }} resend={resend} />
    </ToastProvider>,
  );

  it("基: empty form, 日本語氏名 preset in ja, consents unchecked, 登録する disabled, links to the documents in a new tab", () => {
    const html = render("ja");
    expect(html).toContain("会員登録");
    expect(html).toContain("ご本人の情報を登録します。ご家族は登録後にマイページから追加できます。");
    expect(html).toMatch(/checked="" value="JP"/);
    expect(html).toContain("フリガナは全角カタカナで入力してください。");
    expect(html).toMatch(/<button type="submit" class="btn bdis bw" disabled="">登録する<\/button>/);
    expect(html).toContain('href="https://example.jp/terms" target="_blank"');
    expect(html).not.toMatch(/type="checkbox" checked=""/);
    expect(html).toContain('href="/login"');
  });
  it("en / vi preset ローマ字氏名 and hide the katakana hint (Q11)", () => {
    for (const lang of ["en", "vi"] as const) {
      const html = render(lang);
      expect(html).toMatch(/checked="" value="ROMAJI"/);
      expect(html).not.toContain("全角カタカナで入力");
    }
    expect(render("en")).toContain("Register");
  });
  it("② 再送: PE004 above the address field, no form", () => {
    const html = render("ja", true);
    expect(html).toContain("確認用リンクの有効期限が切れているか、既に使用されています。");
    expect(html).toContain("送信する");
    expect(html).not.toContain("ご本人の情報");
  });
});
