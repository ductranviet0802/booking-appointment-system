// spec-screen: A04
// A04 rules shared by the browser (event 5) and the server (events 6–8): §4.2 checks, the placeholder validity of 04 §6.1
// (SE060, Q9), the sample data of event 4 and the SMS count (Q8). No database access here.
import type { FieldError } from "@/lib/auth/validate";
import { blank } from "@/lib/auth/validate";
import { addDays } from "@/lib/datetime";
import { formatDate } from "@/lib/i18n/format";
import type { Lang } from "@/lib/i18n";

export const EVENTS = ["NT01_BOOKED", "NT02_REMIND", "NT03_CHANGED", "NT04_CANCELED", "NT05_PW_RESET", "NT06_VERIFY", "NT07_ADJUST"] as const;
export type EventCode = (typeof EVENTS)[number];
export const CHANNELS = ["MAIL", "LINE", "SMS"] as const;
export type ChannelCode = (typeof CHANNELS)[number];
export const LANGUAGES = ["JA", "EN", "VI"] as const;
export type LanguageCode = (typeof LANGUAGES)[number];

/** item 2 option texts (04 §6 names) */
export const EVENT_LABEL: Record<EventCode, string> = {
  NT01_BOOKED: "NT-01 予約完了", NT02_REMIND: "NT-02 前日リマインド", NT03_CHANGED: "NT-03 予約変更", NT04_CANCELED: "NT-04 予約キャンセル",
  NT05_PW_RESET: "NT-05 パスワード再設定", NT06_VERIFY: "NT-06 メールアドレス確認", NT07_ADJUST: "NT-07 予約調整のお願い",
};
export const CHANNEL_LABEL: Record<ChannelCode, string> = { MAIL: "メール", LINE: "LINE", SMS: "SMS" };
export const LANGUAGE_LABEL: Record<LanguageCode, string> = { JA: "日本語", EN: "英語", VI: "ベトナム語" };

/** 04 §6: NT-05 / NT-06 are mail only (state ②) */
export const channelsOf = (e: EventCode): readonly ChannelCode[] => (e === "NT05_PW_RESET" || e === "NT06_VERIFY" ? ["MAIL"] : CHANNELS);

const BOOKING_NAMES = [
  "patient_name", "visit_date", "visit_time", "clinic_name", "clinic_phone", "department", "visit_type", "doctor_name", "booking_no", "notice",
  "deadline", "booking_url",
] as const;
/** item 7: 04 §6.1 validity, image order (Q19), with the descriptions 7-1…7-16 */
export const PLACEHOLDERS: Record<string, string> = {
  patient_name: "患者氏名", visit_date: "予約日", visit_time: "開始時刻", clinic_name: "クリニック名", clinic_phone: "電話番号", department: "診療科",
  visit_type: "診療区分", doctor_name: "担当医", booking_no: "予約番号", notice: "持ち物・案内", deadline: "変更期限", booking_url: "予約詳細URL",
  reset_url: "再設定URL", valid_minutes: "有効時間（分）", verify_url: "確認URL", valid_hours: "有効時間（時間）",
};
export function placeholdersOf(e: EventCode): readonly string[] {
  if (e === "NT05_PW_RESET") return ["reset_url", "valid_minutes"];
  if (e === "NT06_VERIFY") return ["verify_url", "valid_hours"];
  return BOOKING_NAMES;
}

/** Q9: a placeholder is `{{name}}` with letters, digits, underscore only; anything else stays text */
const PLACEHOLDER = /\{\{(\w+)\}\}/g;

/** SE060 {項目}: every unknown `{{name}}` of the texts, each once, joined with 「、」 (Q9); "" when none */
export function unknownPlaceholders(e: EventCode, ...texts: string[]): string {
  const valid = new Set(placeholdersOf(e));
  const unknown = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(PLACEHOLDER)) if (!valid.has(m[1])) unknown.add(`{{${m[1]}}}`);
  return [...unknown].join("、");
}

/** the preview renderer: known names replaced, an unknown `{{name}}` left as typed (Q7) */
export const fillPreview = (text: string, vars: Record<string, string>) =>
  text.replace(PLACEHOLDER, (whole, k: string) => (k in vars ? vars[k] : whole));

/** characters as the gateway counts them: every character 1 (Q8), a surrogate pair is one character */
export const charCount = (s: string) => [...s].length;

export const SMS_LIMIT = 70;
export const SUBJECT_MAX = 100;
// cap: template body length (質疑 pending) — Q16 answers "no limit"; 10 000 is twice the X2-L sender limit of 5 000
export const BODY_MAX = 10_000;
export const PHONE_MAX = 300;

