// spec-screen: S03
// S03 患者検索・詳細: search (抽出1), detail (抽出2–6, 9) with PATIENT_VIEW, profile and card save (更新1 / 2, updated_at check,
// Q8), card confirm (更新3), 問診 view (抽出7, QUESTIONNAIRE_VIEW), merge (抽出8, 更新4–7: both patients locked lockPerson in id
// order, bookings locked and moved with version + 1) and the disclosure request (更新8). Audit rows of 03 §3.30 (更新9 / 10).
import { Prisma } from "@prisma/client";
import { bad, done, fail, fieldFail, isUniqueViolation, isUuid, type Actor, type Db } from "@/lib/admin/common";
import { toCp932Safe } from "@/lib/adapters/x5-csv";
import { audit, type Result } from "@/lib/auth/service";
import { staffClinics } from "@/lib/auth/scope";
import { digitsOnly, fullWidthSpaces } from "@/lib/auth/validate";
import { lockBooking, lockPerson } from "@/lib/booking/core";
import { decryptJson } from "@/lib/crypto/field";
import { startDisclosureBuild } from "@/lib/export/disclosure";
import { dbDate, todayJst, toHhmm, toIsoDate } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { formatPhone } from "@/lib/public/phone";
import { answerRows } from "./questionnaire-labels";
import {
  ACCOUNT_STATUS_LABEL, ageOn, checkCards, checkMergeBox, checkProfile, kindLabel, LANGUAGE_LABEL, NOTIFY_CHANNEL_LABEL, profileTampered, SEARCH_MAX,
  SEX_LABEL, slashDate, type CardValue, type Conditions, type ProfileValues,
} from "@/lib/staff/patients-rules";

type Tx = Prisma.TransactionClient;

// ── formats ────────────────────────────────────────────────────────────────────────────────────────────────────────

const WD = ["日", "月", "火", "水", "木", "金", "土"];
const jst = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString();
const slash = (iso: string) => iso.replaceAll("-", "/");
/** 18-5 / 30-3: 2026/10/19 22:41 (JST) */
export const stamp = (d: Date | null) => (d ? `${slash(jst(d).slice(0, 10))} ${jst(d).slice(11, 16)}` : "");
/** 25-4 / 25-5: 10/18 21:02 (Q19 c as drawn) */
const shortStamp = (d: Date | null) => (d ? `${jst(d).slice(5, 7)}/${jst(d).slice(8, 10)} ${jst(d).slice(11, 16)}` : "");
/** 22-1: 10/28(水) 15:00 */
const bookingWhen = (date: string, start: string) => `${date.slice(5, 7)}/${date.slice(8, 10)}(${WD[new Date(`${date}T00:00:00Z`).getUTCDay()]}) ${start}`;
const nameOf = (p: { familyName: string; givenName: string }) => `${p.familyName} ${p.givenName}`;

// ── 抽出1: search ───────────────────────────────────────────────────────────────────────────────────────────────────

export type SearchRow = { id: string; name: string; kana: string; birth: string; phone: string; card: string; kind: string };

const wordsWhere = (words: string[], a: "familyNameKana" | "familyName", b: "givenNameKana" | "givenName"): Prisma.PatientWhereInput[] =>
  words.map((w) => ({ OR: [{ [a]: { contains: w, mode: "insensitive" } }, { [b]: { contains: w, mode: "insensitive" } }] }));

