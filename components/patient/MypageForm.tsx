"use client";

// spec-screen: P06
// マイページ: shortcuts (1–3), notices (4), profile (25, 5–15), login (16, 26, 27–30), language / notifications (17–21, 31),
// 診察券 (22), 保存する (23), 退会 (24). States ① – ⑤ follow the data.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { postJson, useApiFetch } from "@/lib/client/api";
import { blank, checkEmail, checkNewPassword, checkPerson } from "@/lib/auth/validate";
import type { FieldError as ServerError } from "@/lib/auth/validate";
import { LANG_NAMES, LANGS, t } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";
import type { LabelKey } from "@/lib/i18n/labels";
import { ErrorSummary, Field, ShowPassword, fieldId, filled, invalid, useFatal, useFieldErrors } from "./form";
import { AddressFields, BirthSexFields, NameFields, PERSON_LABELS, personOf } from "./PersonFields";
import type { Values } from "./PersonFields";

export type CardItem = { clinicId: string; name: string; cardNo: string; confirmed: boolean };
export type MypageData = {
  values: Values; email: string; pendingEmail: string | null; notifyChannel: "MAIL" | "LINE" | "SMS"; smsOptIn: boolean;
  lineLinked: boolean; lineFriend: string | null; bounced: boolean; cards: CardItem[];
  /** flash ids shown in place: PE005 under 16 (event 14-2), PE052 under 21 (event 5-3) */
  inline: string | null;
};

const FORM = "p06";
const cardKey = (id: string) => `card:${id}`;

