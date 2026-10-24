// B6 rows of the X5 files (05 X5-P / X5-B): the columns of `X5P_HEADER` / `X5B_HEADER` in order.
import type { Prisma } from "@prisma/client";
import { dbDate, toHhmm, toIsoDate } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { formatPhone } from "@/lib/public/phone";

const WIDE_SPACE = "　";
const jst = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString();
/** `yyyy/MM/dd HH:mm` (JST) */
const stamp = (d: Date) => `${jst(d).slice(0, 10).replaceAll("-", "/")} ${jst(d).slice(11, 16)}`;

/** ROMAJI names → full-width upper case (X5-P No. 3) */
export const wideUpper = (s: string) => s.toUpperCase().replace(/[A-Z0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
/** 全角カタカナ (X5-P No. 4): half-width kana widened, hiragana → katakana */
export const wideKana = (s: string) => s.normalize("NFKC").replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

// cap: B6 rows per file (質疑 pending) — over it the clinic is refused whole, no partial file (06 B6 Failure)
export const B6_MAX_ROWS = 50_000;

/** the clinic's patients: a booking (not CANCELED) or a 診察券 at the clinic; since = delta start (null = all) */
export async function patientRows(clinicId: string, since: Date | null): Promise<string[][]> {
  const where: Prisma.PatientWhereInput = {
    mergedIntoId: null, anonymizedAt: null,
    AND: [
      { OR: [{ bookings: { some: { clinicId, status: { not: "CANCELED" } } } }, { cards: { some: { clinicId } } }] },
      ...(since ? [{ OR: [{ updatedAt: { gte: since } }, { cards: { some: { clinicId, updatedAt: { gte: since } } } }] }] : []),
    ],
  };
  const count = await prisma.patient.count({ where });
  if (count > B6_MAX_ROWS) throw new Error(`${count} patient rows over the cap ${B6_MAX_ROWS}`);
  const rows = await prisma.patient.findMany({ where, include: { cards: { where: { clinicId } } }, orderBy: [{ updatedAt: "asc" }, { id: "asc" }] });
  return rows.map((p) => {
    const name = p.nameType === "ROMAJI" ? wideUpper : (s: string) => s;
    return [
      p.cards[0]?.cardNo ?? "", p.id,
      `${name(p.familyName)}${WIDE_SPACE}${name(p.givenName)}`, `${wideKana(p.familyNameKana)}${WIDE_SPACE}${wideKana(p.givenNameKana)}`,
      p.sex === "MALE" ? "1" : "2", toIsoDate(p.birthDate).replaceAll("-", ""), `${p.postcode.slice(0, 3)}-${p.postcode.slice(3)}`,
      `${p.prefecture}${p.city}${p.town ?? ""}${p.addressLine}${p.building ? WIDE_SPACE + p.building : ""}`,
      p.phone ? formatPhone(p.phone) : "", !since || p.createdAt >= since ? "新規" : "変更", stamp(p.updatedAt),
    ];
  });
}

const STATUS = { RESERVED: "予約済", CHECKED_IN: "来院済", NO_SHOW: "無断キャンセル", CANCELED: "キャンセル済" } as const;
const CATEGORY = { FIRST: "初診", REPEAT: "再診", SELF_PAY: "自費" } as const;
const CHANNEL = { WEB: "Web", PHONE: "電話", COUNTER: "窓口" } as const;

export type SentFile = { createdAt: Date; periodFrom: Date | null; periodTo: Date | null };

/**
 * the clinic's bookings with slot_date in [from, to]. A cancellation is sent once (Q-056), judged per booking against the
 * clinic's DONE BOOKINGS files `sent` whose period covers its slot_date: sent when a file made before the cancel carried
 * the booking and no file made after the cancel carried the cancellation yet. A file of another period hands nothing over.
 */
export async function bookingRows(clinicId: string, from: string, to: string, sent: SentFile[]): Promise<string[][]> {
  const where: Prisma.BookingWhereInput = { clinicId, slotDate: { gte: dbDate(from), lte: dbDate(to) }, anonymizedAt: null };
  const count = await prisma.booking.count({ where });
  if (count > B6_MAX_ROWS) throw new Error(`${count} booking rows over the cap ${B6_MAX_ROWS}`);
  const rows = await prisma.booking.findMany({
    where,
    include: {
      department: true, visitType: true, doctor: true, questionnaire: { select: { bookingId: true } },
      patient: { include: { cards: { where: { clinicId } } } },
    },
    orderBy: [{ slotDate: "asc" }, { startTime: "asc" }, { bookingNo: "asc" }],
  });
  const covering = (d: Date) => sent.filter((f) => f.periodFrom && f.periodTo && f.periodFrom <= d && d <= f.periodTo);
  const due = (b: (typeof rows)[number]) => {
    if (b.status !== "CANCELED") return true;
    const files = covering(b.slotDate);
    const at = b.canceledAt ?? b.updatedAt;
    return files.some((f) => f.createdAt > b.createdAt && f.createdAt <= at) && !files.some((f) => f.createdAt > at);
  };
  return rows.filter(due).map((b) => [
    b.bookingNo, toIsoDate(b.slotDate).replaceAll("-", ""), toHhmm(b.startTime).replace(":", ""), toHhmm(b.endTime).replace(":", ""),
    b.department.code, b.visitType.code, b.visitType.nameJa, CATEGORY[b.visitType.category], b.doctor.code, `${b.doctor.familyName}${b.doctor.givenName}`,
    b.patient.cards[0]?.cardNo ?? "", b.patient.id, `${wideKana(b.patient.familyNameKana)}${WIDE_SPACE}${wideKana(b.patient.givenNameKana)}`,
    STATUS[b.status], CHANNEL[b.channel], b.questionnaire ? "有" : "無",
  ]);
}
