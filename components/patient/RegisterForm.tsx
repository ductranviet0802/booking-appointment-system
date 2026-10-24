"use client";

// spec-screen: P03
// 会員登録: states 基 (input), ① 送信完了, ② 再送, ③ / ④ sending, ⑤ address lookup (in AddressFields).
import Link from "next/link";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { RequiredMark } from "@/components/ui/FormParts";
import { postJson, useApiFetch } from "@/lib/client/api";
import { checkEmail, checkRegistration } from "@/lib/auth/validate";
import type { FieldError as ServerError } from "@/lib/auth/validate";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";
import { ErrorSummary, Field, ShowPassword, fieldId, filled, invalid, useFatal, useFieldErrors } from "./form";
import { AddressFields, BirthSexFields, NameFields, PERSON_LABELS, personOf } from "./PersonFields";
import type { Values } from "./PersonFields";

type Doc = { version: string; url: string } | null;
const FORM = "p03";
const LABELS = {
  ...PERSON_LABELS, email: "fEmail", password: "fPassword", passwordConfirm: "fPasswordConfirm",
  agreeTerms: "terms", agreePrivacy: "privacy",
} as const;
const REQUIRED = ["email", "password", "passwordConfirm", "familyName", "givenName", "familyNameKana", "givenNameKana", "bY", "bM", "bD", "sex", "postcode", "prefecture", "city", "addressLine", "phone"];

export function RegisterForm({ lang, terms, privacy, resend }: { lang: Lang; terms: Doc; privacy: Doc; resend: boolean }) {
  const apiFetch = useApiFetch();
  const fatal = useFatal();
  const [state, setState] = useState<"input" | "sent" | "resend">(resend ? "resend" : "input");
  const [sentTo, setSentTo] = useState("");
  const [v, setV] = useState<Values>({ nameType: lang === "ja" ? "JP" : "ROMAJI" }); // item 7 preset by language
  const [agree, setAgree] = useState({ terms: false, privacy: false });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const body = () => ({
    ...personOf(v), email: v.email ?? "", password: v.password ?? "", passwordConfirm: v.passwordConfirm ?? "",
    agreeTerms: agree.terms, agreePrivacy: agree.privacy,
  });
  const check = useCallback((): ServerError[] => {
    const r = checkRegistration(body());
    return r.tampered ? [] : r.errors.filter((e) => e.code !== "PE008");
  }, [v, agree]); // eslint-disable-line react-hooks/exhaustive-deps
  const fe = useFieldErrors(FORM, LABELS, lang, check);
  const set = (patch: Values) => setV((prev) => ({ ...prev, ...patch }));
  const id = (f: string) => fieldId(FORM, f);
  // F17-05: 25 enabled when every required item is set and both consents are checked
  const ready = REQUIRED.every((f) => filled(v[f])) && agree.terms && agree.privacy;

  async function register() {
    if (!fe.all()) return;
    setBusy(true);
    try {
      const res = await apiFetch(...postJson("/api/auth/register", {
        ...body(), consentVersions: { TERMS: terms?.version, PRIVACY: privacy?.version },
      }));
      if (!res) return;
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSentTo(data.params?.email ?? "");
        setState("sent");
        window.scrollTo(0, 0);
      } else if (data.errors) fe.fromServer(data.errors);
      else if (res.status !== 429) fatal(); // 5-6: a value the UI cannot produce, or a server error → ER-02
    } finally {
      setBusy(false);
    }
  }

  // ── ① 送信完了 ──
  if (state === "sent") {
    return (
      <div className="acct acct-narrow" data-testid="p03-sent">
        <section className="frm done">
          <div className="eic eic-blue"><Icon name="check" size={30} /></div>
          <h1 style={{ fontSize: 20 }}>{label("sentHeading", lang)}</h1>
          <p className="m0">{t("PI001", lang, { メールアドレス: sentTo, email: sentTo })}</p>
          <p className="warn m0 sm">{label("spamHint", lang)}</p>
        </section>
      </div>
    );
  }

  // ── ② 再送 ──
  if (state === "resend") return <ResendState lang={lang} onSent={(email) => { setSentTo(email); setState("sent"); }} />;

  // ── 基 ──
  const err = (f: string) => fe.textOf(f);
  const pw = (f: "password" | "passwordConfirm") => (
    <input
      id={id(f)} className="inp" type={show ? "text" : "password"} autoComplete="new-password" maxLength={64} value={v[f] ?? ""}
      onChange={(e) => set({ [f]: e.target.value })} onBlur={() => fe.blur(f)} {...invalid(id(f), err(f))}
    />
  );
  const consent = (kind: "terms" | "privacy", doc: Doc) => {
    const cid = id(kind === "terms" ? "agreeTerms" : "agreePrivacy");
    const e = fe.errors[kind === "terms" ? "agreeTerms" : "agreePrivacy"];
    return (
      <div className="col g4">
        <label className={`chk ${agree[kind] ? "on" : ""} ${e ? "chk-bad" : ""}`} htmlFor={cid}>
          <input id={cid} type="checkbox" checked={agree[kind]} onChange={(ev) => setAgree((a) => ({ ...a, [kind]: ev.target.checked }))} {...invalid(cid, e ? "x" : null)} />
          <span>
            {label("agreePre", lang)}
            {/* item 21 / 23: inside the label; pressing it opens the document and does not toggle the check */}
            {doc ? <a className="lnk" href={doc.url} target="_blank" rel="noopener noreferrer" onClick={(ev) => ev.stopPropagation()}>{label(kind, lang)}</a> : label(kind, lang)}
            {label(kind === "terms" ? "agreeTermsPost" : "agreePrivacyPost", lang)} <RequiredMark lang={lang} />
          </span>
        </label>
        {e && <p className="fe m0" id={`${cid}-err`}><Icon name="alert" size={16} />{t("PE008", lang)}</p>}
      </div>
    );
  };

  return (
    <div className="acct" data-testid="p03">
      <div className="col g4">
        <h1>{label("register", lang)}</h1>
        <p className="m0 mut">{label("registerLead", lang)}</p>
      </div>
      <ErrorSummary errors={fe.summary} lang={lang} />
      <form className="frm" noValidate onSubmit={(e) => { e.preventDefault(); if (ready) void register(); }}>
        <fieldset disabled={busy} className="col g12" style={{ border: 0, padding: 0, margin: 0 }}>
          <h2>{label("loginInfo", lang)}</h2>
          <Field id={id("email")} name={label("fEmail", lang)} lang={lang} required error={err("email")}>
            <input
              id={id("email")} className="inp" type="email" autoComplete="email" maxLength={254} value={v.email ?? ""}
              onChange={(e) => set({ email: e.target.value })} onBlur={() => fe.blur("email")} {...invalid(id("email"), err("email"))}
            />
          </Field>
          <Field id={id("password")} name={label("fPassword", lang)} lang={lang} required error={err("password")} help={label("pwRule", lang)}>
            {pw("password")}
          </Field>
          <Field id={id("passwordConfirm")} name={label("fPasswordConfirm", lang)} lang={lang} required error={err("passwordConfirm")}>
            {pw("passwordConfirm")}
            <ShowPassword id={id("show")} lang={lang} on={show} onChange={setShow} />
          </Field>

          <h2>{label("selfInfo", lang)}</h2>
          <NameFields form={FORM} lang={lang} values={v} set={set} blur={fe.blur} err={err} />
          <BirthSexFields form={FORM} lang={lang} values={v} set={set} blur={fe.blur} err={err} />

          <h2>{label("addressContact", lang)}</h2>
          <AddressFields form={FORM} lang={lang} values={v} set={set} blur={fe.blur} err={err} />

          <h2>{label("consentHeading", lang)}</h2>
          {consent("terms", terms)}
          {consent("privacy", privacy)}
          <p className="xs mut row m0"><Icon name="ext" size={14} />{label("newTabNote", lang)}</p>
        </fieldset>
        <div className="col g8">
          <Button type="submit" full disabled={!ready} busy={busy} busyLabel={label("registering", lang)}>{label("registerBtn", lang)}</Button>
          <p className="sm m0" style={{ textAlign: "center" }}>
            {label("haveAccount", lang)}<Link className="lnk" href="/login">{label("loginHere", lang)}</Link>
          </p>
        </div>
      </form>
    </div>
  );
}

