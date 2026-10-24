// spec-screen: P12
// P12 event 11 (次へ: server re-check 11-3, the answers kept with the draft as one JSON, T051 → P13) and event 12 (戻る:
// the answers entered so far kept, T052 → P11). An expired or missing draft → P11 with PE036 (T056, Q1 A). Nothing is
// written to the database here (questionnaires is written by P13, T053).
import type { NextRequest } from "next/server";
import { getDraft, patchDraft } from "@/lib/booking/draft";
import { toIsoDate } from "@/lib/datetime";
import { EXPIRED } from "@/lib/entry/pages";
import { ageOn, checkAnswers, keepAnswers, type Answers } from "@/lib/entry/questionnaire";
import { entryRoute, go, json, notOwn } from "@/lib/entry/route";
import { prisma } from "@/lib/prisma";

export function POST(req: NextRequest) {
  return entryRoute(req, { login: true }, async (v, body) => {
    const d = getDraft(v.draftId, v.owner);
    if (!d || d.kind !== "DRAFT") return go(EXPIRED, 410);
    const patient = await prisma.patient.findFirst({ where: { id: d.sel.patientId!, accountId: v.owner!.accountId } });
    if (!patient) return notOwn();
    const vt = await prisma.visitType.findUniqueOrThrow({ where: { id: d.sel.visitTypeId! }, include: { department: true } });
    if (d.change || vt.category !== "FIRST") return go(EXPIRED, 410);
    // 10 §1.3 evaluated again from the patient row and the department of the booking (11-3)
    const person = { dept: vt.department.code, sex: patient.sex, age: ageOn(toIsoDate(patient.birthDate), d.sel.date!) };
    const raw = (body.answers && typeof body.answers === "object" && !Array.isArray(body.answers) ? body.answers : {}) as Answers;
    const language = v.session!.account.language; // Q10 A: the UI language when 次へ is pressed

    if (body.action === "back") {
      patchDraft(d.id, { questionnaire: { answers: keepAnswers(person, raw), language, complete: false } });
      return go("/booking/new?resume=1");
    }
    const r = checkAnswers(person, raw);
    if (r.errors.length) return json(400, { code: "FIELDS", errors: r.errors });
    patchDraft(d.id, { questionnaire: { answers: r.answers, language, complete: true } });
    return go("/booking/confirm");
  });
}
