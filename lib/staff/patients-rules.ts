// spec-screen: S03
// S03 rules shared by the browser and the server: search conditions (4.2 No. 1–6, F14-04, F7-02, Q1), the merge-target box
// (No. 17, Q4), the profile form (No. 7–16) and the display labels of 03 §2 / 07 §1 (Q11, Q12). No database access here.
import type { FieldError } from "@/lib/auth/validate";
import { birthDateOk, blank, digitsOnly, katakanaOk, PREFECTURES, romajiNameOk } from "@/lib/auth/validate";

// ── search ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type SearchInput = { kana: string; name: string; phone: string; birth: string; card: string; bookingNo: string };
export const SEARCH_KEYS = ["kana", "name", "phone", "birth", "card", "bookingNo"] as const;
export const EMPTY_SEARCH: SearchInput = { kana: "", name: "", phone: "", birth: "", card: "", bookingNo: "" };

/** normalised conditions; undefined = not filled */
export type Conditions = { kanaWords?: string[]; nameWords?: string[]; phone?: string; birth?: string; card?: string; bookingNo?: string };

export const SEARCH_MAX = 100; // 4.1 item 8: max 100 rows; the 101st decides SI034
// cap: S03 氏名 / フリガナ search text length (質疑 pending) — Q1 settles "桁数: none"
export const SEARCH_TEXT_MAX = 100;

const KANA_INPUT = /^[ぁ-ゖァ-ヺー\s　]+$/;
const CARD = /^[0-9A-Za-z-]+$/;
const BOOKING_NO = /^[A-HJ-NP-Z]{4}[0-9]{4}$/;
const words = (s: string) => s.trim().split(/[\s　]+/).filter(Boolean);
const toKatakana = (s: string) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

/** F7-02: full-width converted, case-insensitive, hyphen optional → AAAA0000 (null when not that shape) */
export function normBookingNo(raw: string): string | null {
  const v = raw.normalize("NFKC").toUpperCase().replace(/[\s-]/g, "");
  return BOOKING_NO.test(v) ? v : null;
}

