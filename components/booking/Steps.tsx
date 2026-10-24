// spec-screen: P11
// Item 1 of P11 / P12 / P13: 選択 · 問診 · 確認 · 完了; 問診 only for a 初診 new booking (F2-03, P11 Q22 / P13 Q11 B).
import type { Lang } from "@/lib/i18n";
import { lw1, type W1Key } from "@/lib/i18n/labels-w1";

export function Steps({ lang, withQuestionnaire, current }: { lang: Lang; withQuestionnaire: boolean; current: "select" | "questionnaire" | "confirm" }) {
  const steps: Array<["select" | "questionnaire" | "confirm" | "done", W1Key]> = [
    ["select", "stepSelect"], ...(withQuestionnaire ? [["questionnaire", "stepQuestionnaire"] as ["questionnaire", W1Key]] : []),
    ["confirm", "stepConfirm"], ["done", "stepDone"],
  ];
  const at = steps.findIndex(([k]) => k === current);
  return (
    <ol className="w1-steps" aria-label={lw1("stepsAria", lang)}>
      {steps.map(([k, key], i) => (
        <li key={k} className={i === at ? "cur" : i < at ? "past" : undefined} aria-current={i === at ? "step" : undefined}>
          <span className="w1-step-no" aria-hidden>{i < at ? "✓" : i + 1}</span>
          <span>{lw1(key, lang)}</span>
          {i === at && <span className="sr-only">{lw1("stepCurrent", lang)}</span>}
        </li>
      ))}
    </ol>
  );
}
