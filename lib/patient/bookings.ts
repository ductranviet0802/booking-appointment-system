// spec-screen: P14 P15 P16
// Reads of the patient booking screens and the P16 re-check / cancel. Every read is scoped to the session's account
// (`patients.account_id` = account: P14 Q11 A, P15 Q5 A, P16 Q1 A); the cancel write is the booking core's (lib/booking).
import type { BookingStatus, Prisma } from "@prisma/client";
import { maskEmail, type Result } from "@/lib/auth/service";
import { cancelBooking, PATIENT_CODE } from "@/lib/booking/core";
import { beforeDeadline, deadlineOf, policyOf } from "@/lib/booking/policy";
import { decryptText } from "@/lib/crypto/field";
import { addDays, dbDate, dbTime, jstInstant, todayJst, toHhmm, toIsoDate } from "@/lib/datetime";
import { t, type Lang } from "@/lib/i18n";
import { formatDate, formatDateShort, formatDateTime, formatPrice, formatTime, formatTimeRange } from "@/lib/i18n/format";
import { label, type LabelKey } from "@/lib/i18n/labels";
import { w2, type W2Key } from "@/lib/i18n/labels-w2";
import { prisma } from "@/lib/prisma";
import { formatPhone, telHref } from "@/lib/public/phone";
import { clinicAddress, doctorName, nameOf, pick } from "@/lib/public/text";
import { checkCancelReason, isPatientReason } from "./cancel-rules";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PAGE_SIZE = 20; // F8-04
// cap: P15 もっと見る offset, 1,000 rows of one tab within the 12 months (質疑 pending)
export const MAX_OFFSET = 1000;

/** P16 §3.2: 基 BASE · ① AFTER (deadline passed) · ② PENDING (確認中) · ③ DONE (来院済 / 無断キャンセル) · ④ CANCELED · ⑤ ADJUST */
export type DetailState = "BASE" | "AFTER" | "PENDING" | "DONE" | "CANCELED" | "ADJUST";

const jstHhmm = (now: Date) => new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(11, 16);
export const formatBookingNo = (no: string) => `${no.slice(0, 4)}-${no.slice(4)}`;

/** ja 「姓 名」; en / vi given family for romaji names (04 §6.1) */
const personName = (p: { nameType: string; familyName: string; givenName: string }, lang: Lang) =>
  p.nameType === "ROMAJI" && lang !== "ja" ? `${p.givenName} ${p.familyName}` : `${p.familyName} ${p.givenName}`;

/** P14 item 10 (F6-06, P14 Q3): MAIL 2 characters + *** + @domain; LINE the word; SMS 3 (11 digits) or 2 (10 digits) + **** + last 4 */
export function maskDestination(channel: "MAIL" | "LINE" | "SMS", to: string) {
  if (channel === "LINE") return "LINE";
  if (channel === "MAIL") return maskEmail(to);
  const digits = to.replace(/^\+81/, "0").replace(/\D/g, "");
  return `${digits.slice(0, digits.length === 10 ? 2 : 3)}-****-${digits.slice(-4)}`;
}

/** 07 §2 badge of a booking: 確認中 for RESERVED whose start has passed (the B4 flag is not needed, P15 Q2 b A) */
export function statusKey(status: BookingStatus, startAt: Date, now: Date): W2Key {
  return status === "RESERVED" && startAt.getTime() <= now.getTime() ? "stPENDING" : (`st${status}` as W2Key);
}

const include = { patient: true, clinic: true, department: true, visitType: true, doctor: true } satisfies Prisma.BookingInclude;
type Row = Prisma.BookingGetPayload<{ include: typeof include }>;

/** the booking of the URL if its patient is under the account (else null → ER-01, nothing disclosed) */
async function ownBooking(bookingId: string, accountId: string) {
  if (!UUID.test(bookingId)) return null;
  return prisma.booking.findFirst({ where: { id: bookingId, patient: { accountId } }, include });
}

