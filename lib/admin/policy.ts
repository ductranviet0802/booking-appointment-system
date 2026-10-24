// spec-screen: A04
// A04 通知テンプレート・キャンセルポリシー: reads (抽出1–5), preview (event 4), template save (events 6 / 7, 更新1 / 2) and
// policy save (event 8, 更新3 / 4 / 5). Concurrent first saves of one key: INSERT … ON CONFLICT DO NOTHING, then the row is
// locked and updated, so the later request wins (更新1 / 更新3 "last save wins") and the unique key keeps one row.
import type { BookingPolicy, Prisma } from "@prisma/client";
import { bad, done, fail, fieldFail, masterAudit, type Actor, type Db } from "@/lib/admin/common";
import {
  CHANNELS, channelsOf, charCount, EVENTS, FRAME_MINUTES, LANGUAGES, SMS_LIMIT, fillPreview, sampleVars, unknownPlaceholders, validatePolicy,
  validateTemplate, type ChannelCode, type DeadlineType, type EventCode, type LanguageCode, type PolicyValues,
} from "@/lib/admin/policy-rules";
import type { Result } from "@/lib/auth/service";
import { runJob } from "@/lib/batch/runner";
import { addDays, dbTime, todayJst, toHhmm, toIsoDate } from "@/lib/datetime";
import { formatDate } from "@/lib/i18n/format";
import type { Lang } from "@/lib/i18n";
import { prisma } from "@/lib/prisma";
import { formatPhone } from "@/lib/public/phone";
import { nameOf } from "@/lib/public/text";

// ── reading the request ────────────────────────────────────────────────────────────────────────────────────────────

export type Combo = { event: EventCode; channel: ChannelCode; language: LanguageCode };

/** 2-4: event, channel, language among the options and the channel supported by the event; else null (ER-02) */
export function comboOf(v: Record<string, unknown>): Combo | null {
  const { event, channel, language } = v;
  if (!(EVENTS as readonly unknown[]).includes(event) || !(CHANNELS as readonly unknown[]).includes(channel) || !(LANGUAGES as readonly unknown[]).includes(language)) return null;
  if (!channelsOf(event as EventCode).includes(channel as ChannelCode)) return null;
  return { event, channel, language } as Combo;
}

const text = (v: unknown) => (typeof v === "string" ? v : null);

// ── 抽出1–5 ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type TemplateRow = { subject: string; body: string; exists: boolean };

/** 抽出1: the stored text of the combination, empty when there is no row (2-2, Q6) */
export async function loadTemplate(clinicId: string, c: Combo): Promise<TemplateRow> {
  const r = await prisma.notificationTemplate.findUnique({ where: { clinicId_event_channel_language: { clinicId, ...c } } });
  return { subject: r?.subject ?? "", body: r?.body ?? "", exists: !!r };
}

/** the policy row as the form shows it; no row → the 03 §3.12 defaults (1-3, Q13) */
export type PolicyForm = PolicyValues & { stored: boolean };

const hm = (d: Date | null) => (d ? toHhmm(d) : "");
function formOf(r: BookingPolicy | null): PolicyForm {
  if (!r) {
    return {
      stored: false, frameMinutes: 15, frameCapacity: "1", bookingWindowDays: "30", sameDayCutoffMinutes: "30", cancelDeadlineType: "PREV_DAY_TIME",
      cancelDeadlineTime: "23:59", cancelDeadlineHours: "", perPersonDailyLimit: "1", reminderTime: "10:00", phoneMessageJa: "", phoneMessageEn: "", phoneMessageVi: "",
    };
  }
  return {
    stored: true, frameMinutes: r.frameMinutes, frameCapacity: String(r.frameCapacity), bookingWindowDays: String(r.bookingWindowDays),
    sameDayCutoffMinutes: String(r.sameDayCutoffMinutes), cancelDeadlineType: r.cancelDeadlineType === "HOURS_BEFORE" ? "HOURS_BEFORE" : "PREV_DAY_TIME",
    cancelDeadlineTime: hm(r.cancelDeadlineTime), cancelDeadlineHours: r.cancelDeadlineHours === null ? "" : String(r.cancelDeadlineHours),
    perPersonDailyLimit: String(r.perPersonDailyLimit), reminderTime: hm(r.reminderTime), phoneMessageJa: r.phoneMessageJa,
    phoneMessageEn: r.phoneMessageEn ?? "", phoneMessageVi: r.phoneMessageVi ?? "",
  };
}

