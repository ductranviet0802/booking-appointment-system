// spec-screen: P11
// P11 event 11 / 抽出11: the business rules for the chosen person and frames, read only (the transactional claim is P13's,
// F4-07). The same rules and order as the core (lib/booking/core.ts bookInTx, PATIENT_ORDER): window, cut-off, closure,
// free frames, per-person limit, overlap; one message, the first failing. Change mode: the booking being changed is
// excluded from limit / overlap and its frames count as free (Q7 A).
// shortcut: duplicates the core's read part until the core offers a read-only check (asked in the W3 report).
import { PATIENT_CODE, PATIENT_ORDER, type Rule } from "@/lib/booking/core";
import { policyOf } from "@/lib/booking/policy";
import { addDays, dbDate, jstInstant, todayJst, toHhmm } from "@/lib/datetime";
import type { Lang } from "@/lib/i18n";
import { prisma } from "@/lib/prisma";
import { frameRows, group, isFree, personName, runAt } from "./data";

export type Choice = {
  patientId: string; clinicId: string; departmentId: string; visitTypeId: string; doctorId: string | null; date: string; start: string;
};
export type CheckFail = { ok: false; rule: Rule; code: string; params: Record<string, string | number> };

export async function checkChoice(c: Choice, changeBookingId: string | null, lang: Lang, now = new Date()): Promise<{ ok: true } | CheckFail> {
  const policy = await policyOf(c.clinicId);
  const vt = await prisma.visitType.findUnique({ where: { id: c.visitTypeId } });
  const masterOk = !!vt && vt.clinicId === c.clinicId && vt.departmentId === c.departmentId && (!!changeBookingId || (vt.isActive && vt.webBookable));
  const n = vt?.durationFrames ?? 1;
  const failed = new Set<Rule>();
  const today = todayJst(now);
  if (c.date < today || c.date > addDays(today, policy.bookingWindowDays)) failed.add("WINDOW");
  if (c.date === today && jstInstant(c.date, c.start).getTime() < now.getTime() + policy.sameDayCutoffMinutes * 60_000) failed.add("CUTOFF");

  const rows = await frameRows({ clinicId: c.clinicId, departmentId: c.departmentId, doctorId: c.doctorId, changeBookingId }, c.date, c.date);
  const runs = [...group(rows).values()].map((byDate) => runAt(byDate.get(c.date) ?? [], c.start, n)).filter((r) => r !== null);
  let end: string | null = null;
  if (!masterOk || runs.length === 0) failed.add("TAKEN");
  else {
    const fit = runs.find((r) => r.every(isFree));
    if (fit) end = fit[fit.length - 1].end;
    else failed.add(runs.every((r) => r.some((f) => f.status === "CLOSED")) ? "CLOSED" : "TAKEN");
  }

  const sameDay = await prisma.booking.findMany({
    where: { patientId: c.patientId, slotDate: dbDate(c.date), status: { in: ["RESERVED", "CHECKED_IN"] }, ...(changeBookingId && { id: { not: changeBookingId } }) },
    select: { clinicId: true, status: true, startTime: true, endTime: true },
  });
  if (sameDay.filter((b) => b.clinicId === c.clinicId && b.status === "RESERVED").length >= policy.perPersonDailyLimit) failed.add("LIMIT");
  const until = end ?? addMinutes(c.start, n * policy.frameMinutes);
  if (sameDay.some((b) => toHhmm(b.startTime) < until && toHhmm(b.endTime) > c.start)) failed.add("OVERLAP");

  const rule = PATIENT_ORDER.find((r) => failed.has(r));
  if (!rule) return { ok: true };
  return { ok: false, rule, code: PATIENT_CODE[rule], params: await paramsOf(rule, c, policy.bookingWindowDays, lang) };
}

/** {n} of PE031, {氏名} of PE033 / PE034 (the person, name order per language, without 様: P13 Q15 A) */
export async function paramsOf(rule: Rule, c: { patientId: string }, windowDays: number, lang: Lang): Promise<Record<string, string | number>> {
  if (rule === "WINDOW") return { n: windowDays };
  if (rule !== "LIMIT" && rule !== "OVERLAP") return {};
  const p = await prisma.patient.findUniqueOrThrow({ where: { id: c.patientId }, select: { familyName: true, givenName: true, nameType: true } });
  const name = personName(p, lang);
  return { 氏名: name, name };
}

function addMinutes(hhmm: string, minutes: number) {
  const [h, m] = hhmm.split(":").map(Number);
  const t = Math.min(h * 60 + m + minutes, 24 * 60 - 1);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