/** group-wide, merged / anonymised hidden, AND of the conditions, cards of the session clinic; ≤ 100 rows + whether more exist */
export async function searchPatients(clinicId: string, c: Conditions & { phoneOrCard?: { phone: string | null; card: string } }, excludeId?: string, now = new Date()) {
  const and: Prisma.PatientWhereInput[] = [{ mergedIntoId: null, anonymizedAt: null }];
  if (excludeId) and.push({ id: { not: excludeId } });
  if (c.kanaWords) and.push(...wordsWhere(c.kanaWords, "familyNameKana", "givenNameKana"));
  if (c.nameWords) and.push(...wordsWhere(c.nameWords, "familyName", "givenName"));
  if (c.phone) and.push({ phone: c.phone });
  if (c.birth) and.push({ birthDate: dbDate(c.birth) });
  if (c.card) and.push({ cards: { some: { clinicId, cardNo: c.card } } });
  if (c.bookingNo) and.push({ bookings: { some: { bookingNo: c.bookingNo } } });
  if (c.phoneOrCard) {
    and.push({ OR: [...(c.phoneOrCard.phone ? [{ phone: c.phoneOrCard.phone }] : []), { cards: { some: { clinicId, cardNo: c.phoneOrCard.card } } }] });
  }
  const rows = await prisma.patient.findMany({
    where: { AND: and },
    include: { cards: { where: { clinicId }, select: { cardNo: true } } },
    orderBy: [{ familyNameKana: "asc" }, { givenNameKana: "asc" }, { birthDate: "asc" }, { id: "asc" }],
    take: SEARCH_MAX + 1,
  });
  const today = todayJst(now);
  const out: SearchRow[] = rows.slice(0, SEARCH_MAX).map((p) => {
    const birth = toIsoDate(p.birthDate);
    return {
      id: p.id, name: nameOf(p), kana: `${p.familyNameKana} ${p.givenNameKana}`, birth: `${slash(birth)}（${ageOn(birth, today)}歳）`,
      phone: p.phone ? formatPhone(p.phone) : "—", card: p.cards[0]?.cardNo ?? "—", kind: kindLabel(p),
    };
  });
  return { rows: out, over: rows.length > SEARCH_MAX };
}

/** event 17: the merge-target box (Q4) */
export async function mergeSearch(a: Actor, b: Record<string, unknown>): Promise<Result> {
  if (!isUuid(b.id) || typeof b.query !== "string") return bad();
  const box = checkMergeBox(b.query);
  if (box.errors.length) return fieldFail(box.errors);
  const r = await searchPatients(a.clinicId, { kanaWords: box.kanaWords, phoneOrCard: box.phoneOrCard }, b.id, a.now);
  return done({ rows: r.rows, code: r.rows.length === 0 ? "SI033" : r.over ? "SI034" : null });
}

// ── 抽出2–6, 9: detail ─────────────────────────────────────────────────────────────────────────────────────────────

export type CardRow = { clinicId: string; clinicName: string; cardNo: string; stored: boolean; confirmed: boolean; editable: boolean; updatedAt: string | null };
export type BookingRow = {
  id: string; when: string; bookingNo: string; clinicName: string; status: string; channel: string; reason: string | null; questionnaire: boolean; mine: boolean;
  date: string; clinicId: string;
};
export type NoticeRow = { id: string; event: string; channel: string; status: string; queued: string; sent: string; attempts: number; error: string };

// cap: S03 booking / notification history rows shown (質疑 pending) — Q19 a settles "all rows"; newest first, the rest not shown
export const DETAIL_ROWS_MAX = 500;

/** Q19 b: slot_date from today minus 6 calendar months */
function sixMonthsBefore(today: string) {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 6);
  return toIsoDate(d);
}

const staffOf = async (a: { accountId: string }) => {
  const acc = await prisma.account.findUniqueOrThrow({ where: { id: a.accountId }, select: { id: true, role: true, allClinics: true } });
  return staffClinics(acc);
};

