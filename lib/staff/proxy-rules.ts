// spec-screen: S02
// 4.2 single-item checks of 代理予約 (shared by the client's inline checks and the server's re-check, SE001 / SE002 / SE003).
import { birthDateOk, digitsOnly, katakanaOk, PREFECTURES, romajiNameOk } from "@/lib/auth/validate";
import { BOOKING_NO, normalizeBookingNo } from "./ledger-rules";

export type FErr = { field: string; code: string; params?: Record<string, string | number> };
const blank = (v: unknown) => typeof v !== "string" || v.replace(/[\s　]/g, "") === "";
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const e1 = (field: string, 項目: string): FErr => ({ field, code: "SE001", params: { 項目 } });
const e2 = (field: string, 項目: string): FErr => ({ field, code: "SE002", params: { 項目 } });
const e3 = (field: string, 項目: string, n: number): FErr => ({ field, code: "SE003", params: { 項目, n } });

/** hiragana → katakana (item 2 is normalised before the search, Q2) */
export const toKatakana = (s: string) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

// cap: フリガナ search text length (質疑 pending): 桁数 of item 2 is "— (Q2)"
export const KANA_MAX = 100;
// cap: 電話番号 search text length (質疑 pending): 桁数 of item 3 is "— (Q2)"
export const PHONE_MAX = 30;

export type SearchInput = { kana: string[]; phone: string; card: string; bookingNo: string };

/** event 2 / 4.2 No. 1–5: SE001 when nothing is filled, otherwise the format errors of the filled boxes */
export function checkSearch(body: Record<string, unknown>): { errors: FErr[]; input: SearchInput } {
  const errors: FErr[] = [];
  const kanaRaw = text(body.kana);
  const phoneRaw = text(body.phone);
  const card = text(body.card);
  const noRaw = text(body.bookingNo);
  const input: SearchInput = { kana: [], phone: "", card: "", bookingNo: "" };
  if ([kanaRaw, phoneRaw, card, noRaw].every((v) => blank(v))) return { errors: [e1("search", "検索条件")], input };
  if (!blank(kanaRaw)) {
    if (kanaRaw.length > KANA_MAX) errors.push(e3("kana", "フリガナ", KANA_MAX));
    else if (!/^[ぁ-ゖァ-ヺー\s　]+$/.test(kanaRaw)) errors.push(e2("kana", "フリガナ"));
    else input.kana = toKatakana(kanaRaw).split(/[\s　]+/).filter(Boolean);
  }
  if (!blank(phoneRaw)) {
    const d = digitsOnly(phoneRaw);
    if (phoneRaw.length > PHONE_MAX) errors.push(e3("phone", "電話番号", PHONE_MAX));
    else if (!/^\d+$/.test(d)) errors.push(e2("phone", "電話番号"));
    else input.phone = d;
  }
  if (!blank(card)) {
    if (card.length > 20) errors.push(e3("card", "診察券番号", 20));
    else if (!/^[0-9A-Za-z-]+$/.test(card)) errors.push(e2("card", "診察券番号"));
    else input.card = card;
  }
  if (!blank(noRaw)) {
    const no = normalizeBookingNo(noRaw);
    if (!BOOKING_NO.test(no)) errors.push(e2("bookingNo", "予約番号"));
    else input.bookingNo = no;
  }
  return { errors, input };
}

export type NewPatient = {
  nameType: "JP" | "ROMAJI"; familyName: string; givenName: string; familyNameKana: string; givenNameKana: string; birthDate: string;
  sex: "MALE" | "FEMALE"; postcode: string; prefecture: string; city: string; town: string | null; addressLine: string; building: string | null;
  phone: string; smsOptIn: boolean; cardNo: string | null;
};

/** 「YYYY/MM/DD」 or ISO → ISO, else "" */
export function isoOf(v: unknown) {
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(text(v));
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
}

/**
 * 4.2 No. 6–15 on the form items 10–18. `tampered` = a value the UI cannot produce (name type, sex, prefecture): ER-02.
 * Only the fields named in `only` are checked when given (inline check on focus-out).
 */