/** "YYYY/MM/DD" (or YYYY-MM-DD) → ISO, null when not a calendar date */
export function slashDate(raw: string): string | null {
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(raw.normalize("NFKC").trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

const fe = (field: string, code: string, 項目: string, n?: number): FieldError => ({ field, code, params: n === undefined ? { 項目 } : { 項目, n } });

/** 4.2 No. 1–6 (event 1, client and server) */
export function checkSearch(s: SearchInput): { errors: FieldError[]; conditions: Conditions } {
  const errors: FieldError[] = [];
  const c: Conditions = {};
  if (SEARCH_KEYS.every((k) => blank(s[k]))) return { errors: [fe("kana", "SE001", "検索条件")], conditions: c };
  if (!blank(s.kana)) {
    const kana = s.kana.normalize("NFKC"); // half-width katakana → full-width
    if ([...kana].length > SEARCH_TEXT_MAX) errors.push(fe("kana", "SE003", "フリガナ", SEARCH_TEXT_MAX));
    else if (!KANA_INPUT.test(kana)) errors.push(fe("kana", "SE002", "フリガナ"));
    else c.kanaWords = words(toKatakana(kana));
  }
  if (!blank(s.name)) {
    if ([...s.name].length > SEARCH_TEXT_MAX) errors.push(fe("name", "SE003", "氏名", SEARCH_TEXT_MAX));
    else c.nameWords = words(s.name.normalize("NFKC"));
  }
  if (!blank(s.phone)) {
    const d = digitsOnly(s.phone);
    if (!/^\d+$/.test(d) || d.length > 11) errors.push(fe("phone", "SE002", "電話番号"));
    else c.phone = d;
  }
  if (!blank(s.birth)) {
    const iso = slashDate(s.birth);
    if (!iso) errors.push(fe("birth", "SE002", "生年月日"));
    else c.birth = iso;
  }
  if (!blank(s.card)) {
    const v = s.card.trim();
    if (v.length > 20) errors.push(fe("card", "SE003", "診察券番号", 20));
    else if (!CARD.test(v)) errors.push(fe("card", "SE002", "診察券番号"));
    else c.card = v;
  }
  if (!blank(s.bookingNo)) {
    const n = normBookingNo(s.bookingNo);
    if (!n) errors.push(fe("bookingNo", "SE002", "予約番号"));
    else c.bookingNo = n;
  }
  return { errors, conditions: c };
}

/** Q4 A: kana → フリガナ; otherwise the text as 電話番号 or as 診察券番号 (either matches). 4.2 No. 17. */
export function checkMergeBox(raw: string): { errors: FieldError[]; kanaWords?: string[]; phoneOrCard?: { phone: string | null; card: string } } {
  if (blank(raw)) return { errors: [fe("mergeQuery", "SE001", "統合先の患者")] };
  const v = raw.trim().normalize("NFKC");
  if (/[ぁ-ゖァ-ヺ]/.test(v)) {
    return KANA_INPUT.test(v) && [...v].length <= SEARCH_TEXT_MAX
      ? { errors: [], kanaWords: words(toKatakana(v)) }
      : { errors: [fe("mergeQuery", "SE002", "統合先の患者")] };
  }
  const card = v;
  if (card.length > 20 || !CARD.test(card)) return { errors: [fe("mergeQuery", "SE002", "統合先の患者")] };
  const d = digitsOnly(v);
  return { errors: [], phoneOrCard: { phone: /^\d{1,11}$/.test(d) ? d : null, card } };
}

// ── the profile form (4.2 No. 7–16) ────────────────────────────────────────────────────────────────────────────────

export type ProfileValues = {
  nameType: string; familyName: string; givenName: string; familyNameKana: string; givenNameKana: string; birthDate: string; sex: string;
  postcode: string; prefecture: string; city: string; town: string; addressLine: string; building: string; phone: string; smsOptIn: boolean;
};
export type CardValue = { clinicId: string; cardNo: string; stored: boolean };

/** values the UI cannot produce (6-6 → ER-02) */
export const profileTampered = (v: ProfileValues) =>
  (v.nameType !== "JP" && v.nameType !== "ROMAJI") || (v.sex !== "" && v.sex !== "1" && v.sex !== "2") || (v.prefecture !== "" && !PREFECTURES.includes(v.prefecture));

export function checkProfile(v: ProfileValues, o: { phoneRequired: boolean; now?: Date }): FieldError[] {
  const e: FieldError[] = [];
  const text = (field: keyof ProfileValues, label: string, max: number, required: boolean, rule?: (s: string) => boolean) => {
    const s = (v[field] as string).trim();
    if (blank(s)) return void (required && e.push(fe(field, "SE001", label)));
    if ([...s].length > max) e.push(fe(field, "SE003", label, max));
    else if (rule && !rule(s)) e.push(fe(field, "SE002", label));
  };
  if (v.nameType === "") e.push(fe("nameType", "SE001", "氏名の種類"));
  const romaji = v.nameType === "ROMAJI";
  text("familyName", "姓", 50, true, romaji ? romajiNameOk : undefined);
  text("givenName", "名", 50, true, romaji ? romajiNameOk : undefined);
  text("familyNameKana", "セイ", 50, true, romaji ? undefined : katakanaOk);
  text("givenNameKana", "メイ", 50, true, romaji ? undefined : katakanaOk);
  const birth = slashDate(v.birthDate);
  if (blank(v.birthDate)) e.push(fe("birthDate", "SE001", "生年月日"));
  else if (!birth || !birthDateOk(birth, o.now)) e.push(fe("birthDate", "SE002", "生年月日"));
  if (v.sex === "") e.push(fe("sex", "SE001", "性別"));
  if (blank(v.postcode)) e.push(fe("postcode", "SE001", "郵便番号"));
  else if (!/^\d{7}$/.test(digitsOnly(v.postcode))) e.push(fe("postcode", "SE002", "郵便番号"));
  if (v.prefecture === "") e.push(fe("prefecture", "SE001", "都道府県"));
  text("city", "市区町村", 50, true);
  text("town", "町域", 100, false);
  text("addressLine", "番地", 200, true);
  text("building", "建物名", 100, false);
  if (blank(v.phone)) {
    if (o.phoneRequired) e.push(fe("phone", "SE001", "電話番号"));
  } else if (!/^\d{10,11}$/.test(digitsOnly(v.phone))) e.push(fe("phone", "SE002", "電話番号"));
  return e;
}

/** 4.2 No. 16: per row of 20-2; an empty new row is not saved */
export function checkCards(cards: CardValue[]): FieldError[] {
  const e: FieldError[] = [];
  for (const c of cards) {
    const v = c.cardNo.trim();
    const field = `card.${c.clinicId}`;
    if (!v) {
      if (c.stored) e.push(fe(field, "SE001", "診察券番号"));
    } else if (v.length > 20) e.push(fe(field, "SE003", "診察券番号", 20));
    else if (!CARD.test(v)) e.push(fe(field, "SE002", "診察券番号"));
  }
  return e;
}

// ── labels (03 §2, 07 §1, Q11, Q12) ────────────────────────────────────────────────────────────────────────────────

export const SEX_LABEL: Record<string, string> = { MALE: "男性", FEMALE: "女性" };
export const RELATION_LABEL: Record<string, string> = { SELF: "本人", CHILD: "子", SPOUSE: "配偶者", PARENT: "親", OTHER: "その他" };
export const BOOKING_STATUS_LABEL: Record<string, string> = { RESERVED: "予約済", CHECKED_IN: "来院済", NO_SHOW: "無断キャンセル", CANCELED: "キャンセル済" };
export const BOOKING_CHANNEL_LABEL: Record<string, string> = { WEB: "Web", PHONE: "電話", COUNTER: "窓口" };
export const CANCEL_REASON_LABEL: Record<string, string> = { RECOVERED: "体調回復", SCHEDULE: "患者都合", RESCHEDULE: "日程変更", CLINIC: "医院都合", OTHER: "その他" };
export const NOTIFY_EVENT_LABEL: Record<string, string> = {
  NT01_BOOKED: "予約完了", NT02_REMIND: "前日リマインド", NT03_CHANGED: "予約変更", NT04_CANCELED: "予約キャンセル", NT05_PW_RESET: "パスワード再設定",
  NT06_VERIFY: "メールアドレス確認", NT07_ADJUST: "予約調整のお願い",
};
export const NOTIFY_CHANNEL_LABEL: Record<string, string> = { MAIL: "メール", LINE: "LINE", SMS: "SMS" };
export const NOTIFY_STATUS_LABEL: Record<string, string> = { QUEUED: "送信待ち", SENDING: "送信中", SENT: "送信済", FAILED: "送信失敗", BOUNCED: "不達", SKIPPED: "送信なし" };
export const ACCOUNT_STATUS_LABEL: Record<string, string> = { ACTIVE: "有効", PENDING: "仮登録", LOCKED: "一時ロック", DISABLED: "無効", WITHDRAWN: "退会済" };
export const LANGUAGE_LABEL: Record<string, string> = { JA: "日本語", EN: "English", VI: "Tiếng Việt" };
export const CONSENT_LABEL: Record<string, string> = { TERMS: "利用規約", PRIVACY: "プライバシーポリシー" };

/** 8-6 区分 (Q5 A): Web会員 for an account whatever the creator, スタッフ登録 for STAFF without account, empty otherwise */
export function kindLabel(p: { accountId: string | null; relation: string | null; createdByKind: string }) {
  if (p.accountId) return p.relation === "SELF" ? "Web会員" : "Web会員（家族）";
  return p.createdByKind === "STAFF" ? "スタッフ登録" : "";
}

/** full years from an ISO birth date to an ISO day */
export function ageOn(birth: string, today: string) {
  const [by, bm, bd] = birth.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}