export const loadPolicy = async (clinicId: string) => formOf(await prisma.bookingPolicy.findUnique({ where: { clinicId } }));

/** 抽出3: LINE pushes sent in the current JST calendar month, all clinics of the group (Q2) */
export function lineCount(now = new Date()) {
  const first = new Date(`${todayJst(now).slice(0, 8)}01T00:00:00+09:00`);
  return prisma.notification.count({ where: { channel: "LINE", sentAt: { gte: first, lte: now } } });
}

/** 抽出5: the latest slot_date of the clinic + 1 day, today when the clinic has no frame (Q11) */
export async function firstDateWithoutFrames(db: Db | typeof prisma, clinicId: string, now = new Date()) {
  const r = await db.slot.aggregate({ where: { clinicId }, _max: { slotDate: true } });
  return r._max.slotDate ? addDays(toIsoDate(r._max.slotDate), 1) : todayJst(now);
}

export type PolicyState = { template: TemplateRow; policy: PolicyForm; lineCount: number };

/** event 1: NT-01 × メール × 日本語, the policy row, the LINE count */
export async function loadState(clinicId: string, now = new Date()): Promise<PolicyState> {
  const [template, policy, n] = await Promise.all([
    loadTemplate(clinicId, { event: "NT01_BOOKED", channel: "MAIL", language: "JA" }), loadPolicy(clinicId), lineCount(now),
  ]);
  return { template, policy, lineCount: n };
}

// ── event 4: the preview ───────────────────────────────────────────────────────────────────────────────────────────

async function render(a: Actor, c: Combo, subject: string, body: string) {
  const clinic = await prisma.clinic.findUnique({ where: { id: a.clinicId } });
  if (!clinic) return null;
  const vars = sampleVars({
    language: c.language, channel: c.channel, today: todayJst(a.now), clinicName: nameOf(clinic, c.language.toLowerCase() as Lang), clinicPhone: formatPhone(clinic.phone),
  });
  const renderedBody = fillPreview(body, vars);
  return { subject: c.channel === "MAIL" ? fillPreview(subject, vars) : null, body: renderedBody, count: charCount(renderedBody) };
}

/** event 4: nothing is written, no check, an unknown `{{name}}` stays as typed (Q7); count = characters after expansion (Q8) */
export async function preview(a: Actor, b: Record<string, unknown>): Promise<Result> {
  const c = comboOf(b);
  const subject = text(b.subject);
  const body = text(b.body);
  if (!c || subject === null || body === null) return bad();
  const r = await render(a, c, subject, body);
  if (!r) return bad();
  return done({ preview: { subject: r.subject, body: r.body, count: c.channel === "SMS" ? r.count : null } });
}

/** load a combination (event 2) */
export async function template(a: Actor, q: Record<string, unknown>): Promise<Result> {
  const c = comboOf(q);
  if (!c) return bad();
  return done({ template: await loadTemplate(a.clinicId, c) });
}

// ── events 6 / 7: the template save ────────────────────────────────────────────────────────────────────────────────

const TEMPLATE_INSERT_COLS = ["id", "clinic_id", "event", "channel", "language", "subject", "body"];

