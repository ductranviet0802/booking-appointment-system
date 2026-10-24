"use client";

// Form plumbing of P02–P07: field errors keyed by the field name the server re-check uses (lib/auth/validate.ts), the
// message text of 04 with {項目} = the item name in the UI language, the inline check on leaving a field (event 4 of P03,
// 3 of P06, 5 of P07) with the same rule functions as the server, and the summary (_common item 35).
import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { ErrorSummary, FieldError, RequiredMark } from "@/components/ui/FormParts";
import type { FieldError as ServerError } from "@/lib/auth/validate";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";
import type { LabelKey } from "@/lib/i18n/labels";

export type Errors = Record<string, ServerError>;

/** the 04 text of a field error; codes without a 04 row (P07 duplicate) are label keys */
export function errorText(e: ServerError, lang: Lang, itemName: string) {
  if (e.code === "DUP_MEMBER") return label("dupMember", lang);
  return t(e.code, lang, { 項目: itemName, ...(e.params ?? {}) });
}

/** an answer that leaves the screen for ER-02 (tampered value, 5xx): thrown in render → the group's error.tsx */
export function useFatal() {
  const [fatal, setFatal] = useState(false);
  if (fatal) throw new Error("ER-02");
  return useCallback(() => setFatal(true), []);
}

/** a value counts as filled unless it is only half- / full-width spaces */
export const filled = (v: unknown) => typeof v === "string" && v.replace(/[\s　]/g, "") !== "";

export const fieldId =(form: string, field: string) => `${form}-${field}`;

/**
 * errors of one form. `check` = the whole-form rule check (the server's own function) → the field errors.
 * blur(field): show / clear that field's error only. all(): every error (press of the submit button).
 */
export function useFieldErrors(form: string, names: Record<string, LabelKey>, lang: Lang, check: () => ServerError[]) {
  const [errors, setErrors] = useState<Errors>({});
  const byField = (list: ServerError[]) => Object.fromEntries(list.map((e) => [e.field, e]));

  const blur = useCallback((...fields: string[]) => {
    const found = byField(check());
    setErrors((prev) => {
      const next = { ...prev };
      for (const f of fields) {
        if (found[f]) next[f] = found[f];
        else delete next[f];
      }
      return next;
    });
  }, [check]);

  const all = useCallback(() => {
    const list = check();
    setErrors(byField(list));
    focusFirst(form, list);
    return list.length === 0;
  }, [check, form]);

  /** errors answered by the server re-check (400 { errors }) */
  const fromServer = useCallback((list: ServerError[]) => {
    setErrors(byField(list));
    focusFirst(form, list);
  }, [form]);

  const textOf = (field: string) => (errors[field] ? errorText(errors[field], lang, label(names[field] ?? "dash", lang)) : null);
  const summary = Object.keys(errors).map((f) => ({ fieldId: fieldId(form, f), message: textOf(f)! }));
  return { errors, setErrors, blur, all, fromServer, textOf, summary };
}

function focusFirst(form: string, list: ServerError[]) {
  if (list.length === 0 || typeof document === "undefined") return;
  // the first error in document order (_common event 26)
  const els = list.map((e) => document.getElementById(fieldId(form, e.field))).filter((x): x is HTMLElement => !!x);
  els.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  els[0]?.focus();
}

export { ErrorSummary };

/** label + required / optional badge + the control + help + field error (_common items 36, 37) */
export function Field({
  id, name, lang, required, optional, error, help, children, group,
}: {
  id: string; name: string; lang: Lang; required?: boolean; optional?: boolean; error?: string | null; help?: ReactNode;
  children: ReactNode; group?: boolean;
}) {
  const Label = group ? "span" : "label";
  return (
    <div className="fld">
      <Label className="lbl" {...(group ? { id: `${id}-lbl` } : { htmlFor: id })}>
        {name}
        {required && <RequiredMark lang={lang} />}
        {optional && <span className="opt">{label("optional", lang)}</span>}
      </Label>
      <div className="col g4">
        {children}
        {help && <div className="xs mut">{help}</div>}
        <FieldError id={`${id}-err`} message={error} />
      </div>
    </div>
  );
}

/** aria props of an input with its error */
export const invalid = (id: string, error: string | null | undefined) =>
  error ? { "aria-invalid": true as const, "aria-describedby": `${id}-err` } : {};

/** P03 item 6 / P05 item 5 / P06 item 27-1: one toggle for every password field of the form */
export function ShowPassword({ id, lang, on, onChange }: { id: string; lang: Lang; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="row sm" htmlFor={id} style={{ minHeight: 44 }}>
      <input id={id} type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      {label("showPassword", lang)}
    </label>
  );
}
