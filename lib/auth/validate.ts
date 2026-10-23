// Server re-checks of P02–P05 (§4.2 of each spec). A field error = the 04 id plus the field it belongs to; the frame
// renders the text ({項目} from the field name).
import { todayJst } from "@/lib/datetime";

export type FieldError = { field: string; code: string; params?: Record<string, string | number> };

/** "spaces only = empty" (half- and full-width) */
export const blank = (v: unknown) => typeof v !== "string" || v.replace(/[\s　]/g, "") === "";
export const str = (v: unknown) => (typeof v === "string" ? v : "");
export const normEmail = (v: unknown) => str(v).trim().toLowerCase();

/** the settled ruling of P02 Q9 / P04 Q2: one @, text before and after, a dot in the domain, no spaces */
export const emailFormatOk = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;

/** F9-07: 8–64 half-width printable ASCII without space, at least one letter and one digit */
export const passwordRuleOk = (pw: string) =>
  /^[\x21-\x7e]{8,64}$/.test(pw) && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);

/** P02 / P04 / resend: PE001 empty, PE002 format (> 254 included); P03 uses PE003 for the length (longAsPe003) */
export function checkEmail(raw: unknown, field = "email", longAsPe003 = false): FieldError | null {
  if (blank(raw)) return { field, code: "PE001" };
  const email = normEmail(raw);
  if (longAsPe003 && email.length > 254) return { field, code: "PE003", params: { n: 254 } };
  return emailFormatOk(email) ? null : { field, code: "PE002" };
}

/** P03 / P05: new password + confirmation */
export function checkNewPassword(pw: unknown, confirm: unknown, field = "password", confirmField = "passwordConfirm") {
  const errors: FieldError[] = [];
  if (blank(pw)) errors.push({ field, code: "PE001" });
  else if (!passwordRuleOk(str(pw))) errors.push({ field, code: "PE006" });
  if (blank(confirm)) errors.push({ field: confirmField, code: "PE001" });
  else if (str(confirm) !== str(pw)) errors.push({ field: confirmField, code: "PE007" });
  return errors;
}

export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県",
  "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県",
  "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県",
  "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

/** full-width digits → half-width, hyphens and spaces dropped (F1-04, P03 items 14, 20) */
export const digitsOnly = (v: unknown) =>
  str(v).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[\s　\-‐－ー−]/g, "");

const ROMAJI = /^[A-Za-z' -]+$/;
const KATAKANA = /^[ァ-ヶー　 ]+$/;

export type RegistrationInput = {
  email: string; password: string; nameType: "JP" | "ROMAJI";
  familyName: string; givenName: string; familyNameKana: string; givenNameKana: string;
  birthDate: string; sex: "MALE" | "FEMALE"; postcode: string; prefecture: string; city: string; town: string | null;
  addressLine: string; building: string | null; phone: string;
};

/**
 * P03 event 5. `tampered` = a value the UI cannot produce (5-6 → ER-02, nothing written); otherwise the field errors of
 * 4.2 rows 1–30, or the normalised input.
 */
export function checkRegistration(body: Record<string, unknown>, now = new Date()):
  | { tampered: true }
  | { tampered: false; errors: FieldError[]; input: RegistrationInput } {
  const nameType = body.nameType;
  const sex = body.sex;
  const prefecture = str(body.prefecture);
  if (
    (nameType !== "JP" && nameType !== "ROMAJI")
    || (sex !== undefined && sex !== "" && sex !== "1" && sex !== "2")
    || (prefecture !== "" && !PREFECTURES.includes(prefecture))
  ) {
    return { tampered: true };
  }

  const errors: FieldError[] = [];
  const emailError = checkEmail(body.email, "email", true);
  if (emailError) errors.push(emailError);
  errors.push(...checkNewPassword(body.password, body.passwordConfirm));

  const text = (field: string, max: number, required: boolean, pattern?: RegExp, patternCode?: string) => {
    const v = str(body[field]).trim();
    if (blank(v)) {
      if (required) errors.push({ field, code: "PE001" });
      return v;
    }
    if (v.length > max) errors.push({ field, code: "PE003", params: { n: max } });
    else if (pattern && !pattern.test(v)) errors.push({ field, code: patternCode! });
    return v;
  };
  const romaji = nameType === "ROMAJI";
  const familyName = text("familyName", 50, true, romaji ? ROMAJI : undefined, "PE016");
  const givenName = text("givenName", 50, true, romaji ? ROMAJI : undefined, "PE016");
  const familyNameKana = text("familyNameKana", 50, true, romaji ? undefined : KATAKANA, "PE009");
  const givenNameKana = text("givenNameKana", 50, true, romaji ? undefined : KATAKANA, "PE009");

  const birthDate = str(body.birthDate);
  if (blank(birthDate)) errors.push({ field: "birthDate", code: "PE001" });
  else {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(birthDate) ? new Date(`${birthDate}T00:00:00Z`) : null;
    const exists = d !== null && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === birthDate;
    if (!exists || birthDate < "1900-01-01" || birthDate > todayJst(now)) errors.push({ field: "birthDate", code: "PE014" });
  }
  if (sex === undefined || sex === "") errors.push({ field: "sex", code: "PE001" });

  const postcode = digitsOnly(body.postcode);
  if (blank(body.postcode)) errors.push({ field: "postcode", code: "PE001" });
  else if (!/^\d{7}$/.test(postcode)) errors.push({ field: "postcode", code: "PE002" });
  if (prefecture === "") errors.push({ field: "prefecture", code: "PE001" });
  const city = text("city", 50, true);
  const town = text("town", 100, false);
  const addressLine = text("addressLine", 200, true);
  const building = text("building", 100, false);
  const phone = digitsOnly(body.phone);
  if (blank(body.phone)) errors.push({ field: "phone", code: "PE001" });
  else if (!/^\d{10,11}$/.test(phone)) errors.push({ field: "phone", code: "PE015" });

  if (body.agreeTerms !== true) errors.push({ field: "agreeTerms", code: "PE008" });
  if (body.agreePrivacy !== true) errors.push({ field: "agreePrivacy", code: "PE008" });

  return {
    tampered: false,
    errors,
    input: {
      email: normEmail(body.email), password: str(body.password), nameType, familyName, givenName, familyNameKana, givenNameKana,
      birthDate, sex: sex === "2" ? "FEMALE" : "MALE", postcode, prefecture, city, town: town || null, addressLine,
      building: building || null, phone,
    },
  };
}