/** null = unknown or anonymised id (ER-02, Q14) */
export async function loadDetail(patientId: string, viewer: { accountId: string }, now = new Date()) {
  if (!isUuid(patientId)) return null;
  const p = await prisma.patient.findUnique({
    where: { id: patientId },
    include: { account: { include: { consents: { orderBy: { agreedAt: "desc" } } } }, mergedInto: { select: { id: true, familyName: true, givenName: true, birthDate: true } } },
  });
  if (!p || p.anonymizedAt) return null;
  const today = todayJst(now);
  const birth = toIsoDate(p.birthDate);
  const mine = await staffOf(viewer);
  const mineIds = new Set(mine.map((c) => c.id));
  const [family, cards, clinics, bookings, notices] = await Promise.all([
    p.accountId
      ? prisma.patient.findMany({ where: { accountId: p.accountId, mergedIntoId: null, anonymizedAt: null }, orderBy: { createdAt: "asc" } })
      : Promise.resolve([p]),
    prisma.patientCard.findMany({ where: { patientId } }),
    prisma.clinic.findMany({ orderBy: { displayOrder: "asc" }, select: { id: true, nameJa: true, isActive: true } }),
    prisma.booking.findMany({
      where: { patientId }, orderBy: [{ slotDate: "desc" }, { startTime: "desc" }], take: DETAIL_ROWS_MAX,
      select: { id: true, slotDate: true, startTime: true, bookingNo: true, clinicId: true, status: true, channel: true, cancelReasonCode: true, questionnaire: { select: { bookingId: true } } },
    }),
    // Q13: rows of the patient, or of a booking of the patient
    prisma.notification.findMany({ where: { OR: [{ patientId }, { booking: { patientId } }] }, orderBy: { queuedAt: "desc" }, take: DETAIL_ROWS_MAX }),
  ]);
  const noShowWhere = { patientId, status: "NO_SHOW" as const };
  const [noShowTotal, noShowRecent] = await Promise.all([
    prisma.booking.count({ where: noShowWhere }),
    prisma.booking.count({ where: { ...noShowWhere, slotDate: { gte: dbDate(sixMonthsBefore(todayJst(now))) } } }),
  ]);
  const cardRows: CardRow[] = clinics.flatMap((c) => {
    const card = cards.find((x) => x.clinicId === c.id);
    const editable = mineIds.has(c.id) && c.isActive && !p.mergedIntoId;
    if (!card && !editable) return [];
    return [{
      clinicId: c.id, clinicName: c.nameJa, cardNo: card?.cardNo ?? "", stored: !!card, confirmed: !!card?.confirmedAt, editable,
      updatedAt: card ? card.updatedAt.toISOString() : null,
    }];
  });
  const clinicName = new Map(clinics.map((c) => [c.id, c.nameJa]));
  const gaiji = [p.familyName, p.givenName, p.familyNameKana, p.givenNameKana, p.prefecture, p.city, p.town ?? "", p.addressLine, p.building ?? ""].some((t) => toCp932Safe(t).replaced);
  const a = p.account;
  const profile: ProfileValues = {
    nameType: p.nameType, familyName: p.familyName, givenName: p.givenName, familyNameKana: p.familyNameKana, givenNameKana: p.givenNameKana,
    birthDate: slash(birth), sex: p.sex === "FEMALE" ? "2" : "1", postcode: p.postcode, prefecture: p.prefecture, city: p.city, town: p.town ?? "",
    addressLine: p.addressLine, building: p.building ?? "", phone: p.phone ? formatPhone(p.phone) : "", smsOptIn: p.smsOptIn,
  };
  return {
    id: p.id, updatedAt: p.updatedAt.toISOString(), accountId: p.accountId, relation: p.relation,
    merged: p.mergedInto ? { id: p.mergedInto.id, name: nameOf(p.mergedInto), birth: slash(toIsoDate(p.mergedInto.birthDate)) } : null,
    header: {
      name: nameOf(p), kana: `${p.familyNameKana} ${p.givenNameKana}`, birth: `${Number(birth.slice(0, 4))}年${Number(birth.slice(5, 7))}月${Number(birth.slice(8, 10))}日`,
      age: ageOn(birth, today), sex: SEX_LABEL[p.sex],
    },
    tags: { web: !!p.accountId, bounced: !!a?.emailBouncedAt, gaiji, merged: !!p.mergedIntoId },
    profile,
    phoneRequired: p.relation === "SELF" || !p.accountId,
    smsEditable: !p.accountId,
    account: a ? {
      email: a.email, status: ACCOUNT_STATUS_LABEL[a.status], channel: a.notifyChannel ? NOTIFY_CHANNEL_LABEL[a.notifyChannel] : "", language: LANGUAGE_LABEL[a.language],
      lastLogin: stamp(a.lastLoginAt),
    } : null,
    consents: (a?.consents ?? []).map((c) => ({ kind: c.kind, version: c.version, at: stamp(c.agreedAt) })),
    family: family
      .sort((x, y) => Number(y.relation === "SELF") - Number(x.relation === "SELF"))
      .map((m) => ({ id: m.id, name: nameOf(m), relation: m.relation ?? "", birth: slash(toIsoDate(m.birthDate)), current: m.id === p.id })),
    cards: cardRows,
    bookings: bookings.map((b): BookingRow => ({
      id: b.id, when: bookingWhen(toIsoDate(b.slotDate), toHhmm(b.startTime)), bookingNo: `${b.bookingNo.slice(0, 4)}-${b.bookingNo.slice(4)}`,
      clinicName: clinicName.get(b.clinicId) ?? "", status: b.status, channel: b.channel, reason: b.status === "CANCELED" ? b.cancelReasonCode : null,
      questionnaire: !!b.questionnaire, mine: mineIds.has(b.clinicId), date: toIsoDate(b.slotDate), clinicId: b.clinicId,
    })),
    noShow: { total: noShowTotal, recent: noShowRecent },
    notifications: notices.map((n): NoticeRow => ({
      id: n.id, event: n.event, channel: n.channel, status: n.status, queued: shortStamp(n.queuedAt), sent: shortStamp(n.sentAt), attempts: n.attempts, error: n.lastError ?? "",
    })),
  };
}
export type PatientDetail = NonNullable<Awaited<ReturnType<typeof loadDetail>>>;