/** state ②: PE004 above item 28; 28 / 29 (Q8: inline errors only, no summary); always PI001 (8-1) */
function ResendState({ lang, onSent }: { lang: Lang; onSent: (email: string) => void }) {
  const apiFetch = useApiFetch();
  const fatal = useFatal();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<ServerError | null>(null);
  const [busy, setBusy] = useState(false);
  const fid = fieldId(FORM, "resendEmail");
  const text = error ? t(error.code, lang, { 項目: label("fEmail", lang), ...(error.params ?? {}) }) : null;

  async function send() {
    const e = checkEmail(email, "email", true);
    setError(e);
    if (e) return;
    setBusy(true);
    try {
      const res = await apiFetch(...postJson("/api/auth/resend", { email, screen: "P03" }));
      if (!res) return;
      const data = await res.json().catch(() => ({}));
      if (res.ok) onSent(data.params?.email ?? email.trim().toLowerCase());
      else if (data.errors) setError(data.errors[0]);
      else if (res.status !== 429) fatal();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="acct acct-narrow" data-testid="p03-resend">
      <section className="frm">
        <p className="err m0 row" role="alert"><Icon name="alert" />{t("PE004", lang)}</p>
        <Field id={fid} name={label("fEmail", lang)} lang={lang} required error={text}>
          <input
            id={fid} className="inp" type="email" autoComplete="email" maxLength={254} value={email}
            onChange={(e) => setEmail(e.target.value)} onBlur={() => setError(checkEmail(email, "email", true))} {...invalid(fid, text)}
          />
        </Field>
        <Button full busy={busy} onClick={send}>{label("sendBtn", lang)}</Button>
      </section>
    </div>
  );
}