function common(b: Row, lang: Lang) {
  const date = toIsoDate(b.slotDate);
  const start = toHhmm(b.startTime);
  const clinic = nameOf(b.clinic, lang);
  const dept = nameOf(b.department, lang);
  const v = b.visitType;
  return {
    id: b.id,
    bookingNo: formatBookingNo(b.bookingNo),
    dateText: `${formatDate(date, lang)} ${formatTimeRange(start, toHhmm(b.endTime), lang)}`,
    clinic: {
      name: clinic, code: b.clinic.code, phone: formatPhone(b.clinic.phone), tel: telHref(b.clinic.phone),
      address: clinicAddress(b.clinic, lang), // P16 Q17 A
    },
    deptVisit: `${dept}・${nameOf(v, lang)}`, // P14 item 6 / P16 item 7: 「・」 as drawn
    doctor: b.doctorRequested ? doctorName(b.doctor, lang) : label("noPreference", lang), // F4-04: never the assigned name
    person: `${personName(b.patient, lang)}${label("nameSuffix", lang) ? ` ${label("nameSuffix", lang)}` : ""}`, // 様 in ja only (Q6 b A)
    notice: v.noticeJa ? pick(lang, v.noticeJa, v.noticeEn, v.noticeVi) : null,
    summary: `${formatDateShort(date, lang)} ${formatTime(start)}${lang === "ja" ? "〜" : "–"} ${clinic} ${dept}`, // P16 16-5
  };
}

// ── P14 ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** P14 抽出1 + 抽出2; null = not the account's (ER-01, T065 / T099) */
export async function loadDone(bookingId: string, accountId: string, lang: Lang) {
  const b = await ownBooking(bookingId, accountId);
  if (!b) return null;
  const changed = b.changeCount > 0;
  // 抽出2 (P14 Q2 A / B): NT-01 in 基, NT-03 in ①; the latest row; shown while QUEUED / SENDING / SENT
  const n = await prisma.notification.findFirst({
    where: { bookingId: b.id, event: changed ? "NT03_CHANGED" : "NT01_BOOKED" }, orderBy: { queuedAt: "desc" },
  });
  const shown = n && ["QUEUED", "SENDING", "SENT"].includes(n.status);
  return {
    ...common(b, lang),
    status: b.status,
    changed,
    firstVisit: b.visitType.category === "FIRST" && !changed, // item 1-2: 問診 step for a 初診 new booking only
    statusLabel: b.status === "RESERVED" ? null : w2(`st${b.status}` as W2Key, lang), // state ② badge (Q10 b A)
    destination: shown ? maskDestination(n.channel, n.toAddress) : null,
  };
}
export type DoneView = NonNullable<Awaited<ReturnType<typeof loadDone>>>;

// ── P16 ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** the state of P16 §3.2 (P16 Q2: past = start passed, the flag is not needed, ② before ⑤) */
export function detailState(b: { status: BookingStatus; adjustRequiredAt: Date | null }, startAt: Date, inside: boolean, now: Date): DetailState {
  if (b.status === "CANCELED") return "CANCELED";
  if (b.status !== "RESERVED") return "DONE";
  if (startAt.getTime() <= now.getTime()) return "PENDING";
  if (b.adjustRequiredAt) return "ADJUST";
  return inside ? "BASE" : "AFTER";
}

function reasonText(code: string, text: string | null, lang: Lang) {
  if (code === "OTHER" && text) return w2("otherText", lang, { text }); // Q10 a A; purged by B5 → label only
  return w2(`r${code}` as W2Key, lang);
}

