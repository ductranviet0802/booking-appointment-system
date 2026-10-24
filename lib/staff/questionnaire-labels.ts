// spec-screen: S01, S03
// 問診 answers for staff dialogs (S01 item 25-2, S03 item 24-3): question labels and choice texts in Japanese from the one
// form definition of P12 (`lib/entry/questionnaire.ts`, 10 §4–§5, form 2026.1). Typed answers are shown as entered; choice
// codes in Japanese (F2-04). Unknown ids / codes are shown as stored.
import { QUESTIONS } from "@/lib/entry/questionnaire";

const BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));

/** answers object (question id → string | number | string[]) → label / text pairs in the order of the object */
export function answerRows(answers: unknown): Array<{ id: string; question: string; answer: string }> {
  if (!answers || typeof answers !== "object") return [];
  return Object.entries(answers as Record<string, unknown>).map(([id, v]) => {
    const q = BY_ID.get(id);
    const one = (x: unknown) => String(q?.choices?.find(([c]) => c === x)?.[1][0] ?? x);
    return { id, question: q?.label[0] ?? id, answer: Array.isArray(v) ? v.map(one).join("、") : one(v) };
  });
}