/** 更新9: PATIENT_VIEW (N-PI-05) */
export const viewAudit = (a: { accountId: string; role: Actor["role"]; ip: string | null; clinicId: string | null }, patientId: string, now = new Date()) =>
  audit(prisma, { accountId: a.accountId, role: a.role, action: "PATIENT_VIEW", ip: a.ip, now, targetType: "patient", targetId: patientId, clinicId: a.clinicId });

const changeAudit = (tx: Db, a: Actor, action: string, targetType: string, targetId: string, detail: Prisma.InputJsonValue) =>
  audit(tx, { accountId: a.accountId, role: a.role, action, ip: a.ip, now: a.now, targetType, targetId, clinicId: a.clinicId, detail });

// ── event 6: profile and cards ─────────────────────────────────────────────────────────────────────────────────────

class Answer extends Error {
  constructor(readonly result: Result) {
    super("answer");
  }
}
const stop = (r: Result): never => {
  throw new Answer(r);
};

const PROFILE_COLUMN: Record<string, string> = {
  nameType: "name_type", familyName: "family_name", givenName: "given_name", familyNameKana: "family_name_kana", givenNameKana: "given_name_kana",
  birthDate: "birth_date", sex: "sex", postcode: "postcode", prefecture: "prefecture", city: "city", town: "town", addressLine: "address_line",
  building: "building", phone: "phone", smsOptIn: "sms_opt_in",
};

function profileOf(b: unknown): ProfileValues | null {
  if (!b || typeof b !== "object") return null;
  const o = b as Record<string, unknown>;
  const keys = Object.keys(PROFILE_COLUMN).filter((k) => k !== "smsOptIn");
  if (keys.some((k) => typeof o[k] !== "string" || (o[k] as string).length > 500) || typeof o.smsOptIn !== "boolean") return null;
  return o as unknown as ProfileValues;
}
function cardsOf(b: unknown): Array<CardValue & { updatedAt: string | null }> | null {
  if (!Array.isArray(b) || b.length > 50) return null;
  const ok = b.every((c) => c && isUuid(c.clinicId) && typeof c.cardNo === "string" && c.cardNo.length <= 100 && (c.updatedAt === null || typeof c.updatedAt === "string"));
  return ok ? b.map((c) => ({ clinicId: c.clinicId, cardNo: c.cardNo, updatedAt: c.updatedAt, stored: c.updatedAt !== null })) : null;
}

/** pre-read outside the lock: unknown / anonymised → ER-02, merged → SE031 */
async function editable(id: unknown) {
  if (!isUuid(id)) return stop(bad());
  const p = await prisma.patient.findUnique({ where: { id } });
  if (!p || p.anonymizedAt) return stop(bad());
  if (p.mergedIntoId) return stop(fail(409, "SE031"));
  return p;
}
async function lockEditable(tx: Tx, id: string) {
  try {
    await lockPerson(tx, id);
  } catch {
    return stop(fail(409, "SE031")); // merged meanwhile
  }
}

