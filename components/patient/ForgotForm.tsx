"use client";

// spec-screen: P04
// パスワード再設定申請: 基 (input), ① 送信完了 (always PI020, not kept on reload: Q9), ② rate-limited (toast, input kept).
import Link from "next/link";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { postJson, useApiFetch } from "@/lib/client/api";
import { checkEmail } from "@/lib/auth/validate";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";
import { Field, fieldId, filled, invalid, useFatal, useFieldErrors } from "./form";

const FORM = "p04";

export function ForgotForm({ lang }: { lang: Lang }) {
  const apiFetch = useApiFetch();
  const fatal = useFatal();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const check = useCallback(() => {
    const e = checkEmail(email);
    return e ? [e] : [];
  }, [email]);
  const fe = useFieldErrors(FORM, { email: "fEmail" }, lang, check);
  const id = fieldId(FORM, "email");

  async function send() {
    if (!fe.all()) return;
    setBusy(true); // Q6: disabled while the request runs, no busy label
    try {
      const res = await apiFetch(...postJson("/api/auth/password/forgot", { email }));
      if (!res) return;
      const data = await res.json().catch(() => ({}));
      if (res.ok) setSent(true);
      else if (data.errors) fe.fromServer(data.errors);
      else if (res.status !== 429) fatal(); // 3-6 → ER-02
    } finally {
      setBusy(false);
    }
  }

  const back = <Link className="lnk row" href="/login">{label("backToLogin", lang)}</Link>;
  if (sent) {
    return (
      <div className="acct acct-narrow" data-testid="p04-sent">
        <section className="frm done">
          <div className="eic eic-blue"><Icon name="check" size={30} /></div>
          <h1 style={{ fontSize: 20 }}>{label("mailSent", lang)}</h1>
          <p className="m0">{t("PI020", lang)}</p>
          {back}
        </section>
      </div>
    );
  }
  return (
    <div className="acct acct-narrow" data-testid="p04">
      <h1>{label("resetTitle", lang)}</h1>
      <section className="frm">
        <p className="m0">{label("forgotLead", lang)}</p>
        <form noValidate className="col g12" onSubmit={(e) => { e.preventDefault(); if (filled(email)) void send(); }}>
          <Field id={id} name={label("fEmail", lang)} lang={lang} required error={fe.textOf("email")}>
            <input
              id={id} className="inp" type="email" autoComplete="email" maxLength={254} value={email}
              onChange={(e) => setEmail(e.target.value)} onBlur={() => fe.blur("email")} {...invalid(id, fe.textOf("email"))}
            />
          </Field>
          <Button type="submit" full disabled={!filled(email) || busy}>{label("sendBtn", lang)}</Button>
        </form>
        {back}
      </section>
    </div>
  );
}