export function MypageForm({ lang, data }: { lang: Lang; data: MypageData }) {
  const router = useRouter();
  const apiFetch = useApiFetch();
  const { toast } = useToast();
  const fatal = useFatal();
  const initial = useMemo(() => ({
    ...data.values, email: data.email, notifyChannel: data.notifyChannel, smsOptIn: data.smsOptIn ? "1" : "",
    ...Object.fromEntries(data.cards.map((c) => [cardKey(c.clinicId), c.cardNo])),
  }), [data]);
  const [saved, setSaved] = useState<Values>(initial);
  const [v, setV] = useState<Values>(initial);
  const [pending, setPending] = useState(data.pendingEmail);
  const [busy, setBusy] = useState(false);
  const set = (patch: Values) => setV((p) => ({ ...p, ...patch }));
  const changed = Object.keys(v).some((k) => (v[k] ?? "") !== (saved[k] ?? ""));

  const names = useMemo(() => {
    const n: Record<string, LabelKey> = { ...PERSON_LABELS, email: "fEmail", notifyChannel: "notifyChannel", smsOptIn: "smsAgree" };
    for (const c of data.cards) n[cardKey(c.clinicId)] = "cardNo";
    return n;
  }, [data.cards]);

  const body = useCallback(() => ({
    ...personOf(v), email: v.email ?? "", notifyChannel: v.notifyChannel, smsOptIn: v.smsOptIn === "1",
    cards: data.cards.filter((c) => !c.confirmed).map((c) => ({ clinicId: c.clinicId, cardNo: v[cardKey(c.clinicId)] ?? "" })),
  }), [v, data.cards]);

  const check = useCallback((): ServerError[] => {
    const b = body();
    const errors = [...(checkPerson(b)?.errors ?? [])];
    const e = checkEmail(b.email);
    if (e) errors.push(e);
    if (b.notifyChannel === "LINE" && !data.lineLinked) errors.push({ field: "notifyChannel", code: "PE050" });
    if (b.notifyChannel === "SMS" && !b.smsOptIn) errors.push({ field: "notifyChannel", code: "PE051" });
    for (const c of b.cards) {
      const no = c.cardNo.trim();
      if (no.length > 20) errors.push({ field: cardKey(c.clinicId), code: "PE003", params: { n: 20 } });
      else if (no && !/^[0-9A-Za-z-]+$/.test(no)) errors.push({ field: cardKey(c.clinicId), code: "PE002" });
    }
    return errors;
  }, [body, data.lineLinked]);
  const fe = useFieldErrors(FORM, names, lang, check);
  const err = (f: string) => fe.textOf(f);
  const id = (f: string) => fieldId(FORM, f);
  const inlineEmail = data.inline === "PE005" && !fe.errors.email ? t("PE005", lang) : null;

  // ── event 7 ──
  async function save() {
    if (!fe.all()) return;
    setBusy(true);
    try {
      const res = await apiFetch(...postJson("/api/mypage/save", body()));
      if (!res) return;
      const out = await res.json().catch(() => ({}));
      if (res.ok) {
        toast("PI040");
        if (out.pendingEmail) toast("PI048", { params: { メールアドレス: out.pendingEmail, email: out.pendingEmail } });
        setPending(out.pendingEmail ?? null);
        const next = { ...v, email: data.email }; // item 16 keeps the active address (F9-08)
        setV(next);
        setSaved(next);
        router.refresh();
      } else if (out.errors) fe.fromServer(out.errors);
      else if (res.status === 401) router.refresh();
      else if (res.status !== 429) fatal();
    } finally {
      setBusy(false);
    }
  }

  // ── event 4: a refused channel keeps the previous value (Q8 a) ──
  function chooseChannel(ch: "MAIL" | "LINE" | "SMS") {
    if (ch === "LINE" && !data.lineLinked) return fe.setErrors((p) => ({ ...p, notifyChannel: { field: "notifyChannel", code: "PE050" } }));
    if (ch === "SMS" && v.smsOptIn !== "1") return fe.setErrors((p) => ({ ...p, notifyChannel: { field: "notifyChannel", code: "PE051" } }));
    fe.setErrors((p) => {
      const n = { ...p };
      delete n.notifyChannel;
      return n;
    });
    set({ notifyChannel: ch });
  }

  // ── event 6 ──
  async function changeLanguage(next: Lang) {
    const res = await apiFetch(...postJson("/api/locale", { language: next }));
    if (res?.ok) {
      toast("PI044", { lang: next });
      router.refresh(); // same screen in the new language; the entered values are kept
    }
  }

  // ── event 13 ──
  async function unlink() {
    const res = await apiFetch(...postJson("/api/mypage/line/unlink", {}));
    if (res?.ok) {
      toast("PI058");
      router.refresh();
    } else if (res && res.status !== 429) fatal();
  }

  const channelError = err("notifyChannel");
  const lineState = !data.lineLinked ? "lineNone" : data.lineFriend === "FOLLOWING" ? "lineLinked" : "lineNeedFriend";

  return (
    <div className="col g16" data-testid="p06">
      <h1 className="m0" style={{ fontSize: 22 }}>{label("navMypage", lang)}</h1>
      <div className="mp">
        <aside className="col g12">
          <nav className="col g8" aria-label={label("navMypage", lang)}>
            <Link className="btn bs" href="/bookings"><Icon name="cal" />{label("navBookings", lang)}</Link>
            <Link className="btn bs" href="/mypage/family"><Icon name="user" />{label("familyBtn", lang)}</Link>
            <Link className="btn bp" href="/booking/new">{label("bookCta", lang)}</Link>
          </nav>
          <Withdraw lang={lang} />
        </aside>

        <div className="col g16">
          {(data.bounced || data.lineFriend === "UNFOLLOWED") && (
            <div className="warn col g4" data-testid="p06-notice">
              {data.bounced && <p className="m0 row"><Icon name="alert" />{t("PI059", lang)}</p>}
              {data.lineFriend === "UNFOLLOWED" && <p className="m0 row"><Icon name="alert" />{t("PI060", lang)}</p>}
            </div>
          )}
          <ErrorSummary errors={fe.summary} lang={lang} />
          <form className="col g16" noValidate onSubmit={(e) => { e.preventDefault(); if (changed) void save(); }}>
            <section className="frm" aria-labelledby={id("sec-profile")}>
              <h2 id={id("sec-profile")}>{label("secProfile", lang)}</h2>
              <NameFields form={FORM} lang={lang} values={v} set={set} blur={fe.blur} err={err} />
              <BirthSexFields form={FORM} lang={lang} values={v} set={set} blur={fe.blur} err={err} />
              <AddressFields form={FORM} lang={lang} values={v} set={set} blur={fe.blur} err={err} />
            </section>

            <section className="frm" aria-labelledby={id("sec-login")}>
              <h2 id={id("sec-login")}>{label("loginInfo", lang)} {pending && <span className="badge badge-warn">{label("pendingBadge", lang)}</span>}</h2>
              <Field id={id("email")} name={label("fEmail", lang)} lang={lang} required error={err("email") ?? inlineEmail}>
                <input
                  id={id("email")} className="inp" type="email" autoComplete="email" maxLength={254} value={v.email ?? ""}
                  onChange={(e) => set({ email: e.target.value })} onBlur={() => fe.blur("email")} {...invalid(id("email"), err("email") ?? inlineEmail)}
                />
                {pending && <p className="xs mut row m0" data-testid="p06-pending"><Icon name="clock" size={14} />{label("pendingEmail", lang, { address: pending })}</p>}
              </Field>
              <PasswordChange lang={lang} />
            </section>

            <section className="frm" aria-labelledby={id("sec-lang")}>
              <h2 id={id("sec-lang")}>{label("secLangNotify", lang)}</h2>
              <Field id={id("language")} name={label("displayLang", lang)} lang={lang} required>
                <select id={id("language")} className="inp w-pref" value={lang} onChange={(e) => void changeLanguage(e.target.value as Lang)}>
                  {LANGS.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
                </select>
              </Field>
              <Field id={id("notifyChannel")} name={label("notifyChannel", lang)} lang={lang} required group error={channelError}>
                <div className="seg" style={{ gridTemplateColumns: "1fr 1fr 1fr" }} role="radiogroup" aria-labelledby={`${id("notifyChannel")}-lbl`}>
                  {(["MAIL", "LINE", "SMS"] as const).map((ch, i) => (
                    <label key={ch} className={`lopt ${v.notifyChannel === ch ? "on" : ""}`}>
                      <input id={i === 0 ? id("notifyChannel") : undefined} type="radio" name={id("notifyChannel")} checked={v.notifyChannel === ch} onChange={() => chooseChannel(ch)} />
                      {label(`ch${ch}`, lang)}
                    </label>
                  ))}
                </div>
              </Field>
              <label className={`chk ${v.smsOptIn === "1" ? "on" : ""}`} htmlFor={id("smsOptIn")}>
                <input
                  id={id("smsOptIn")} type="checkbox" checked={v.smsOptIn === "1"} onChange={(e) => set({ smsOptIn: e.target.checked ? "1" : "" })}
                  onBlur={() => fe.blur("notifyChannel")}
                />
                <span>{label("smsAgree", lang)}<span className="xs mut">{label("smsHint", lang)}</span></span>
              </label>
              <div className="fld">
                <span className="lbl">{label("lineGroup", lang)}</span>
                <div className="col g8">
                  <span className={`badge ${data.lineLinked ? (lineState === "lineLinked" ? "badge-pri" : "badge-warn") : ""}`} data-testid="p06-line">{label(lineState, lang)}</span>
                  {data.lineLinked ? (
                    <Button variant="secondary" onClick={unlink}>{label("lineUnlink", lang)}</Button>
                  ) : (
                    // event 5: unsaved input is lost on the way to LINE (Q9 a)
                    <a className="btn bs" href="/api/mypage/line/start">{label("lineLink", lang)}</a>
                  )}
                  {data.inline === "PE052" && <p className="fe m0" role="alert"><Icon name="alert" size={16} />{t("PE052", lang)}</p>}
                </div>
              </div>
            </section>

            <section className="frm" aria-labelledby={id("sec-cards")}>
              <h2 id={id("sec-cards")}>{label("secCards", lang)}</h2>
              <table className="tbl">
                <thead><tr><th>{label("clinicLabel", lang)}</th><th>{label("cardNoCol", lang)}</th><th>{label("cardState", lang)}</th></tr></thead>
                <tbody>
                  {data.cards.map((c) => {
                    const k = cardKey(c.clinicId);
                    const savedNo = saved[k] ?? "";
                    return (
                      <tr key={c.clinicId}>
                        <td>{c.name}</td>
                        <td>
                          <input
                            id={id(k)} className="inp" value={v[k] ?? ""} maxLength={20} readOnly={c.confirmed} placeholder={label("unregistered", lang)}
                            aria-label={`${c.name} ${label("cardNo", lang)}`} onChange={(e) => set({ [k]: e.target.value })} onBlur={() => fe.blur(k)}
                            {...invalid(id(k), err(k))}
                          />
                          {err(k) && <p className="fe m0" id={`${id(k)}-err`}><Icon name="alert" size={16} />{err(k)}</p>}
                        </td>
                        <td>{!savedNo ? label("dash", lang) : label(c.confirmed ? "confirmed" : "unconfirmed", lang)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="xs mut m0">{label("cardNote", lang)}</p>
            </section>

            <div className="mp-save">
              <Button type="submit" full disabled={!changed} busy={busy}>{label("saveBtn", lang)}</Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

/** items 27–30 (event 12): separate from 保存する; all three required once one is filled (Q13 c) */
function PasswordChange({ lang }: { lang: Lang }) {
  const apiFetch = useApiFetch();
  const { toast } = useToast();
  const router = useRouter();
  const fatal = useFatal();
  const [p, setP] = useState({ currentPassword: "", newPassword: "", newPasswordConfirm: "" });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const check = useCallback((): ServerError[] => {
    if (!filled(p.currentPassword) && !filled(p.newPassword) && !filled(p.newPasswordConfirm)) return [];
    const list: ServerError[] = blank(p.currentPassword) ? [{ field: "currentPassword", code: "PE001" }] : [];
    return [...list, ...checkNewPassword(p.newPassword, p.newPasswordConfirm, "newPassword", "newPasswordConfirm")];
  }, [p]);
  const fe = useFieldErrors(`${FORM}pw`, { currentPassword: "currentPassword", newPassword: "newPassword", newPasswordConfirm: "newPasswordConfirm" }, lang, check);
  const id = (f: string) => fieldId(`${FORM}pw`, f);
  const ready = filled(p.currentPassword) && filled(p.newPassword) && filled(p.newPasswordConfirm);

  async function change() {
    if (!fe.all()) return;
    setBusy(true); // Q13 g: disabled while the request runs
    try {
      const res = await apiFetch(...postJson("/api/mypage/password", p));
      if (!res) return;
      const out = await res.json().catch(() => ({}));
      if (res.ok) {
        setP({ currentPassword: "", newPassword: "", newPasswordConfirm: "" });
        toast("PI049");
      } else if (out.errors) fe.fromServer(out.errors);
      else if (res.status === 401) router.refresh();
      else if (res.status !== 429) fatal();
    } finally {
      setBusy(false);
    }
  }
  const input = (f: keyof typeof p, auto: string, name: LabelKey, help?: string) => (
    <Field id={id(f)} name={label(name, lang)} lang={lang} error={fe.textOf(f)} help={help}>
      <input
        id={id(f)} className="inp" type={show ? "text" : "password"} autoComplete={auto} maxLength={64} value={p[f]}
        onChange={(e) => setP((x) => ({ ...x, [f]: e.target.value }))} onBlur={() => fe.blur(f)} {...invalid(id(f), fe.textOf(f))}
      />
    </Field>
  );
  return (
    <div className="col g12">
      {input("currentPassword", "current-password", "currentPassword")}
      <ShowPassword id={id("show")} lang={lang} on={show} onChange={setShow} />
      {input("newPassword", "new-password", "newPassword", label("pwRule", lang))}
      {input("newPasswordConfirm", "new-password", "newPasswordConfirm")}
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Button variant="secondary" disabled={!ready || busy} onClick={change}>{label("pwChangeBtn", lang)}</Button>
        <span className="xs mut">{label("pwChangeHelp", lang)}</span>
      </div>
    </div>
  );
}

/** items 24, 24-1, 24-2 and the PW003 dialog (events 9–11) */
function Withdraw({ lang }: { lang: Lang }) {
  const apiFetch = useApiFetch();
  const router = useRouter();
  const fatal = useFatal();
  const [blocked, setBlocked] = useState(false);
  const [open, setOpen] = useState(false);

  async function ask(confirm: boolean) {
    const res = await apiFetch(...postJson("/api/mypage/withdraw", { confirm }));
    if (!res) return;
    if (res.status === 409) {
      setBlocked(true);
      setOpen(false);
    } else if (res.ok) {
      setBlocked(false);
      if (!confirm) setOpen(true);
      else {
        router.push("/"); // T029 → P01, PI041 there (flash)
        router.refresh();
      }
    } else if (res.status === 401) router.refresh();
    else if (res.status !== 429) fatal();
  }

  return (
    <section className="box" style={{ borderColor: "#f0b8b1" }} aria-labelledby="p06-withdraw">
      <h2 id="p06-withdraw" className="m0" style={{ fontSize: 15 }}>{label("withdrawHeading", lang)}</h2>
      <p className="m0 sm">{label("withdrawNote", lang)}</p>
      <Button variant="danger" onClick={() => ask(false)}>{label("withdrawBtn", lang)}</Button>
      {blocked && <p className="err m0 row" role="alert" data-testid="p06-pe042"><Icon name="alert" />{t("PE042", lang)}</p>}
      <ConfirmDialog
        open={open} title={label("withdrawTitle", lang)} messageId="PW003" destructive
        onConfirm={() => ask(true)} onCancel={() => setOpen(false)}
      />
    </section>
  );
}
