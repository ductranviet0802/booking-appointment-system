"use client";

// spec-screen: CF-04
// Re-consent (items 21-27, 38): modal over an empty page on desktop, full-screen page on mobile, under a logo-only CF-01.
// Only the kinds in session.reconsent are shown, unchecked; 同意して続ける stays disabled until every shown check is set (event 21).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ErrorSummary, FieldError, RequiredMark } from "@/components/ui/FormParts";
import type { FormError } from "@/components/ui/FormParts";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { postJson, useApiFetch } from "@/lib/client/api";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";

export type ConsentKind = "TERMS" | "PRIVACY";
export type ConsentItem = { kind: ConsentKind; version: string; url: string | null };

const KEYS = {
  TERMS: { name: "terms", agree: "agreeTerms", doc: "terms" },
  PRIVACY: { name: "privacy", agree: "agreePrivacy", doc: "privacy" },
} as const;

export function ConsentForm({ lang, items, next }: { lang: Lang; items: ConsentItem[]; next: string }) {
  const router = useRouter();
  const apiFetch = useApiFetch();
  const { toast } = useToast();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<ConsentKind[]>([]);
  const [busy, setBusy] = useState(false);
  const allChecked = items.every((i) => checked[i.kind]);

  const errors: FormError[] = items
    .filter((i) => failed.includes(i.kind))
    .map((i) => ({ fieldId: `consent-${KEYS[i.kind].name}`, message: t("PE008", lang) }));

  async function submit() {
    setBusy(true);
    try {
      // a kind present = its check was set, with the version shown (agreeConsents, lib/auth/service.ts)
      const versions = Object.fromEntries(items.filter((i) => checked[i.kind]).map((i) => [i.kind, i.version]));
      const res = await apiFetch(...postJson("/api/auth/consent", { versions }));
      if (!res) return;
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push(data.destination ?? next);
        router.refresh();
      } else if (res.status === 400 && data.code === "PE008") {
        const fields = ((data.errors ?? []) as { field: string }[]).map((e) => e.field);
        setFailed(items.filter((i) => fields.includes(KEYS[i.kind].agree)).map((i) => i.kind));
      } else if (res.status === 401) {
        router.refresh(); // session gone → the guard answers with ER-05
      }
    } finally {
      setBusy(false);
    }
  }

  async function declineAndLogout() {
    const res = await apiFetch("/api/auth/logout", { method: "POST" });
    if (res?.ok) {
      toast("PI011");
      router.push("/");
      router.refresh();
    }
  }

  return (
    <div className="stage">
      <div className="scrim-fixed scrim-desktop" />
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="consent-title" data-testid="cf04">
        <h1 id="consent-title">{label("consentTitle", lang)}</h1>
        <p style={{ margin: 0 }}>{t("PW006", lang)}</p>
        <ErrorSummary errors={errors} lang={lang} />
        {items.map((i) => {
          const k = KEYS[i.kind];
          const id = `consent-${k.name}`;
          return (
            <div key={i.kind} className="col g8">
              <div className="doc">
                {i.url ? (
                  <a className="lnk" href={i.url} target="_blank" rel="noopener noreferrer">
                    <span className="hide-mobile">{label("readPre", lang)}</span>
                    {label(k.doc, lang)}
                    {label("versionOf", lang, { version: i.version })}
                    <span className="hide-mobile">{label("readPost", lang)}</span>
                  </a>
                ) : (
                  <span>{label(k.doc, lang)}{label("versionOf", lang, { version: i.version })}</span>
                )}
                <Icon name="ext" size={14} />
              </div>
              <label className={`chk ${checked[i.kind] ? "on" : ""} ${failed.includes(i.kind) ? "chk-bad" : ""}`}>
                <input
                  id={id}
                  type="checkbox"
                  checked={!!checked[i.kind]}
                  aria-invalid={failed.includes(i.kind) || undefined}
                  aria-describedby={failed.includes(i.kind) ? `${id}-err` : undefined}
                  onChange={(e) => {
                    setChecked((c) => ({ ...c, [i.kind]: e.target.checked }));
                    setFailed((f) => f.filter((x) => x !== i.kind));
                  }}
                />
                <span>
                  {label(k.agree, lang)} <RequiredMark lang={lang} />
                </span>
              </label>
              <FieldError id={`${id}-err`} message={failed.includes(i.kind) ? t("PE008", lang) : null} />
            </div>
          );
        })}
        <div className="consent-actions">
          {/* tab order 26 → 27; drawn the other way round on desktop */}
          <Button disabled={!allChecked} busy={busy} busyLabel={label("busy", lang)} onClick={submit}>
            {label("agreeContinue", lang)}
          </Button>
          <button type="button" className="lnk lnk-btn" onClick={declineAndLogout}>{label("declineLogout", lang)}</button>
        </div>
      </section>
    </div>
  );
}
