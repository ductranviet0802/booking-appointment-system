// spec-screen: P11
// P11 event 10 (anonymous: keep the selections, go to login, T047) and event 11 (logged in: server re-check of §4.2,
// then the rules of 抽出11 read only, then the booking draft — T048 → P12 for a 初診 new booking, else T049 → P13).
import type { NextRequest } from "next/server";
import { loginUrlFor } from "@/lib/auth/context";
import { dropDraft, getDraft, putDraft, type Selections } from "@/lib/booking/draft";
import { beforeDeadline, policyOf } from "@/lib/booking/policy";
import { setFlash } from "@/lib/auth/route";
import { toHhmm, toIsoDate } from "@/lib/datetime";
import { checkChoice, type Choice } from "@/lib/entry/check";
import { HHMM, ISO_DATE, ownBooking, ownPerson, UUID } from "@/lib/entry/data";
import { originOr } from "@/lib/entry/pages";
import { entryRoute, go, json, notOwn, tampered, withDraftCookie } from "@/lib/entry/route";
import { parseLang } from "@/lib/i18n";
import { prisma } from "@/lib/prisma";

type FieldErr = { field: string; code: string; params?: Record<string, string | number> };
const ITEM: Record<string, string> = { patientId: "person", clinicId: "clinic", departmentId: "department", visitTypeId: "visitType", doctorId: "doctor" };

export function POST(req: NextRequest) {
  return entryRoute(req, { login: false }, async (v, body) => {
    const raw = (body.sel ?? {}) as Record<string, unknown>;
    const str = (k: string) => (typeof raw[k] === "string" && raw[k] !== "" ? (raw[k] as string) : null);
    const changeId = typeof body.changeBookingId === "string" ? body.changeBookingId : null;
    if (changeId && !v.session) return json(401, { code: "PI013", params: {} });

    // §4.2 server re-check (rows 2–9): a missing step → PE001 (Q21 A), no date / time → PE037, notes > 200 → PE003
    const errors: FieldErr[] = [];
    for (const k of ["clinicId", "departmentId", "visitTypeId"]) if (!str(k)) errors.push({ field: ITEM[k], code: "PE001" });
    if (!("doctorId" in raw) || (raw.doctorId !== null && !str("doctorId"))) errors.push({ field: "doctor", code: "PE001" });
    if (!str("date") || !str("start")) errors.push({ field: "datetime", code: "PE037" });
    const notes = typeof raw.notes === "string" ? raw.notes : "";
    if ([...notes].length > 200) errors.push({ field: "notes", code: "PE003", params: { n: 200 } });
    for (const k of ["patientId", "clinicId", "departmentId", "visitTypeId", "doctorId"]) if (str(k) && !UUID.test(str(k)!)) return tampered();
    if ((str("date") && !ISO_DATE.test(str("date")!)) || (str("start") && !HHMM.test(str("start")!))) return tampered();

    const sel: Selections = {
      patientId: str("patientId"), clinicId: str("clinicId"), departmentId: str("departmentId"), visitTypeId: str("visitTypeId"),
      doctorId: str("doctorId"), date: str("date"), start: str("start"), notes,
    };
    const origin = originOr(body.origin);

    if (!v.session) {
      if (errors.length) return json(400, { code: "FIELDS", errors });
      // event 10: nothing checked beyond §4.2; the selections wait for the login (T010, Q2 A)
      dropDraft(v.draftId);
      const rec = putDraft({ kind: "ANON", accountId: null, sessionId: null, sel: { ...sel, patientId: null }, origin, change: null, questionnaire: null, bookingId: null });
      return withDraftCookie(go(loginUrlFor("/booking/new?resume=1")), rec.id);
    }

    const accountId = v.session.account.id;
    let change: { bookingId: string; version: number } | null = null;
    if (changeId) {
      const b = await ownBooking(changeId, accountId);
      if (!b) return notOwn();
      const policy = await policyOf(b.clinicId);
      if (b.status !== "RESERVED") return setFlash(go(`/bookings/${b.id}`, 409), "PE045");
      if (!b.adjustRequiredAt && !beforeDeadline(policy, toIsoDate(b.slotDate), toHhmm(b.startTime))) return setFlash(go(`/bookings/${b.id}`, 409), "PE041");
      // the person, clinic, department and visit type of the booking are fixed (F5-01)
      Object.assign(sel, { patientId: b.patientId, clinicId: b.clinicId, departmentId: b.departmentId, visitTypeId: b.visitTypeId });
      // the version read when change mode opened (P13 10-1); the page always sends it, a missing one would skip STALE
      if (!Number.isInteger(body.version)) return tampered();
      change = { bookingId: b.id, version: body.version as number };
    } else if (!sel.patientId) {
      const persons = await prisma.patient.findMany({ where: { accountId, mergedIntoId: null, anonymizedAt: null }, select: { id: true, relation: true } });
      if (persons.length > 1) errors.unshift({ field: "person", code: "PE001" }); // §4.2 row 4
      else sel.patientId = persons[0]?.id ?? null;
    }
    if (errors.length) return json(400, { code: "FIELDS", errors });
    if (!(await ownPerson(accountId, sel.patientId))) return notOwn();

    const lang = parseLang(v.session.account.language) ?? "ja";
    const r = await checkChoice(sel as Choice, change?.bookingId ?? null, lang);
    if (!r.ok) return json(409, { code: r.code, params: r.params, rule: r.rule });

    // the previous draft of this flow keeps its 問診 answers when person and visit type are unchanged (T052 → 次へ again)
    const prev = getDraft(v.draftId, v.owner);
    const keep = prev?.kind === "DRAFT" && prev.sel.patientId === sel.patientId && prev.sel.visitTypeId === sel.visitTypeId && !prev.bookingId ? prev.questionnaire : null;
    dropDraft(v.draftId);
    const rec = putDraft({ kind: "DRAFT", accountId, sessionId: v.session.sessionId, sel, origin, change, questionnaire: keep, bookingId: null });
    const vt = await prisma.visitType.findUniqueOrThrow({ where: { id: sel.visitTypeId! }, select: { category: true } });
    return withDraftCookie(go(!change && vt.category === "FIRST" ? "/booking/questionnaire" : "/booking/confirm"), rec.id);
  });
}
