"use client";

// spec-screen: P12
// 問診入力: the form of docs/10 (version 2026.1) for the person and department of the draft; follow-ups open under
// their parent and their answers are discarded when they close (10 §1.3); focus-out checks and the server re-check share
// checkOne / checkAnswers. 次へ is enabled when every shown required answer is set (Q14 A).
import { useCallback, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorSummary, FieldError, RequiredMark } from "@/components/ui/FormParts";
import { Button } from "@/components/ui/Button";
import { useFatal } from "@/components/patient/form";
import { postJson, useApiFetch } from "@/lib/client/api";
import { t } from "@/lib/i18n";
import { formatDateShort, formatTime } from "@/lib/i18n/format";
import { lw1 } from "@/lib/i18n/labels-w1";
import type { QuestionnaireProps } from "@/lib/entry/pages";
import {
  checkOne, isRequired, progressOf, QUESTIONS, requiredSet, shownQuestions, tx, type Answers, type QError, type Question,
} from "@/lib/entry/questionnaire";
import { Steps } from "./Steps";
import { useLeaveGuard } from "./useLeaveGuard";
import s from "./questionnaire.module.css";

const fid = (id: string) => `p12-${id}`;
/** form state: numbers as typed text */
const toForm = (a: Answers): Answers => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, typeof v === "number" ? String(v) : v]));