export async function saveTemplate(a: Actor, b: Record<string, unknown>): Promise<Result> {
  const c = comboOf(b);
  const subjectIn = text(b.subject);
  const body = text(b.body);
  if (!c || subjectIn === null || body === null) return bad();
  const subject = c.channel === "MAIL" ? subjectIn : "";
  const errors = validateTemplate(c.channel, { subject, body });
  const unknown = unknownPlaceholders(c.event, subject, body);
  if (unknown) errors.push({ field: unknownPlaceholders(c.event, body) ? "body" : "subject", code: "SE060", params: { 項目: unknown } });
  if (errors.length > 0) return fieldFail(errors);
  if (c.channel === "SMS" && b.confirmed !== true) {
    const r = await render(a, c, "", body);
    if (!r) return bad();
    if (r.count > SMS_LIMIT) return done({ confirm: "SW061", params: { n: r.count } });
  }

  const key = { clinicId: a.clinicId, ...c };
  const data = { subject: c.channel === "MAIL" ? subject : null, body };
  await prisma.$transaction(async (tx) => {
    const ins = await tx.notificationTemplate.createMany({ data: [{ ...key, ...data, updatedBy: a.accountId }], skipDuplicates: true });
    const row = await lockedTemplate(tx, key);
    if (ins.count === 1) return masterAudit(tx, a, "notification_templates", row.id, TEMPLATE_INSERT_COLS);
    const cols = [...(row.subject !== data.subject ? ["subject"] : []), ...(row.body !== data.body ? ["body"] : [])];
    if (cols.length === 0) return; // 7-2: no UPDATE, no audit row
    await tx.notificationTemplate.update({ where: { id: row.id }, data: { ...data, updatedBy: a.accountId } });
    await masterAudit(tx, a, "notification_templates", row.id, cols);
  });
  return done({ code: "SI060", template: await loadTemplate(a.clinicId, c) });
}

async function lockedTemplate(tx: Db, k: { clinicId: string } & Combo) {
  const [row] = await tx.$queryRaw<{ id: string; subject: string | null; body: string }[]>`
    SELECT id::text, subject, body FROM notification_templates
     WHERE clinic_id = ${k.clinicId}::uuid AND event = ${k.event}::notification_event AND channel = ${k.channel}::notify_channel
       AND language = ${k.language}::language FOR UPDATE`;
  return row;
}

// ── event 8: the policy save ───────────────────────────────────────────────────────────────────────────────────────

const POLICY_COLUMN = {
  frameMinutes: "frame_minutes", frameCapacity: "frame_capacity", bookingWindowDays: "booking_window_days", sameDayCutoffMinutes: "same_day_cutoff_minutes",
  cancelDeadlineType: "cancel_deadline_type", cancelDeadlineTime: "cancel_deadline_time", cancelDeadlineHours: "cancel_deadline_hours",
  perPersonDailyLimit: "per_person_daily_limit", reminderTime: "reminder_time", phoneMessageJa: "phone_message_ja", phoneMessageEn: "phone_message_en",
  phoneMessageVi: "phone_message_vi",
} as const;
type PolicyKey = keyof typeof POLICY_COLUMN;

/** the request as PolicyValues, or null for a value the UI cannot produce (items 10, 14; 8-6) */
function policyValuesOf(b: Record<string, unknown>): PolicyValues | null {
  const strings = ["frameCapacity", "bookingWindowDays", "sameDayCutoffMinutes", "cancelDeadlineTime", "cancelDeadlineHours", "perPersonDailyLimit", "reminderTime", "phoneMessageJa", "phoneMessageEn", "phoneMessageVi"] as const;
  if (!(FRAME_MINUTES as readonly unknown[]).includes(b.frameMinutes)) return null;
  if (b.cancelDeadlineType !== "PREV_DAY_TIME" && b.cancelDeadlineType !== "HOURS_BEFORE") return null;
  if (strings.some((k) => typeof b[k] !== "string" || (b[k] as string).length > 2_000)) return null;
  return Object.fromEntries([...strings.map((k) => [k, b[k]]), ["frameMinutes", b.frameMinutes], ["cancelDeadlineType", b.cancelDeadlineType]]) as PolicyValues;
}

/** stored shape of the checked form: the field of the other deadline type keeps its stored value (Q14) */
function rowValues(v: PolicyValues, stored: PolicyForm) {
  const nul = (s: string) => (s.trim() === "" ? null : s);
  const prev = v.cancelDeadlineType === "PREV_DAY_TIME";
  return {
    frameMinutes: v.frameMinutes, frameCapacity: Number(v.frameCapacity.trim()), bookingWindowDays: Number(v.bookingWindowDays.trim()),
    sameDayCutoffMinutes: Number(v.sameDayCutoffMinutes.trim()), cancelDeadlineType: v.cancelDeadlineType as DeadlineType,
    cancelDeadlineTime: prev ? v.cancelDeadlineTime.trim() : nul(stored.cancelDeadlineTime),
    cancelDeadlineHours: prev ? (stored.cancelDeadlineHours === "" ? null : Number(stored.cancelDeadlineHours)) : Number(v.cancelDeadlineHours.trim()),
    perPersonDailyLimit: Number(v.perPersonDailyLimit.trim()), reminderTime: v.reminderTime.trim(), phoneMessageJa: v.phoneMessageJa,
    phoneMessageEn: nul(v.phoneMessageEn), phoneMessageVi: nul(v.phoneMessageVi),
  };
}
type RowValues = ReturnType<typeof rowValues>;

