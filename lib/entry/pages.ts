// spec-screen: P11
// Initial display (event 1) of P11, P12 and P13: presets, draft restore, change mode, the return messages; each loader
// answers what the page renders, or where it goes instead (ER-01 = notFound, a redirect).
import type { SessionContext } from "@/lib/auth/context";
import { getDraft, type Draft, type Selections, EMPTY_SELECTIONS } from "@/lib/booking/draft";
import { beforeDeadline, deadlineOf, policyOf } from "@/lib/booking/policy";
import { toHhmm, toIsoDate } from "@/lib/datetime";
import type { Lang } from "@/lib/i18n";
import { prisma } from "@/lib/prisma";
import type { Rule } from "@/lib/booking/core";
import { doctorName, nameOf, pick } from "@/lib/public/text";
import { bookingNotes, clinicsOf, ownBooking, personName, personsOf, type Person } from "./data";
import { ageOn } from "./questionnaire";

export type Go = { kind: "notFound" } | { kind: "redirect"; to: string } | { kind: "login" };

const owner = (s: SessionContext | null) => (s ? { accountId: s.account.id, sessionId: s.sessionId } : null);

/** where T057 goes: the screen the flow came from (P11 §2.2), fallback P01 */
export const ORIGIN = /^\/$|^\/mypage\/family$|^\/doctors\/[0-9a-f-]{36}$|^\/clinics\/[a-z0-9-]{1,20}$|^\/bookings(\/[0-9a-f-]{36})?$/;
export const originOr = (v: unknown) => (typeof v === "string" && ORIGIN.test(v) ? v : "/");

/** P11 return messages (T054–T056) and where each is shown (Q3 / Q4 A) */
const RETURN_AT: Record<string, "time" | "date" | "ops" | "top"> = {
  PE030: "time", PE031: "date", PE032: "time", PE035: "time", PE033: "ops", PE034: "ops", PE036: "top",
};
const RULE_OF: Record<string, "WINDOW" | "LIMIT" | "OVERLAP"> = { PE031: "WINDOW", PE033: "LIMIT", PE034: "OVERLAP" };

/** {n} of PE031, {氏名} of PE033 / PE034 (the person, name order per language, without 様: P13 Q15 A) */
export async function paramsOf(rule: Rule, c: { patientId: string }, windowDays: number, lang: Lang): Promise<Record<string, string | number>> {
  if (rule === "WINDOW") return { n: windowDays };
  if (rule !== "LIMIT" && rule !== "OVERLAP") return {};
  const p = await prisma.patient.findUniqueOrThrow({ where: { id: c.patientId }, select: { familyName: true, givenName: true, nameType: true } });
  const name = personName(p, lang);
  return { 氏名: name, name };
}

export type ChangeInfo = {
  bookingId: string; version: number; bookingNo: string; date: string; start: string; patientName: string; relation: string;
  clinicName: string; deptName: string; typeName: string; category: string;
};

export type EntryProps = {
  lang: Lang;
  loggedIn: boolean;
  persons: Person[];
  clinics: Awaited<ReturnType<typeof clinicsOf>>;
  origin: string;
  change: ChangeInfo | null;
  initial: Selections;
  presetDoctorId: string | null;
  touched: boolean;
  error: { code: string; params: Record<string, string | number>; at: "time" | "date" | "ops" | "top" } | null;
  lostStart: string | null;
};

type Query = { patient?: string; clinic?: string; department?: string; doctor?: string; from?: string; resume?: string; e?: string };
const one = (v: unknown) => (typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : undefined);

