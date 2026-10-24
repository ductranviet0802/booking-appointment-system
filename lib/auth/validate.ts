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

// S-02: the person rules of P03 §4.1 / §4.2 (03 §3.15), one function per rule; P03, P06 and P07 share them.
/** ローマ字氏名 items 8 / 9: A–Z, a–z, space, hyphen, apostrophe (PE016) */
export const romajiNameOk = (v: string) => /^[A-Za-z' -]+$/.test(v);
/** 日本語氏名 items 10 / 11: full-width katakana (ァ…ヺ), ー, full- or half-width space (PE009) */
export const katakanaOk = (v: string) => /^[ァ-ヺー　 ]+$/.test(v);
/** a calendar date "YYYY-MM-DD" from 1900-01-01 to today JST (PE014) */
export function birthDateOk(iso: string, now = new Date()) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00Z`) : null;
  const exists = d !== null && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
  return exists && iso >= "1900-01-01" && iso <= todayJst(now);
}
/** after normalisation 7 digits (PE002) */
export const postcodeOk = (digits: string) => /^\d{7}$/.test(digits);
/** after normalisation 10 or 11 digits (PE015) */
export const phoneOk = (digits: string) => /^\d{10,11}$/.test(digits);

/** 診察券番号 (03 §3.16; P06 22-2, P07 20-2): optional, 0–20 → PE003, `^[0-9A-Za-z-]+$` → PE002 */
export function checkCardNo(raw: string, field: string): FieldError | null {
  const v = raw.trim();
  if (v.length > 20) return { field, code: "PE003", params: { n: 20 } };
  return v && !/^[0-9A-Za-z-]+$/.test(v) ? { field, code: "PE002" } : null;
}

export type NameType = "JP" | "ROMAJI";
export type Sex = "MALE" | "FEMALE";

export type PersonInput = {
  nameType: NameType; familyName: string; givenName: string; familyNameKana: string; givenNameKana: string;
  birthDate: string; sex: Sex; postcode: string; prefecture: string; city: string; town: string | null;
  addressLine: string; building: string | null; phone: string | null;
};

export type RegistrationInput = PersonInput & { email: string; password: string; phone: string };

/** a text field: spaces only = empty (PE001 when required), longer than max → PE003, rule broken → its code */
function textField(body: Record<string, unknown>, errors: FieldError[], field: string, max: number, required: boolean, rule?: [(v: string) => boolean, string]) {
  const v = str(body[field]).trim();
  if (blank(v)) {
    if (required) errors.push({ field, code: "PE001" });
    return v;
  }
  if (v.length > max) errors.push({ field, code: "PE003", params: { n: max } });
  else if (rule && !rule[0](v)) errors.push({ field, code: rule[1] });
  return v;
}

/**
 * The person fields of P03 (items 7–20), P06 (5–15, 25) and P07 (8–19). null = a value the UI cannot produce
 * (name type, sex code or prefecture outside the lists → ER-02, nothing written). `phoneRequired` false: P07 family.
 */
export function checkPerson(body: Record<string, unknown>, now = new Date(), phoneRequired = true):
  | null
  | { errors: FieldError[]; input: PersonInput } {
  const nameType = body.nameType;
  const sex = body.sex;
  const prefecture = str(body.prefecture);
  if (
    (nameType !== "JP" && nameType !== "ROMAJI")
    || (sex !== undefined && sex !== "" && sex !== "1" && sex !== "2")
    || (prefecture !== "" && !PREFECTURES.includes(prefecture))
  ) {
    return null;
  }
  const errors: FieldError[] = [];
  const name: [(v: string) => boolean, string] | undefined = nameType === "ROMAJI" ? [romajiNameOk, "PE016"] : undefined;
  const kana: [(v: string) => boolean, string] | undefined = nameType === "JP" ? [katakanaOk, "PE009"] : undefined;
  const familyName = textField(body, errors, "familyName", 50, true, name);
  const givenName = textField(body, errors, "givenName", 50, true, name);
  const familyNameKana = textField(body, errors, "familyNameKana", 50, true, kana);
  const givenNameKana = textField(body, errors, "givenNameKana", 50, true, kana);

  const birthDate = str(body.birthDate);
  if (blank(birthDate)) errors.push({ field: "birthDate", code: "PE001" });
  else if (!birthDateOk(birthDate, now)) errors.push({ field: "birthDate", code: "PE014" });
  if (sex === undefined || sex === "") errors.push({ field: "sex", code: "PE001" });

  const postcode = digitsOnly(body.postcode);
  if (blank(body.postcode)) errors.push({ field: "postcode", code: "PE001" });
  else if (!postcodeOk(postcode)) errors.push({ field: "postcode", code: "PE002" });
  if (prefecture === "") errors.push({ field: "prefecture", code: "PE001" });
  const city = textField(body, errors, "city", 50, true);
  const town = textField(body, errors, "town", 100, false);
  const addressLine = textField(body, errors, "addressLine", 200, true);
  const building = textField(body, errors, "building", 100, false);
  const phone = digitsOnly(body.phone);
  if (blank(body.phone)) {
    if (phoneRequired) errors.push({ field: "phone", code: "PE001" });
  } else if (!phoneOk(phone)) errors.push({ field: "phone", code: "PE015" });

  return {
    errors,
    input: {
      nameType, familyName, givenName, familyNameKana, givenNameKana, birthDate, sex: sex === "2" ? "FEMALE" : "MALE",
      postcode, prefecture, city, town: town || null, addressLine, building: building || null, phone: phone || null,
    },
  };
}

/**
 * P03 event 5. `tampered` = a value the UI cannot produce (5-6 → ER-02, nothing written); otherwise the field errors of
 * 4.2 rows 1–30, or the normalised input.
 */
export function checkRegistration(body: Record<string, unknown>, now = new Date()):
  | { tampered: true }
  | { tampered: false; errors: FieldError[]; input: RegistrationInput } {
  const person = checkPerson(body, now);
  if (!person) return { tampered: true };
  const errors: FieldError[] = [];
  const emailError = checkEmail(body.email, "email", true);
  if (emailError) errors.push(emailError);
  errors.push(...checkNewPassword(body.password, body.passwordConfirm));
  errors.push(...person.errors);
  if (body.agreeTerms !== true) errors.push({ field: "agreeTerms", code: "PE008" });
  if (body.agreePrivacy !== true) errors.push({ field: "agreePrivacy", code: "PE008" });
  return {
    tampered: false,
    errors,
    input: { ...person.input, phone: person.input.phone ?? "", email: normEmail(body.email), password: str(body.password) },
  };
}

/** a person row of the DB → the body shape of checkPerson (forms of P06 / P07) */
export function personBody(p: {
  nameType: NameType; familyName: string; givenName: string; familyNameKana: string; givenNameKana: string; birthDate: Date;
  sex: Sex; postcode: string; prefecture: string; city: string; town: string | null; addressLine: string; building: string | null;
  phone: string | null;
}) {
  return {
    nameType: p.nameType, familyName: p.familyName, givenName: p.givenName, familyNameKana: p.familyNameKana,
    givenNameKana: p.givenNameKana, birthDate: p.birthDate.toISOString().slice(0, 10), sex: p.sex === "FEMALE" ? "2" : "1",
    postcode: p.postcode, prefecture: p.prefecture, city: p.city, town: p.town ?? "", addressLine: p.addressLine,
    building: p.building ?? "", phone: p.phone ?? "",
  };
}
