"use client";

// spec-screen: P05
// パスワード再設定: token mode (基 / ① PE021 / ③ sending) and 初回変更 mode (② / ③) for flagged staff.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { postJson, useApiFetch } from "@/lib/client/api";
import { checkNewPassword } from "@/lib/auth/validate";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";
import { ErrorSummary, Field, ShowPassword, fieldId, filled, invalid, useFatal, useFieldErrors } from "./form";

const FORM = "p05";
const LABELS = { password: "newPassword", passwordConfirm: "newPasswordConfirm" } as const;

export function NewPasswordForm({ lang, mode, email, token, valid }: {
  lang: Lang; mode: "token" | "first"; email: string; token?: string; valid: boolean;
}) {
  const router = useRouter();
  const apiFetch = useApiFetch();
  const fatal = useFatal();
  const [pw, setPw] = useState({ password: "", passwordConfirm: "" });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(!valid);
  const check = useCallback(() => checkNewPassword(pw.password, pw.passwordConfirm), [pw]);
  const fe = useFieldErrors(FORM, LABELS, lang, check);
  const id = (f: string) => fieldId(FORM, f);

  async function change() {
    if (!fe.all()) return;
    setBusy(true);
    try {
      const res = await apiFetch(...(mode === "token"
        ? postJson("/api/auth/password/reset", { token, ...pw })
        : postJson("/api/auth/password/change", pw)));
      if (!res) return;
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push(data.destination); // T023 → P02 (PI021 in its box) / T025 → S01
        router.refresh();
      } else if (data.errors) fe.fromServer(data.errors);
      else if (data.code === "PE021") setExpired(true); // event 4
      else if (res.status === 401 || res.status === 403) router.refresh(); // the guard decides (ER-05 / redirect)
      else if (res.status !== 429) fatal();
    } finally {
      setBusy(false);
    }
  }

  if (expired) {
    return (
      <div className="acct acct-narrow" data-testid="p05-error">
        <section className="frm done">
          <div className="eic eic-amber"><Icon name="alert" size={30} /></div>
          <p className="m0" role="alert">{t("PE021", lang)}</p>
          <Link className="btn bp bw" href="/password/forgot">{label("applyAgain", lang)}</Link>
        </section>
      </div>
    );
  }

  const input = (f: "password" | "passwordConfirm") => (
    <input
      id={id(f)} className="inp" type={show ? "text" : "password"} autoComplete="new-password" maxLength={64} value={pw[f]} disabled={busy}
      onChange={(e) => setPw((p) => ({ ...p, [f]: e.target.value }))} onBlur={() => fe.blur(f)} {...invalid(id(f), fe.textOf(f))}
    />
  );
  return (
    <div className="acct acct-narrow" data-testid={mode === "token" ? "p05" : "p05-first"}>
      {mode === "first" && <p className="info m0" role="status"><Icon name="alert" />{t("PI022", lang)}</p>}
      <h1>{label("newPwTitle", lang)}</h1>
      <section className="frm">
        <p className="m0"><span className="mut">{label("targetPrefix", lang)}</span> {email}</p>
        <ErrorSummary errors={fe.summary} lang={lang} />
        <form noValidate className="col g12" onSubmit={(e) => { e.preventDefault(); if (filled(pw.password) && filled(pw.passwordConfirm)) void change(); }}>
          <Field id={id("password")} name={label("newPassword", lang)} lang={lang} required error={fe.textOf("password")} help={label("pwRule", lang)}>
            {input("password")}
          </Field>
          <Field id={id("passwordConfirm")} name={label("newPasswordConfirm", lang)} lang={lang} required error={fe.textOf("passwordConfirm")}>
            {input("passwordConfirm")}
            <ShowPassword id={id("show")} lang={lang} on={show} onChange={setShow} />
          </Field>
          <Button type="submit" full disabled={!filled(pw.password) || !filled(pw.passwordConfirm)} busy={busy} busyLabel={label("changing", lang)}>
            {label("changeBtn", lang)}
          </Button>
          {mode === "token" && <p className="xs mut m0">{label("changeNote", lang)}</p>}
        </form>
      </section>
    </div>
  );
}