export async function saveProfile(a: Actor, b: Record<string, unknown>): Promise<Result> {
  try {
    const before = await editable(b.id);
    const v = profileOf(b.profile);
    const cards = cardsOf(b.cards);
    if (!v || !cards || typeof b.updatedAt !== "string" || profileTampered(v)) return bad();
    const mine = new Set((await staffOf(a)).map((c) => c.id));
    if (cards.some((c) => !mine.has(c.clinicId))) return bad(); // 6-6: a clinic not the staff's
    if (before.accountId && v.smsOptIn !== before.smsOptIn) return bad(); // 6-6: sms_opt_in of a web member
    const errors = [...checkProfile(v, { phoneRequired: before.relation === "SELF" || !before.accountId, now: a.now }), ...checkCards(cards)];
    if (errors.length) return fieldFail(errors);

    const kanaOf = (s: string) => (v.nameType === "JP" ? fullWidthSpaces(s.trim()) : s.trim()); // Q-021
    const data = {
      nameType: v.nameType as "JP" | "ROMAJI", familyName: v.familyName.trim(), givenName: v.givenName.trim(), familyNameKana: kanaOf(v.familyNameKana),
      givenNameKana: kanaOf(v.givenNameKana), birthDate: dbDate(slashDate(v.birthDate)!), sex: (v.sex === "2" ? "FEMALE" : "MALE") as "FEMALE" | "MALE",
      postcode: digitsOnly(v.postcode), prefecture: v.prefecture, city: v.city.trim(), town: v.town.trim() || null, addressLine: v.addressLine.trim(),
      building: v.building.trim() || null, phone: digitsOnly(v.phone) || null, smsOptIn: v.smsOptIn,
    };
    await prisma.$transaction(async (tx) => {
      await lockEditable(tx, before.id);
      const p = await tx.patient.findUniqueOrThrow({ where: { id: before.id } });
      if (p.updatedAt.toISOString() !== b.updatedAt) stop(fail(409, "SE010")); // 6-5 (Q8)
      const cols = Object.keys(PROFILE_COLUMN).filter((k) => {
        const x = (p as Record<string, unknown>)[k];
        const y = (data as Record<string, unknown>)[k];
        return x instanceof Date && y instanceof Date ? x.getTime() !== y.getTime() : x !== y;
      });
      const cardCols: string[] = [];
      for (const c of cards) {
        const no = c.cardNo.trim();
        if (!no) continue;
        const stored = await tx.patientCard.findUnique({ where: { patientId_clinicId: { patientId: p.id, clinicId: c.clinicId } } });
        if (stored?.cardNo === no) continue;
        if (stored && stored.updatedAt.toISOString() !== c.updatedAt) stop(fail(409, "SE010"));
        if (!stored && c.updatedAt !== null) stop(fail(409, "SE010")); // the row was deleted / never existed
        const held = await tx.patientCard.findUnique({ where: { clinicId_cardNo: { clinicId: c.clinicId, cardNo: no } } });
        if (held && held.patientId !== p.id) stop(fail(409, "SE030"));
        const write = { cardNo: no, enteredByKind: "STAFF" as const, confirmedAt: a.now };
        if (stored) await tx.patientCard.update({ where: { patientId_clinicId: { patientId: p.id, clinicId: c.clinicId } }, data: write });
        else await tx.patientCard.create({ data: { patientId: p.id, clinicId: c.clinicId, ...write } });
        cardCols.push(c.clinicId);
      }
      if (cols.length) await tx.patient.update({ where: { id: p.id }, data });
      if (cols.length || cardCols.length) {
        await changeAudit(tx, a, "PATIENT_UPDATE", "patient", p.id, { columns: cols.map((k) => PROFILE_COLUMN[k]), ...(cardCols.length && { cards: cardCols }) });
      }
    });
    return done({ code: "SI030" });
  } catch (e) {
    if (e instanceof Answer) return e.result;
    if (isUniqueViolation(e)) return fail(409, "SE030"); // a card number taken by a concurrent save
    throw e;
  }
}

// ── event 7: confirm a card ────────────────────────────────────────────────────────────────────────────────────────

export async function confirmCard(a: Actor, b: Record<string, unknown>): Promise<Result> {
  try {
    const p = await editable(b.id);
    if (!isUuid(b.clinicId) || typeof b.updatedAt !== "string") return bad();
    if (!(await staffOf(a)).some((c) => c.id === b.clinicId)) return bad();
    const key = { patientId_clinicId: { patientId: p.id, clinicId: b.clinicId } };
    await prisma.$transaction(async (tx) => {
      await lockEditable(tx, p.id);
      const card = await tx.patientCard.findUnique({ where: key });
      if (!card) stop(bad());
      if (card!.confirmedAt || card!.updatedAt.toISOString() !== b.updatedAt) stop(fail(409, "SE010")); // 7-2
      await tx.patientCard.update({ where: key, data: { confirmedAt: a.now } });
      await changeAudit(tx, a, "PATIENT_UPDATE", "patient", p.id, { columns: ["patient_cards.confirmed_at"], cards: [b.clinicId as string] });
    });
    return done({ code: "SI030" });
  } catch (e) {
    if (e instanceof Answer) return e.result;
    throw e;
  }
}