export async function loadEntry(o: {
  session: SessionContext | null; draftId: string | undefined; query: Record<string, unknown>; changeId?: string; lang: Lang; now?: Date;
}): Promise<Go | { kind: "ok"; props: EntryProps }> {
  const q: Query = Object.fromEntries(Object.entries(o.query).map(([k, v]) => [k, one(v)]));
  const s = o.session;
  if (o.changeId && !s) return { kind: "login" };
  const persons = s ? await personsOf(s.account.id, o.lang) : [];
  const self = persons.find((p) => p.relation === "SELF") ?? persons[0];
  const sel: Selections = { ...EMPTY_SELECTIONS, patientId: self?.id ?? null };
  let origin = "/";
  let change: ChangeInfo | null = null;
  let presetDoctorId: string | null = null;
  let touched = false;

  if (o.changeId) {
    const b = await ownBooking(o.changeId, s!.account.id);
    if (!b) return { kind: "notFound" };
    const policy = await policyOf(b.clinicId);
    const open = b.status === "RESERVED" && (!!b.adjustRequiredAt || beforeDeadline(policy, toIsoDate(b.slotDate), toHhmm(b.startTime), o.now));
    if (!open) return { kind: "redirect", to: `/bookings/${b.id}` }; // P11 Q8 A: P16 shows its own message
    change = {
      bookingId: b.id, version: b.version, bookingNo: b.bookingNo, date: toIsoDate(b.slotDate), start: toHhmm(b.startTime),
      patientName: personName(b.patient, o.lang), relation: b.patient.relation ?? "OTHER", clinicName: nameOf(b.clinic, o.lang),
      deptName: nameOf(b.department, o.lang), typeName: nameOf(b.visitType, o.lang), category: b.visitType.category,
    };
    Object.assign(sel, {
      patientId: b.patientId, clinicId: b.clinicId, departmentId: b.departmentId, visitTypeId: b.visitTypeId,
      doctorId: b.doctorRequested ? b.doctorId : null, notes: bookingNotes(b), // Q9 A; item 20 shows the booking's notes
    });
    origin = `/bookings/${b.id}`;
  } else {
    if (q.patient && s) {
      if (!persons.some((p) => p.id === q.patient)) return { kind: "notFound" }; // T036 tampered: ER-01, nothing disclosed
      sel.patientId = q.patient;
      origin = "/mypage/family";
    }
    if (q.clinic) {
      const c = await prisma.clinic.findFirst({ where: { code: q.clinic, isActive: true }, select: { id: true, code: true } });
      if (c) {
        sel.clinicId = c.id;
        origin = `/clinics/${c.code}`;
        if (q.department) {
          const d = await prisma.clinicDepartment.findFirst({ where: { clinicId: c.id, department: { code: q.department, isActive: true } }, select: { departmentId: true } });
          if (d) sel.departmentId = d.departmentId;
        }
        if (q.doctor && /^[0-9a-f-]{36}$/i.test(q.doctor) && sel.departmentId) {
          presetDoctorId = q.doctor; // applied when listed (Q27 A)
          origin = `/doctors/${q.doctor}`;
        }
      }
    }
    if (q.from === "bookings") origin = "/bookings";
  }

  let error: EntryProps["error"] = null;
  let lostStart: string | null = null;
  const code = q.e && RETURN_AT[q.e] ? q.e : null;
  const draft = q.resume === "1" && code !== "PE036" ? getDraft(o.draftId, owner(s), o.now?.getTime()) : null;
  if (draft && sameFlow(draft, change)) {
    Object.assign(sel, draft.sel);
    if (!draft.sel.patientId && self) sel.patientId = self.id; // T010: 本人 selected (F4-01)
    origin = draft.origin;
    touched = true;
  }
  if (code === "PE036") error = { code, params: {}, at: "top" }; // every selection cleared (Q3 A)
  else if (code && draft) {
    error = { code, params: RULE_OF[code] && sel.patientId ? await paramsOf(RULE_OF[code], { patientId: sel.patientId }, (await policyOf(sel.clinicId!)).bookingWindowDays, o.lang) : {}, at: RETURN_AT[code] };
    if (code === "PE030") lostStart = sel.start;
    if (code === "PE030" || code === "PE032" || code === "PE035") sel.start = null; // the time de-selected (Q4 A)
  }
  if (code === "PE036") Object.assign(sel, { ...EMPTY_SELECTIONS, patientId: self?.id ?? null });

  return {
    kind: "ok",
    props: { lang: o.lang, loggedIn: !!s, persons, clinics: await clinicsOf(o.lang), origin, change, initial: sel, presetDoctorId, touched, error, lostStart },
  };
}

/** a restored record must be of the same mode: a change draft only on its own booking's change URL */
const sameFlow = (d: Draft, change: ChangeInfo | null) => (change ? d.change?.bookingId === change.bookingId : !d.change);

// ── P12 / P13 ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const EXPIRED = "/booking/new?e=PE036";

/** the alive booking draft of the session, its person checked against the account (P13 1-6 → ER-01) */
async function draftOf(s: SessionContext, draftId: string | undefined, now?: Date): Promise<Go | { kind: "ok"; draft: Draft }> {
  const d = getDraft(draftId, owner(s), now?.getTime());
  if (!d || d.kind !== "DRAFT") return { kind: "redirect", to: EXPIRED };
  const own = await prisma.patient.count({ where: { id: d.sel.patientId!, accountId: s.account.id } });
  if (!own) return { kind: "notFound" };
  if (d.change && !(await ownBooking(d.change.bookingId, s.account.id))) return { kind: "notFound" };
  return { kind: "ok", draft: d };
}

async function masters(d: Draft, lang: Lang) {
  const [patient, clinic, dept, vt, doctor] = await Promise.all([
    prisma.patient.findUniqueOrThrow({ where: { id: d.sel.patientId! } }),
    prisma.clinic.findUniqueOrThrow({ where: { id: d.sel.clinicId! } }),
    prisma.department.findUniqueOrThrow({ where: { id: d.sel.departmentId! } }),
    prisma.visitType.findUniqueOrThrow({ where: { id: d.sel.visitTypeId! } }),
    d.sel.doctorId ? prisma.doctor.findUnique({ where: { id: d.sel.doctorId } }) : null,
  ]);
  return { patient, clinic, dept, vt, doctor, name: personName(patient, lang) };
}

