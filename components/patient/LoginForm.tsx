"use client";

// spec-screen: P02
// ログイン: states 基, ① PE010, ② PE017 + 再送, ③ after resend (PI001), ④ PE011, ⑤ sending, ⑥ field errors.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { postJson, useApiFetch } from "@/lib/client/api";
import { blank, checkEmail } from "@/lib/auth/validate";
import type { FieldError as ServerError } from "@/lib/auth/validate";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";
import { ErrorSummary, Field, fieldId, filled, invalid, useFatal, useFieldErrors } from "./form";

const FORM = "p02";
const LABELS = { email: "fEmail", password: "fPassword" } as const;
type Panel = { code: "PE010" | "PE011" | "PE017"; n?: number } | null;

export function LoginForm({ lang, guidance, maintenance }: { lang: Lang; guidance: string | null; maintenance: string | null }) {
  const router = useRouter();
  const apiFetch = useApiFetch();
  const { toast } = useToast();
  const fatal = useFatal();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [resent, setResent] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  const check = useCallback((): ServerError[] => {
    const list: ServerError[] = [];
    const e = checkEmail(email);
    if (e) list.push(e);
    if (blank(password)) list.push({ field: "password", code: "PE001" });
    return list;
  }, [email, password]);
  const fe = useFieldErrors(FORM, LABELS, lang, check);
  const id = (f: string) => fieldId(FORM, f);

  async function login() {
    setPanel(null); // Q8: the old message is cleared at the press
    setResent(null);
    if (!fe.all()) return;
    setBusy(true);
    try {
      const res = await apiFetch(...postJson("/api/auth/login", { email, password }));
      if (!res) return;
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        // PI012 on P06 / the return target; PW006 is CF-04's own text, PI022 the banner of P05
        if (data.code === "PI012") toast("PI012");
        router.push(data.destination);
        router.refresh();
        return;
      }
      if (data.errors) fe.fromServer(data.errors);
      else if (data.code === "PE010") {
        setPanel({ code: "PE010" });
        setPassword(""); // only after PE010 (Q8)
      } else if (data.code === "PE011") setPanel({ code: "PE011", n: data.params?.n });
      else if (data.code === "PE017") setPanel({ code: "PE017" });
      else if (res.status !== 429) fatal();
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!fe.all()) return;
    setResending(true);
    try {
      const res = await apiFetch(...postJson("/api/auth/resend", { email, screen: "P02" }));
      if (!res) return;
      const data = await res.json().catch(() => ({}));
      if (res.ok) setResent(email.trim()); // {メールアドレス} = item 3 in full (Q10)
      else if (data.errors) fe.fromServer(data.errors);
      else if (res.status !== 429) fatal();
    } finally {
      setResending(false);
    }
  }

  const err = (f: string) => fe.textOf(f);
  return (
    <div className="acct mp-login" data-testid="p02">
      <h1>{label("login", lang)}</h1>
      {(guidance || maintenance) && (
        <div className="col g8">
          {guidance && <p className="info m0" data-testid="p02-guidance"><Icon name="alert" />{t(guidance, lang)}</p>}
          {maintenance && <p className="warn m0"><Icon name="tool" />{maintenance}</p>}
        </div>
      )}
      <div className="login-cards">
        <section className="frm">
          {panel && (
            <p className="err m0 row" role="alert" data-testid="p02-panel">
              <Icon name={panel.code === "PE011" ? "lock" : "alert"} />
              {t(panel.code, lang, { n: panel.n ?? 15 })}
            </p>
          )}
          <ErrorSummary errors={fe.summary} lang={lang} />
          <form noValidate className="col g12" onSubmit={(e) => { e.preventDefault(); if (filled(email) && filled(password)) void login(); }}>
            <Field id={id("email")} name={label("fEmail", lang)} lang={lang} required error={err("email")}>
              <input
                id={id("email")} className="inp" type="email" autoComplete="username" maxLength={254} value={email} disabled={busy}
                onChange={(e) => setEmail(e.target.value)} onBlur={() => fe.blur("email")} {...invalid(id("email"), err("email"))}
              />
            </Field>
            <Field id={id("password")} name={label("fPassword", lang)} lang={lang} required error={err("password")}>
              <div className="pw-wrap">
                <input
                  id={id("password")} className="inp" type={show ? "text" : "password"} autoComplete="current-password" maxLength={64}
                  value={password} disabled={busy}
                  onChange={(e) => setPassword(e.target.value)} onBlur={() => fe.blur("password")} {...invalid(id("password"), err("password"))}
                />
                {/* item 5: eye toggle inside the field, 4 only */}
                <button type="button" className="pw-eye" aria-label={label("showPassword", lang)} aria-pressed={show} disabled={busy} onClick={() => setShow((s) => !s)}>
                  <Icon name="eye" />
                </button>
              </div>
            </Field>
            <Button type="submit" full disabled={!filled(email) || !filled(password)} busy={busy} busyLabel={label("loggingIn", lang)}>
              {label("loginAction", lang)}
            </Button>
          </form>
          <Link className="lnk row" href="/password/forgot">{label("forgotLink", lang)}<Icon name="right" size={16} /></Link>
          <Link className="lnk row md:hidden" href="/register">{label("firstTimeLink", lang)}<Icon name="right" size={16} /></Link>
          <p className="xs mut m0">{label("staffNote", lang)}</p>
          {/* item 9 last in Tab order (marker order 3 … 8 → 9); the image draws it higher */}
          {panel?.code === "PE017" && (
            <div className="col g8">
              <Button variant="secondary" full busy={resending} onClick={resend}><Icon name="refresh" />{label("resendBtn", lang)}</Button>
              {resent !== null && <p className="info m0" role="status"><Icon name="check" />{t("PI001", lang, { メールアドレス: resent, email: resent })}</p>}
            </div>
          )}
        </section>
        <section className="frm hidden md:flex">
          <h2>{label("firstTime", lang)}</h2>
          <p className="m0 sm">{label("registerPitch", lang)}</p>
          <Link className="btn bs" href="/register">{label("register", lang)}</Link>
        </section>
      </div>
    </div>
  );
}