/** event 4 sample data (A04 §6 4-1 table) in the language of item 4; clinic values from 抽出4 */
export function sampleVars(o: { language: LanguageCode; channel: ChannelCode; today: string; clinicName: string; clinicPhone: string }): Record<string, string> {
  const lang = o.language.toLowerCase() as Lang;
  const tomorrow = addDays(o.today, 1);
  const notice: Record<Lang, string> = {
    ja: "保険証 または マイナ保険証、お薬手帳",
    en: "Health insurance card or My Number Card, medication notebook",
    vi: "Thẻ bảo hiểm y tế hoặc thẻ My Number, sổ tay thuốc",
  };
  const noPreference: Record<Lang, string> = { ja: "指名なし（当日の担当医）", en: "No preference (doctor on duty)", vi: "Không chỉ định (bác sĩ trực hôm đó)" };
  return {
    patient_name: lang === "ja" ? "山田 太郎" : "Taro Yamada",
    visit_date: formatDate(tomorrow, lang),
    visit_time: "9:30",
    clinic_name: o.clinicName,
    clinic_phone: o.clinicPhone,
    // the table gives 7-6 / 7-7 in ja only: the same value in every language (question in the W4 report)
    department: "内科",
    visit_type: "再診",
    doctor_name: noPreference[lang],
    booking_no: "ABCD-1234",
    notice: notice[lang],
    deadline: `${formatDate(addDays(tomorrow, -1), lang)} 23:59`,
    booking_url: o.channel === "SMS" ? "https://bk.example.jp/b/x7Q" : "https://booking.example.jp/b/…",
    reset_url: "https://booking.example.jp/password/reset?token=…",
    valid_minutes: "30",
    verify_url: "https://booking.example.jp/email/verify?token=…",
    valid_hours: "24",
  };
}

// ── §4.2 rows 1–3: the template editor ─────────────────────────────────────────────────────────────────────────────

export type TemplateValues = { subject: string; body: string };

export function validateTemplate(channel: ChannelCode, v: TemplateValues): FieldError[] {
  const e: FieldError[] = [];
  if (channel === "MAIL") {
    if (blank(v.subject)) e.push({ field: "subject", code: "SE001", params: { 項目: "件名" } });
    else if (charCount(v.subject) > SUBJECT_MAX) e.push({ field: "subject", code: "SE003", params: { 項目: "件名", n: SUBJECT_MAX } });
  }
  if (blank(v.body)) e.push({ field: "body", code: "SE001", params: { 項目: "本文" } });
  else if (charCount(v.body) > BODY_MAX) e.push({ field: "body", code: "SE003", params: { 項目: "本文", n: BODY_MAX } });
  return e;
}

// ── §4.2 rows 5–20: the policy form ────────────────────────────────────────────────────────────────────────────────

export const FRAME_MINUTES = [5, 10, 15, 20, 30] as const;
export type DeadlineType = "PREV_DAY_TIME" | "HOURS_BEFORE";

/** the form as typed (strings), item 10 and 14 as chosen */
export type PolicyValues = {
  frameMinutes: number;
  frameCapacity: string;
  bookingWindowDays: string;
  sameDayCutoffMinutes: string;
  cancelDeadlineType: DeadlineType;
  cancelDeadlineTime: string;
  cancelDeadlineHours: string;
  perPersonDailyLimit: string;
  reminderTime: string;
  phoneMessageJa: string;
  phoneMessageEn: string;
  phoneMessageVi: string;
};

export const POLICY_LABEL = {
  frameCapacity: "1枠の定員",
  bookingWindowDays: "予約受付期間（日）",
  sameDayCutoffMinutes: "当日予約の締切（開始の何分前）",
  cancelDeadlineTime: "前日の時刻",
  cancelDeadlineHours: "何時間前",
  perPersonDailyLimit: "1人1日あたりの予約上限",
  reminderTime: "リマインド送信時刻（前日）",
  phoneMessageJa: "期限後の電話案内文（日本語）",
  phoneMessageEn: "期限後の電話案内文（英語）",
  phoneMessageVi: "期限後の電話案内文（ベトナム語）",
} as const;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const intIn = (v: string, min: number, max: number) => /^\d{1,3}$/.test(v) && Number(v) >= min && Number(v) <= max;

export function validatePolicy(v: PolicyValues): FieldError[] {
  const e: FieldError[] = [];
  const need = (field: keyof typeof POLICY_LABEL, ok: (s: string) => boolean) => {
    const s = v[field as keyof PolicyValues] as string;
    if (blank(s)) e.push({ field, code: "SE001", params: { 項目: POLICY_LABEL[field] } });
    else if (!ok(s.trim())) e.push({ field, code: "SE002", params: { 項目: POLICY_LABEL[field] } });
  };
  need("frameCapacity", (s) => intIn(s, 1, 10));
  need("bookingWindowDays", (s) => intIn(s, 7, 180));
  need("sameDayCutoffMinutes", (s) => intIn(s, 0, 240));
  // Q14: only the field of the chosen type is checked
  if (v.cancelDeadlineType === "PREV_DAY_TIME") need("cancelDeadlineTime", (s) => HHMM.test(s));
  else need("cancelDeadlineHours", (s) => intIn(s, 1, 48));
  need("perPersonDailyLimit", (s) => intIn(s, 1, 3));
  need("reminderTime", (s) => HHMM.test(s) && s >= "07:00" && s <= "20:00");
  if (blank(v.phoneMessageJa)) e.push({ field: "phoneMessageJa", code: "SE001", params: { 項目: POLICY_LABEL.phoneMessageJa } });
  for (const f of ["phoneMessageJa", "phoneMessageEn", "phoneMessageVi"] as const) {
    if (charCount(v[f]) > PHONE_MAX && !e.some((x) => x.field === f)) e.push({ field: f, code: "SE003", params: { 項目: POLICY_LABEL[f], n: PHONE_MAX } });
  }
  return e;
}