export type QuestionnaireProps = {
  lang: Lang; summary: { name: string; clinic: string; dept: string; type: string; date: string; start: string };
  person: { dept: string; sex: "MALE" | "FEMALE"; age: number }; deptName: string; answers: Record<string, unknown>; origin: string;
};

export async function loadQuestionnaire(o: { session: SessionContext; draftId: string | undefined; lang: Lang; now?: Date }): Promise<Go | { kind: "ok"; props: QuestionnaireProps }> {
  const r = await draftOf(o.session, o.draftId, o.now);
  if (r.kind !== "ok") return r;
  const d = r.draft;
  const m = await masters(d, o.lang);
  if (d.change || m.vt.category !== "FIRST") return { kind: "redirect", to: EXPIRED }; // P12 Q2 A: no 問診 needed → P11 PE036
  return {
    kind: "ok",
    props: {
      lang: o.lang,
      summary: { name: m.name, clinic: nameOf(m.clinic, o.lang), dept: nameOf(m.dept, o.lang), type: nameOf(m.vt, o.lang), date: d.sel.date!, start: d.sel.start! },
      person: { dept: m.dept.code, sex: m.patient.sex, age: ageOn(toIsoDate(m.patient.birthDate), d.sel.date!) },
      deptName: nameOf(m.dept, o.lang), answers: d.questionnaire?.answers ?? {}, origin: d.origin,
    },
  };
}

export type ConfirmProps = {
  lang: Lang; changeMode: boolean; category: string; origin: string;
  name: string; clinic: string; dept: string; type: string; doctor: string | null; date: string; start: string; end: string;
  priceYen: number | null; notice: string | null; questionnaire: "DONE" | "KEPT" | null; notes: string;
  deadline: { passed: false; at: string } | { passed: true; message: string; clinic: string; phone: string };
  before: { date: string; start: string; doctor: string | null } | null;
  backTo: string;
};

export async function loadConfirm(o: { session: SessionContext; draftId: string | undefined; lang: Lang; now?: Date }): Promise<Go | { kind: "ok"; props: ConfirmProps }> {
  const d0 = getDraft(o.draftId, owner(o.session), o.now?.getTime());
  if (d0?.bookingId) return { kind: "redirect", to: `/bookings/${d0.bookingId}/done` }; // a reload after the commit → P14
  const r = await draftOf(o.session, o.draftId, o.now);
  if (r.kind !== "ok") return r;
  const d = r.draft;
  const m = await masters(d, o.lang);
  const firstNew = !d.change && m.vt.category === "FIRST";
  if (firstNew && !d.questionnaire?.complete) return { kind: "redirect", to: "/booking/questionnaire" };
  const policy = await policyOf(m.clinic.id);
  const date = d.sel.date!;
  const start = d.sel.start!;
  const [h, mm] = start.split(":").map(Number);
  const endMin = h * 60 + mm + m.vt.durationFrames * policy.frameMinutes;
  const end = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
  const deadlineAt = deadlineOf(policy, date, start);
  const passed = !beforeDeadline(policy, date, start, o.now);
  const row = await prisma.bookingPolicy.findUnique({ where: { clinicId: m.clinic.id } });
  let before: ConfirmProps["before"] = null;
  let questionnaire: ConfirmProps["questionnaire"] = firstNew ? "DONE" : null;
  if (d.change) {
    const b = (await ownBooking(d.change.bookingId, o.session.account.id))!;
    before = { date: toIsoDate(b.slotDate), start: toHhmm(b.startTime), doctor: b.doctorRequested ? doctorName(b.doctor, o.lang) : null };
    if (b.visitType.category === "FIRST" && b.questionnaire) questionnaire = "KEPT";
  }
  return {
    kind: "ok",
    props: {
      lang: o.lang, changeMode: !!d.change, category: m.vt.category, origin: d.origin,
      name: m.name, clinic: nameOf(m.clinic, o.lang), dept: nameOf(m.dept, o.lang), type: nameOf(m.vt, o.lang),
      doctor: m.doctor ? doctorName(m.doctor, o.lang) : null, date, start, end,
      priceYen: m.vt.category === "SELF_PAY" ? m.vt.priceYen : null,
      notice: pick(o.lang, m.vt.noticeJa ?? "", m.vt.noticeEn, m.vt.noticeVi) || null,
      questionnaire, notes: d.sel.notes,
      deadline: passed
        ? { passed: true, message: row ? pick(o.lang, row.phoneMessageJa, row.phoneMessageEn, row.phoneMessageVi) : "", clinic: nameOf(m.clinic, o.lang), phone: m.clinic.phone }
        : { passed: false, at: deadlineAt.toISOString() },
      before,
      backTo: firstNew ? "/booking/questionnaire" : d.change ? `/bookings/${d.change.bookingId}/change?resume=1` : "/booking/new?resume=1",
    },
  };
}