function storedValues(f: PolicyForm): RowValues {
  return {
    frameMinutes: f.frameMinutes, frameCapacity: Number(f.frameCapacity), bookingWindowDays: Number(f.bookingWindowDays),
    sameDayCutoffMinutes: Number(f.sameDayCutoffMinutes), cancelDeadlineType: f.cancelDeadlineType, cancelDeadlineTime: f.cancelDeadlineTime || null,
    cancelDeadlineHours: f.cancelDeadlineHours === "" ? null : Number(f.cancelDeadlineHours), perPersonDailyLimit: Number(f.perPersonDailyLimit),
    reminderTime: f.reminderTime, phoneMessageJa: f.phoneMessageJa, phoneMessageEn: f.phoneMessageEn || null, phoneMessageVi: f.phoneMessageVi || null,
  };
}

const dbData = (v: RowValues) => ({
  ...v, cancelDeadlineTime: v.cancelDeadlineTime === null ? null : dbTime(v.cancelDeadlineTime), reminderTime: dbTime(v.reminderTime),
}) satisfies Partial<Prisma.BookingPolicyUncheckedCreateInput>;

export async function savePolicy(a: Actor, b: Record<string, unknown>): Promise<Result> {
  const v = policyValuesOf(b);
  if (!v) return bad();
  const errors = validatePolicy(v);
  if (errors.length > 0) return fieldFail(errors); // 8-4: SW062 is not asked while an error exists

  const before = await loadPolicy(a.clinicId);
  const want = rowValues(v, before);
  if (before.stored && want.frameMinutes !== before.frameMinutes && b.confirmed !== true) {
    return done({ confirm: "SW062", params: { 日付: formatDate(await firstDateWithoutFrames(prisma, a.clinicId, a.now), "ja") } });
  }

  const windowChanged = await prisma.$transaction(async (tx) => {
    const ins = await tx.bookingPolicy.createMany({ data: [{ clinicId: a.clinicId, ...dbData(want), updatedBy: a.accountId }], skipDuplicates: true });
    if (ins.count === 1) {
      await masterAudit(tx, a, "booking_policies", a.clinicId, ["clinic_id", ...Object.values(POLICY_COLUMN)]);
      return want.bookingWindowDays !== 30; // the row starts from the 03 default window (B2 used it so far)
    }
    await tx.$queryRaw`SELECT 1 FROM booking_policies WHERE clinic_id = ${a.clinicId}::uuid FOR UPDATE`;
    const stored = storedValues(formOf(await tx.bookingPolicy.findUniqueOrThrow({ where: { clinicId: a.clinicId } })));
    const changed = (Object.keys(POLICY_COLUMN) as PolicyKey[]).filter((k) => stored[k] !== want[k]);
    if (changed.length === 0) return false; // 8-3
    await tx.bookingPolicy.update({ where: { clinicId: a.clinicId }, data: { ...dbData(want), updatedBy: a.accountId } });
    await masterAudit(tx, a, "booking_policies", a.clinicId, changed.map((k) => POLICY_COLUMN[k]));
    return changed.includes("bookingWindowDays");
  });

  const policy = await loadPolicy(a.clinicId);
  if (!windowChanged) return done({ code: "SI060", policy });
  // 更新5: B2 (EVENT) after the commit, default range of the clinic; a failure keeps the policy saved (8-5)
  const run = await runJob("B2", { trigger: "EVENT", clinicId: a.clinicId });
  if (run.result.status !== "SUCCESS" || run.result.message === "実行中のため省略") return fail(409, "SE044", undefined, undefined);
  return done({ code: "SI060", policy });
}