export function QuestionnaireForm(p: QuestionnaireProps) {
  const { lang, person } = p;
  const apiFetch = useApiFetch();
  const fatal = useFatal();
  const [a, setA] = useState<Answers>(() => toForm(p.answers));
  const [errors, setErrors] = useState<Record<string, QError>>({});
  const [busy, setBusy] = useState(false);
  const [quit, setQuit] = useState(false);
  const shown = shownQuestions(person, a);
  const progress = progressOf(person, a);

  /** an answer changed: follow-ups that close lose their answers (events 2–7) */
  function set(id: string, value: unknown) {
    setA((prev) => {
      const next: Answers = { ...prev, [id]: value };
      const visible = new Set(shownQuestions(person, next).map((q) => q.id));
      for (const q of QUESTIONS) if (q.parent && !visible.has(q.id)) delete next[q.id];
      return next;
    });
  }
  const blur = (q: Question) => {
    const e = checkOne(q, a).error;
    setErrors((prev) => {
      const next = { ...prev };
      if (e) next[q.id] = e;
      else delete next[q.id];
      return next;
    });
  };
  const text = (e: QError) => {
    const name = tx(QUESTIONS.find((q) => q.id === e.field)!.label, lang);
    return t(e.code, lang, { 項目: name, field: name, ...(e.params ?? {}) });
  };

  async function send(action: "next" | "back") {
    setBusy(true);
    const res = await apiFetch(...postJson("/api/booking/questionnaire", { answers: a, action }));
    if (!res) return setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (body.to) return window.location.assign(body.to);
    setBusy(false);
    if (res.status === 400 && body.code === "FIELDS") {
      setErrors(Object.fromEntries((body.errors as QError[]).map((e) => [e.field, e])));
      document.getElementById(fid(body.errors[0].field))?.focus();
      return;
    }
    fatal();
  }
  async function leave() {
    const res = await apiFetch(...postJson("/api/booking/discard", { origin: p.origin }));
    const body = res ? await res.json().catch(() => ({})) : {};
    window.location.assign(body.to ?? p.origin);
  }
  // P12 Q2 A: a header link asks PW005; はい → the origin screen of the draft
  useLeaveGuard(useCallback(() => setQuit(true), []));

  const field = (q: Question) => {
    const id = fid(q.id);
    const err = errors[q.id] ? text(errors[q.id]) : null;
    const req = isRequired(q, a);
    const aria = { "aria-invalid": err ? true : undefined, "aria-describedby": err ? `${id}-err` : undefined };
    const v = a[q.id];
    const groupBlur = (e: React.FocusEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) blur(q); };
    return (
      <div key={q.id} className={`${s.q} ${q.parent ? s.follow : ""}`}>
        <div className={s.qhead} id={`${id}-lbl`}>
          <span className="lbl">{tx(q.text, lang)}{req ? <RequiredMark lang={lang} /> : <span className="opt">{lw1("optional", lang)}</span>}</span>
          {q.hint && <span className="xs mut">{tx(q.hint, lang)}</span>}
        </div>
        {q.type === "text" && (
          <>
            <textarea id={id} className="inp" rows={3} value={(v as string) ?? ""} {...aria} aria-labelledby={`${id}-lbl`}
              onChange={(e) => set(q.id, e.target.value)} onBlur={() => blur(q)} />
            <span className="xs mut">{[...((v as string) ?? "")].length}/{q.max}</span>
          </>
        )}
        {q.type === "number" && (
          <div className="row">
            <input id={id} className={`inp ${s.num}`} inputMode={q.range!.decimals ? "decimal" : "numeric"} value={(v as string) ?? ""} {...aria}
              aria-labelledby={`${id}-lbl`} onChange={(e) => set(q.id, e.target.value)} onBlur={() => blur(q)} />
            <span>{tx(q.range!.unit, lang)}</span>
          </div>
        )}
        {q.type === "radio" && (
          <div className={s.choices} role="radiogroup" aria-labelledby={`${id}-lbl`} {...aria} onBlur={groupBlur}>
            {q.choices!.map(([code, l], i) => (
              <label key={code} className={`${s.choice} ${v === code ? s.on : ""}`}>
                <input id={i === 0 ? id : undefined} type="radio" name={id} checked={v === code} onChange={() => set(q.id, code)} />
                {tx(l, lang)}
              </label>
            ))}
          </div>
        )}
        {q.type === "check" && (
          <div className={s.choices} role="group" aria-labelledby={`${id}-lbl`} {...aria} onBlur={groupBlur}>
            {q.choices!.map(([code, l], i) => {
              const list = Array.isArray(v) ? (v as string[]) : [];
              const on = list.includes(code);
              // C05: NONE clears the others, another choice clears NONE (event 4)
              const toggle = () => set(q.id, on ? list.filter((c) => c !== code)
                : q.exclusive === code ? [code] : [...list.filter((c) => c !== q.exclusive), code]);
              return (
                <label key={code} className={`${s.choice} ${on ? s.on : ""}`}>
                  <input id={i === 0 ? id : undefined} type="checkbox" checked={on} onChange={toggle} />
                  {tx(l, lang)}
                </label>
              );
            })}
          </div>
        )}
        {q.help && (!q.helpWhen || q.helpWhen(a)) && <p className="xs mut m0">{tx(q.help, lang)}</p>}
        <FieldError id={`${id}-err`} message={err} />
      </div>
    );
  };

  const deptStart = shown.findIndex((q) => q.dept);
  const commonStart = shown.findIndex((q) => q.id === "C03");
  return (
    <div className={s.root}>
      <Steps lang={lang} withQuestionnaire current="questionnaire" />
      <h1 className="m0">{lw1("questionnaireHeading", lang)}</h1>
      <p className="sm m0">{lw1("summaryLine", lang, { ...p.summary, date: formatDateShort(p.summary.date, lang), time: formatTime(p.summary.start) })}</p>
      <div className="info sm">{t("PI035", lang)}</div>
      <p className="sm m0">{tx(["受診される方ご本人についてお答えください。ご家族が代わりに入力される場合も、受診される方のことをご記入ください。", "Please answer about the person who will see the doctor. If you are filling this in for a family member, answer about them, not about yourself.", "Vui lòng trả lời về người sẽ đến khám. Nếu bạn điền thay cho người thân, hãy trả lời về người đó, không phải về bản thân bạn."], lang)}</p>
      <div className={s.progress} aria-live="polite">
        <span className="xs">{lw1("progress", lang, progress)}</span>
        <span className={s.bar}><span style={{ width: `${progress.total ? (progress.done * 100) / progress.total : 0}%` }} /></span>
      </div>
      <ErrorSummary errors={Object.values(errors).map((e) => ({ fieldId: fid(e.field), message: text(e) }))} lang={lang} />
      <div className="frm">
        {shown.map((q, i) => (
          <div key={q.id} className="col g12">
            {i === deptStart && <h2 className={s.band}>{lw1("deptBlock", lang, { dept: p.deptName })}</h2>}
            {i === commonStart && <h2 className={s.band}>{lw1("commonBlock", lang)}</h2>}
            {field(q)}
          </div>
        ))}
      </div>
      <div className="w1-bar">
        <button type="button" className="btn bs" disabled={busy} onClick={() => send("back")}>{lw1("back", lang)}</button>
        <Button busy={busy} disabled={!requiredSet(person, a)} onClick={() => send("next")}>{lw1("nextToConfirm", lang)}</Button>
        <button type="button" className="lnk lnk-btn" onClick={() => setQuit(true)}>{lw1("quit", lang)}</button>
      </div>
      <ConfirmDialog open={quit} title={lw1("quitTitle", lang)} messageId="PW005" onConfirm={leave} onCancel={() => setQuit(false)} />
    </div>
  );
}