// ── event 8: 問診 ───────────────────────────────────────────────────────────────────────────────────────────────────

export async function openQuestionnaire(a: Actor, b: Record<string, unknown>): Promise<Result> {
  if (!isUuid(b.id) || !isUuid(b.bookingId)) return bad();
  const bk = await prisma.booking.findFirst({
    where: { id: b.bookingId, patientId: b.id },
    include: { questionnaire: true, department: { select: { nameJa: true } }, visitType: { select: { nameJa: true } } },
  });
  if (!bk?.questionnaire || !(await staffOf(a)).some((c) => c.id === bk.clinicId)) return bad(); // 8-2
  const answers = decryptJson(bk.questionnaire.answers);
  await changeAudit(prisma, a, "QUESTIONNAIRE_VIEW", "booking", bk.id, {}); // no 問診 content (N-OPS-07)
  const date = toIsoDate(bk.slotDate);
  return done({
    questionnaire: {
      title: `問診 — ${date.slice(5, 7)}/${date.slice(8, 10)} ${bk.department.nameJa} ${bk.visitType.nameJa}`,
      language: bk.questionnaire.language.toLowerCase(),
      // labels and choice texts of 10 (Q21), from the P12 form definition
      answers: answerRows(answers).map((r) => ({ key: r.question, value: r.answer })),
    },
  });
}

// ── event 9: merge ─────────────────────────────────────────────────────────────────────────────────────────────────

type MergeCard = { kind: string; name: string; birth: string; cards: string[]; web: boolean };

async function mergeCards(id: string): Promise<MergeCard> {
  const p = await prisma.patient.findUniqueOrThrow({ where: { id }, include: { cards: { include: { clinic: { select: { nameJa: true } } } } } });
  return { kind: kindLabel(p), name: nameOf(p), birth: slash(toIsoDate(p.birthDate)), cards: p.cards.map((c) => `${c.clinic.nameJa} ${c.cardNo}`), web: !!p.accountId };
}

/** 9-1 (SE032) before 9-2 (SE033), Q23 a */
function refusal(src: { accountId: string | null; cards: { clinicId: string; cardNo: string }[] }, dst: { accountId: string | null; cards: { clinicId: string; cardNo: string }[] }) {
  if (src.cards.some((c) => dst.cards.some((d) => d.clinicId === c.clinicId && d.cardNo !== c.cardNo))) return "SE032";
  if (src.accountId && dst.accountId) return "SE033";
  return null;
}

/** first press of 統合する: refusal, or the dialog data (cards, SW030 names, the updated_at of both records read now) */
export async function mergeCheck(a: Actor, b: Record<string, unknown>): Promise<Result> {
  try {
    const src = await editable(b.id);
    if (!isUuid(b.targetId) || b.targetId === src.id) return bad();
    const dst = await prisma.patient.findUnique({ where: { id: b.targetId } });
    if (!dst || dst.mergedIntoId || dst.anonymizedAt) return bad(); // 9-7: not a candidate
    const [sc, dc] = await Promise.all([prisma.patientCard.findMany({ where: { patientId: src.id } }), prisma.patientCard.findMany({ where: { patientId: dst.id } })]);
    const r = refusal({ ...src, cards: sc }, { ...dst, cards: dc });
    if (r) return fail(409, r);
    return done({
      confirm: "SW030", params: { 統合元: nameOf(src), 統合先: nameOf(dst) }, source: await mergeCards(src.id), target: await mergeCards(dst.id),
      sourceUpdatedAt: src.updatedAt.toISOString(), targetUpdatedAt: dst.updatedAt.toISOString(),
    });
  } catch (e) {
    if (e instanceof Answer) return e.result;
    throw e;
  }
}