export function checkNewPatient(v: Record<string, unknown>, now = new Date(), only?: string[]):
  { tampered: true } | { tampered: false; errors: FErr[]; input: NewPatient } {
  const nameType = v.nameType;
  const sex = v.sex;
  const prefecture = text(v.prefecture);
  if ((nameType !== undefined && nameType !== "" && nameType !== "JP" && nameType !== "ROMAJI") || (sex !== undefined && sex !== "" && sex !== "1" && sex !== "2")
    || (prefecture !== "" && !PREFECTURES.includes(prefecture))) return { tampered: true };
  const errors: FErr[] = [];
  const want = (f: string) => !only || only.includes(f);
  const push = (e: FErr | null) => { if (e && want(e.field)) errors.push(e); };
  const req = (f: string, label: string, max: number, ok?: (s: string) => boolean) => {
    const s = text(v[f]);
    if (blank(s)) push(e1(f, label));
    else if (s.length > max) push(e3(f, label, max));
    else if (ok && !ok(s)) push(e2(f, label));
    return s;
  };
  if (nameType !== "JP" && nameType !== "ROMAJI") push(e1("nameType", "氏名の種類"));
  const romaji = nameType === "ROMAJI";
  const familyName = req("familyName", "姓", 50, romaji ? romajiNameOk : undefined);
  const givenName = req("givenName", "名", 50, romaji ? romajiNameOk : undefined);
  const kana = nameType === "JP" ? katakanaOk : undefined;
  const familyNameKana = req("familyNameKana", "セイ", 50, kana);
  const givenNameKana = req("givenNameKana", "メイ", 50, kana);
  const birthDate = isoOf(v.birthDate);
  if (blank(v.birthDate)) push(e1("birthDate", "生年月日"));
  else if (!birthDateOk(birthDate, now)) push(e2("birthDate", "生年月日"));
  if (sex === undefined || sex === "") push(e1("sex", "性別"));
  const pc = digitsOnly(v.postcode);
  if (blank(v.postcode)) push(e1("postcode", "郵便番号"));
  else if (!/^\d{7}$/.test(pc)) push(e2("postcode", "郵便番号"));
  if (prefecture === "") push(e1("prefecture", "都道府県"));
  const city = req("city", "市区町村", 50);
  const town = req("town", "町域", 100) ; // optional: blank is not an error
  const addressLine = req("addressLine", "番地", 200);
  const building = req("building", "建物名", 100);
  const phone = digitsOnly(v.phone);
  if (blank(v.phone)) push(e1("phone", "電話番号"));
  else if (!/^\d{10,11}$/.test(phone)) push(e2("phone", "電話番号"));
  const card = text(v.cardNo);
  if (card.length > 20) push(e3("cardNo", "診察券番号", 20));
  else if (card && !/^[0-9A-Za-z-]+$/.test(card)) push(e2("cardNo", "診察券番号"));
  // town and building are optional: only length errors count
  const keep = errors.filter((e) => !((e.field === "town" || e.field === "building") && e.code === "SE001"));
  return {
    tampered: false, errors: keep,
    input: {
      nameType: romaji ? "ROMAJI" : "JP", familyName, givenName, familyNameKana, givenNameKana, birthDate, sex: sex === "2" ? "FEMALE" : "MALE",
      postcode: pc, prefecture, city, town: town || null, addressLine, building: building || null, phone, smsOptIn: v.smsOptIn === true, cardNo: card || null,
    },
  };
}

/** 4.2 No. 16–19 on the booking items (event 10) */
export function checkBookingFields(b: Record<string, unknown>): FErr[] {
  const errors: FErr[] = [];
  if (blank(b.departmentId)) errors.push(e1("departmentId", "診療科"));
  if (blank(b.visitTypeId)) errors.push(e1("visitTypeId", "診療区分"));
  if (blank(b.date)) errors.push(e1("date", "予約日"));
  else if (!isoOf(b.date)) errors.push(e2("date", "予約日"));
  if (blank(b.startTime)) errors.push(e1("frame", "枠"));
  if (b.channel !== "PHONE" && b.channel !== "COUNTER") errors.push(e1("channel", "受付経路"));
  if (typeof b.notes === "string" && b.notes.length > 200) errors.push(e3("notes", "備考", 200));
  return errors;
}
