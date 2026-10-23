"use client";

// spec-pattern: items 35 (error summary), 35-1, 35-2, 36 (field error), 37 (required mark)
import type { Lang } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";
import { Icon } from "./Icon";

/** Item 37: badge next to the label of a required input (表示のみ) */
export function RequiredMark({ lang }: { lang: Lang }) {
  return <span className="req">{label("required", lang)}</span>;
}

/** Item 36: red text with an alert icon under the field (not colour only, N-UX-02). Give the input aria-describedby={id}. */
export function FieldError({ id, message }: { id: string; message?: string | null }) {
  if (!message) return null;
  return (
    <div id={id} className="fe">
      <Icon name="alert" size={16} />
      {message}
    </div>
  );
}

export type FormError = { fieldId: string; message: string };

/** Item 35: count heading + one link per error, each moving focus to its field (event 26). Hidden while there is no error. */
export function ErrorSummary({ errors, lang }: { errors: FormError[]; lang: Lang }) {
  if (errors.length === 0) return null;
  const heading = label(errors.length === 1 ? "summaryHeadingOne" : "summaryHeading", lang, { n: errors.length });
  return (
    <div className="err" role="alert" tabIndex={-1}>
      <div className="row" style={{ fontWeight: 700 }}>
        <Icon name="alert" />
        {heading}
      </div>
      <ul style={{ margin: "6px 0 0", paddingLeft: 22 }}>
        {errors.map((e) => (
          <li key={e.fieldId}>
            <a
              href={`#${e.fieldId}`}
              style={{ color: "#7A180F" }}
              onClick={(ev) => {
                ev.preventDefault();
                document.getElementById(e.fieldId)?.focus();
              }}
            >
              {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