/** P16 抽出1 + 抽出2; null = not the account's (ER-01) */
export async function loadDetail(bookingId: string, accountId: string, lang: Lang, now = new Date()) {
  const b = await ownBooking(bookingId, accountId);
  if (!b) return null;
  const date = toIsoDate(b.slotDate);
  const start = toHhmm(b.startTime);
  const policy = await policyOf(b.clinicId);
  const state = detailState(b, jstInstant(date, start), beforeDeadline(policy, date, start, now), now);
  const c = common(b, lang);
  const row = await prisma.bookingPolicy.findUnique({ where: { clinicId: b.clinicId }, select: { phoneMessageJa: true, phoneMessageEn: true, phoneMessageVi: true } });
  const phoneMessage = row ? pick(lang, row.phoneMessageJa, row.phoneMessageEn, row.phoneMessageVi) : w2("phoneMessageDefault", lang);
  // Q11 C: no notes → 「なし」 until the B5 purge date (visit + 90 days), hidden after it
  const notes = b.notes ? decryptText(b.notes) : date >= addDays(todayJst(now), -90) ? w2("none", lang) : null;
  return {
    ...c,
    state,
    version: b.version,
    badge: w2(state === "ADJUST" ? "stADJUST" : statusKey(b.status, jstInstant(date, start), now), lang),
    canceled: b.status === "CANCELED" && b.canceledAt && b.cancelReasonCode
      ? w2("canceledOn", lang, { date: formatDate(todayJst(b.canceledAt), lang), reason: reasonText(b.cancelReasonCode, b.cancelReasonText, lang) })
      : null,
    price: b.priceYen === null ? null : formatPrice(b.priceYen, lang),
    notes,
    deadline: formatDateTime(deadlineOf(policy, date, start), lang), // PI056 {期限}, full style (Q12)
    phoneText: t("PI051", lang, { 電話案内文: phoneMessage, クリニック名: c.clinic.name, 電話番号: c.clinic.phone }),
  };
}
export type DetailView = NonNullable<Awaited<ReturnType<typeof loadDetail>>>;

/**
 * P16 抽出3 (events 2 and 4): status (CANCELED PE044, CHECKED_IN / NO_SHOW PE045) → deadline unless 要調整 (PE041) →
 * version (PE047); null = may go on. Nothing is written. PE091 = not the account's booking.
 */
export async function recheck(accountId: string, bookingId: string, version: number, now = new Date()): Promise<string | null> {
  if (!UUID.test(bookingId)) return "PE091";
  const b = await prisma.booking.findFirst({ where: { id: bookingId, patient: { accountId } } });
  if (!b) return "PE091";
  if (b.status === "CANCELED") return PATIENT_CODE.ALREADY_CANCELED;
  if (b.status !== "RESERVED") return PATIENT_CODE.NOT_RESERVED;
  if (!b.adjustRequiredAt && !beforeDeadline(await policyOf(b.clinicId), toIsoDate(b.slotDate), toHhmm(b.startTime), now)) return PATIENT_CODE.DEADLINE;
  if (b.version !== version) return PATIENT_CODE.STALE;
  return null;
}

const TOKEN = /^[A-Za-z0-9-]{8,64}$/;
const fail = (status: number, code: string, params?: Record<string, string | number>): Result => ({ ok: false, status, code, ...(params && { params }) });

/**
 * P16 event 5 (PW001 はい): the server re-check of §4.2, then the core cancel in one transaction (frames freed, CANCELED,
 * NT-04). `token` = one per opened dialog: a double submit returns the first success (PI050) and cancels once.
 */
export async function cancelMine(a: { accountId: string; now?: Date }, body: Record<string, unknown>): Promise<Result> {
  const { bookingId, version, reasonCode, reasonText, token } = body;
  if (typeof bookingId !== "string" || !UUID.test(bookingId)) return fail(404, "PE091");
  if (!(await prisma.booking.count({ where: { id: bookingId, patient: { accountId: a.accountId } } }))) return fail(404, "PE091");
  const code = typeof reasonCode === "string" ? reasonCode : "";
  const text = typeof reasonText === "string" ? reasonText : "";
  // values the dialog cannot produce (another reason code such as CLINIC, no version / token) → ER-02, nothing written
  if (!Number.isInteger(version) || (version as number) < 0 || typeof token !== "string" || !TOKEN.test(token)) return fail(400, "PE090");
  if (code && !isPatientReason(code)) return fail(400, "PE090");
  const errors = checkCancelReason(code, text);
  if (errors.length) return { ok: false, status: 400, code: errors[0].code, errors };
  const r = await cancelBooking(
    { bookingId, version: version as number, reasonCode: code as "OTHER", reasonText: code === "OTHER" ? text : null },
    { kind: "PATIENT", accountId: a.accountId, channel: "WEB" },
    { idempotencyKey: `${bookingId}:${token}`, now: a.now },
  );
  return r.ok ? { ok: true, body: { code: "PI050" } } : fail(409, PATIENT_CODE[r.rule]);
}