/** はい (9-4): one transaction under the locks of both persons (lower id first), every check of 9-1, 9-2, 9-6, 9-7 again */
export async function merge(a: Actor, b: Record<string, unknown>): Promise<Result> {
  try {
    const src0 = await editable(b.id);
    if (!isUuid(b.targetId) || b.targetId === src0.id || typeof b.sourceUpdatedAt !== "string" || typeof b.targetUpdatedAt !== "string") return bad();
    const targetId = b.targetId;
    const moved = await prisma.$transaction(async (tx) => {
      for (const id of [src0.id, targetId].sort()) {
        try {
          await lockPerson(tx, id);
        } catch {
          stop(id === src0.id ? fail(409, "SE031") : fail(409, "SE010")); // source merged meanwhile / target merged or anonymised meanwhile (Q23 b)
        }
      }
      const src = await tx.patient.findUniqueOrThrow({ where: { id: src0.id }, include: { cards: true } });
      const dst = await tx.patient.findUnique({ where: { id: targetId }, include: { cards: true } });
      if (!dst) return stop(bad());
      if (src.updatedAt.toISOString() !== b.sourceUpdatedAt || dst.updatedAt.toISOString() !== b.targetUpdatedAt) stop(fail(409, "SE010")); // 9-6
      const r = refusal(src, dst);
      if (r) stop(fail(409, r));

      // 更新4: bookings of the source, each locked (person → booking order kept), version + 1
      const bookings = await tx.booking.findMany({ where: { patientId: src.id }, select: { id: true }, orderBy: { id: "asc" } });
      for (const bk of bookings) await lockBooking(tx, bk.id);
      await tx.booking.updateMany({ where: { patientId: src.id }, data: { patientId: dst.id, version: { increment: 1 } } });
      // 更新5 / 6
      await tx.patientCard.updateMany({ where: { patientId: src.id }, data: { patientId: dst.id } });
      await tx.notification.updateMany({ where: { patientId: src.id }, data: { patientId: dst.id } });
      // 更新7 (Q6): the account moves only when the source alone has one; cleared on the source first (one SELF per account)
      const moveAccount = !!src.accountId && !dst.accountId;
      await tx.patient.update({ where: { id: src.id }, data: { mergedIntoId: dst.id, ...(moveAccount && { accountId: null, relation: null }) } });
      if (moveAccount) await tx.patient.update({ where: { id: dst.id }, data: { accountId: src.accountId, relation: src.relation } });
      // 更新10
      await changeAudit(tx, a, "PATIENT_MERGE", "patient", dst.id, { source: src.id, bookings: bookings.length, accountMoved: moveAccount });
      for (const bk of bookings) await changeAudit(tx, a, "BOOKING_UPDATE", "booking", bk.id, { columns: ["patient_id", "version"], source: src.id });
      return bookings.length;
    }, { timeout: 30_000 });
    return done({ code: "SI031", moved });
  } catch (e) {
    if (e instanceof Answer) return e.result;
    throw e;
  }
}

// ── event 12: disclosure request ───────────────────────────────────────────────────────────────────────────────────

export async function requestDisclosure(a: Actor, b: Record<string, unknown>): Promise<Result> {
  if (a.role !== "ADMIN") return fail(403, "SE091"); // 12-4
  if (!isUuid(b.id)) return bad();
  const p = await prisma.patient.findUnique({ where: { id: b.id } });
  if (!p || p.anonymizedAt || p.mergedIntoId) return bad(); // 31 is hidden for a merged record (Q26)
  const t = jst(a.now);
  const fileName = `DISCLOSURE_${p.id}_${t.slice(0, 4)}${t.slice(5, 7)}${t.slice(8, 10)}${t.slice(11, 13)}${t.slice(14, 16)}.zip`;
  const row = await prisma.$transaction(async (tx) => {
    const f = await tx.exportFile.create({
      data: { clinicId: a.clinicId, kind: "DISCLOSURE", trigger: "MANUAL", status: "BUILDING", patientId: p.id, fileName, createdBy: a.accountId },
    });
    await changeAudit(tx, a, "DISCLOSURE_REQUEST", "patient", p.id, { exportFileId: f.id });
    return f;
  });
  startDisclosureBuild(row.id); // after the commit; the answer does not wait (lib/export/disclosure.ts)
  return done({ code: "SI032", exportFileId: row.id });
}