// ── P15 ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export const TABS = ["upcoming", "past", "canceled"] as const;
export type Tab = (typeof TABS)[number];

/** today − 12 calendar months (P15 Q3 A); 29 Feb → 28 Feb */
export function twelveMonthsBefore(today: string) {
  const [y, m, d] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** P15 抽出1 conditions; future = start later than now, past = start at or before now (P15 Q2 a A) */
function tabWhere(tab: Tab, accountId: string, now: Date): Prisma.BookingWhereInput {
  const today = todayJst(now);
  const time = dbTime(jstHhmm(now));
  const own = { patient: { accountId } };
  const since = { slotDate: { gte: dbDate(twelveMonthsBefore(today)) } };
  if (tab === "upcoming") {
    return { ...own, status: "RESERVED", OR: [{ slotDate: { gt: dbDate(today) } }, { slotDate: dbDate(today), startTime: { gt: time } }] };
  }
  if (tab === "canceled") return { ...own, ...since, status: "CANCELED" };
  const past = { OR: [{ slotDate: { lt: dbDate(today) } }, { slotDate: dbDate(today), startTime: { lte: time } }] };
  return { ...own, ...since, OR: [{ status: { in: ["CHECKED_IN", "NO_SHOW"] } }, { status: "RESERVED", ...past }] };
}

/** P15 抽出2: the count badges (受診履歴 / キャンセル within the 12 months, Q1 A) */
export async function tabCounts(accountId: string, now = new Date()) {
  const [upcoming, past, canceled] = await Promise.all(TABS.map((tab) => prisma.booking.count({ where: tabWhere(tab, accountId, now) })));
  return { upcoming, past, canceled };
}

/** P15 抽出1 + 抽出3: one page (20 rows) of a tab; `more` = もっと見る shown (Q14 A: rows remain below the count) */
export async function listBookings(accountId: string, tab: Tab, offset: number, lang: Lang, now = new Date()) {
  const dir = tab === "upcoming" ? "asc" : "desc"; // ties by booking_no in the same direction (Q4 A)
  const [rows, counts, family] = await Promise.all([
    prisma.booking.findMany({
      where: tabWhere(tab, accountId, now), include,
      orderBy: [{ slotDate: dir }, { startTime: dir }, { bookingNo: dir }],
      skip: tab === "upcoming" ? 0 : offset, take: PAGE_SIZE,
    }),
    tabCounts(accountId, now),
    prisma.patient.count({ where: { accountId, relation: { not: "SELF" } } }), // 抽出3 (Q6 a A)
  ]);
  return {
    counts,
    // item 12 only on 受診履歴 / キャンセル; 予約中 shows its first 20 rows (spec 基: item 12 never shown)
    more: tab !== "upcoming" && offset + rows.length < counts[tab],
    rows: rows.map((b) => {
      const date = toIsoDate(b.slotDate);
      const start = toHhmm(b.startTime);
      const key = statusKey(b.status, jstInstant(date, start), now);
      const rel = b.patient.relation ?? "OTHER";
      const relText = rel === "SELF" ? w2("relSELF", lang) : label(`rel${rel}` as LabelKey, lang);
      return {
        id: b.id,
        dateText: `${formatDate(date, lang)} ${formatTime(start)}${lang === "ja" ? "〜" : "–"}`, // Q7 A: start time only
        person: family ? (lang === "ja" ? `${personName(b.patient, lang)}（${relText}）` : `${personName(b.patient, lang)} (${relText})`) : null,
        clinicDept: `${nameOf(b.clinic, lang)}・${nameOf(b.department, lang)}`, // Q13 a A
        visitType: nameOf(b.visitType, lang),
        doctor: b.doctorRequested ? doctorName(b.doctor, lang) : label("noPreference", lang),
        status: w2(key, lang),
        statusKey: key,
        pending: key === "stPENDING",
        bookingNo: formatBookingNo(b.bookingNo),
      };
    }),
  };
}
export type ListPage = Awaited<ReturnType<typeof listBookings>>;
