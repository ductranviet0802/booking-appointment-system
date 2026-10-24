"use client";

// spec-screen: P16
// 予約詳細: status (1, PI055, 20 PI057, 2), the booking (3–10), 持ち物 (11), deadline PI056 (12) or PI051 + phone (13),
// 予約を変更する (14) / キャンセルする (15), the cancel sheet / modal (16–19) and PW001. Every decision is the server's
// (抽出3 at 14 and 18, the core at はい); a refusal closes the dialogs, shows its banner and re-renders the real state.
import { notFound, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, trapTab } from "@/components/ui/ConfirmDialog";
import { ErrorSummary, FieldError, RequiredMark } from "@/components/ui/FormParts";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { useFatal } from "@/components/patient/form";
import type { FieldError as ServerError } from "@/lib/auth/validate";
import { postJson, useApiFetch } from "@/lib/client/api";
import { t, type Lang } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";
import { w2, type W2Key } from "@/lib/i18n/labels-w2";
import type { DetailView as Data } from "@/lib/patient/bookings";
import { checkCancelReason, PATIENT_REASONS } from "@/lib/patient/cancel-rules";
import s from "./detail.module.css";

const FIELD_NAME: Record<string, W2Key> = { reason: "reasonField", reasonText: "reasonOtherField" };
/** T062: P11 change mode (slot w1's route) */
export const changeHref = (id: string) => `/bookings/${id}/change`;
const newToken =() => globalThis.crypto?.randomUUID?.() ?? `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function DetailView({ data, lang }: { data: Data; lang: Lang }) {
  const router = useRouter();
  const apiFetch = useApiFetch();
  const { toast } = useToast();
  const fatal = useFatal();
  const [gone, setGone] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | { token: string; from: Data["state"] }>(null);
  const [reason, setReason] = useState("");
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<ServerError[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<"change" | "check" | null>(null);
  const firstRadio = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (sheet) firstRadio.current?.focus(); // 3-1: focus to 16-1
  }, [sheet]);

  if (gone) notFound(); // not the account's (any more) → ER-01

  const st = data.state;
  const actions = st === "BASE" || st === "ADJUST";
  const errorOf = (f: string) => {
    const e = errors.find((x) => x.field === f);
    return e ? t(e.code, lang, { 項目: w2(FIELD_NAME[f], lang), ...(e.params ?? {}) }) : null;
  };

  /** answers that leave the screen; true when handled */
  function left(res: Response) {
    if (res.status === 404) setGone(true);
    else if (res.status === 401) router.refresh(); // session ended → ER-05
    else if (res.status === 403 || res.status >= 500 || res.status === 400) fatal(); // ER-02
    else return res.status === 429; // PE092 toast, stay
    return true;
  }

  /** PE041 / PE044 / PE045 / PE047: dialogs closed, banner at the top of the status area, real state re-rendered (Q5 A) */
  function refused(code: string) {
    setConfirm(false);
    setSheet(null);
    setBanner(code);
    router.refresh();
  }

  async function recheck(): Promise<boolean> {
    const res = await apiFetch(...postJson("/api/bookings/check", { bookingId: data.id, version: data.version }));
    if (!res) return false;
    if (res.status === 409) {
      refused(((await res.json()) as { code: string }).code);
      return false;
    }
    if (left(res)) return false;
    return res.ok;
  }

  // event 2
  async function change() {
    setBanner(null);
    setBusy("change");
    try {
      if (await recheck()) router.push(changeHref(data.id));
    } finally {
      setBusy(null);
    }
  }

  // event 3
  function openSheet() {
    setBanner(null);
    setReason("");
    setText("");
    setErrors([]);
    setSheet({ token: newToken(), from: st }); // one idempotency token per opened dialog
  }

  // event 4
  async function press18() {
    const list = checkCancelReason(reason, text);
    setErrors(list);
    if (list.length) return document.getElementById(`p16-${list[0].field}`)?.focus();
    setBusy("check");
    try {
      if (await recheck()) setConfirm(true);
    } finally {
      setBusy(null);
    }
  }

  // event 5
  async function cancel() {
    if (!sheet) return;
    const res = await apiFetch(...postJson("/api/bookings/cancel", {
      bookingId: data.id, version: data.version, reasonCode: reason, reasonText: reason === "OTHER" ? text : "", token: sheet.token,
    }));
    if (!res) return;
    const out = (await res.json().catch(() => ({}))) as { code?: string; errors?: ServerError[] };
    if (res.ok) {
      setConfirm(false);
      setSheet(null);
      toast("PI050");
      return router.refresh(); // T063: state ④
    }
    if (res.status === 409 && out.code) return refused(out.code);
    if (res.status === 400 && out.errors) {
      setConfirm(false); // 5-2: back to ⑥ with the messages
      return setErrors(out.errors);
    }
    left(res);
  }

  function pick(code: string) {
    setReason(code);
    if (code !== "OTHER") setText(""); // event 11-2: text discarded
  }

  function radioKey(e: React.KeyboardEvent, i: number) {
    const to = e.key === "ArrowDown" || e.key === "ArrowRight" ? i + 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? i - 1 : -1;
    if (to < 0 || to >= PATIENT_REASONS.length) return;
    e.preventDefault();
    pick(PATIENT_REASONS[to]);
    document.getElementById(`p16-r-${PATIENT_REASONS[to]}`)?.focus();
  }

  const close = () => setSheet(null); // event 10: entries discarded
  const summary = errors.map((e) => ({ fieldId: `p16-${e.field}`, message: errorOf(e.field)! }));

  return (
    <div className={s.wrap} data-testid="p16" data-state={st}>
      <h1 className="m0" style={{ fontSize: 22 }}>{w2("detailTitle", lang)}</h1>

      <section className={s.status}>
        {banner && <p className="err m0 row" role="alert" data-testid="p16-banner"><Icon name="alert" />{t(banner, lang)}</p>}
        {st === "ADJUST" && <p className="warn m0" data-testid="p16-pi057"><Icon name="alert" />{t("PI057", lang)}</p>}
        <p className="m0 row" style={{ flexWrap: "wrap" }}>
          <span className={`${s.badge} ${s[st] ?? ""}`} data-testid="p16-badge">
            <Icon name={st === "CANCELED" ? "close" : st === "BASE" || st === "AFTER" ? "check" : "alert"} size={14} />{data.badge}
          </span>
          {st === "PENDING" && <span className="sm mut" data-testid="p16-pi055">{t("PI055", lang)}</span>}
        </p>
        {data.canceled && <p className="m0 sm" data-testid="p16-canceled">{data.canceled}</p>}
      </section>

      <div className={s.grid}>
        <div className="box">
          <dl className={s.items}>
            <div><dt>{w2("bookingNo", lang)}</dt><dd className={s.no}>{data.bookingNo}</dd></div>
            <div className={s.when}><dt>{w2("dateTime", lang)}</dt><dd>{data.dateText}</dd></div>
            <div><dt>{w2("person", lang)}</dt><dd>{data.person}</dd></div>
            <div>
              <dt>{w2("clinic", lang)}</dt>
              <dd className="col g4">
                <span>{data.clinic.name}</span>
                <span className="sm mut">{data.clinic.address}</span>
                <a className="lnk row" href={data.clinic.tel} style={{ width: "fit-content" }}><Icon name="phone" size={16} />{data.clinic.phone}</a>
              </dd>
            </div>
            <div><dt>{w2("deptVisit", lang)}</dt><dd>{data.deptVisit}</dd></div>
            <div><dt>{w2("doctor", lang)}</dt><dd data-testid="p16-doctor">{data.doctor}</dd></div>
            {st !== "CANCELED" && data.price && <div><dt>{w2("price", lang)}</dt><dd>{data.price}</dd></div>}
            {st !== "CANCELED" && data.notes !== null && <div><dt>{w2("notes", lang)}</dt><dd className={s.notes} data-testid="p16-notes">{data.notes}</dd></div>}
          </dl>
          {(st === "BASE" || st === "AFTER" || st === "ADJUST") && data.notice && (
            <div className="warn" data-testid="p16-notice">
              <span><b className="md:hidden">{w2("bringHeading", lang)}<br /></b><b className="hidden md:inline">{w2("bringPrefix", lang)} </b>{data.notice}</span>
            </div>
          )}
        </div>

        {(st === "BASE" || st === "AFTER" || actions) && (
          <aside className={`box ${s.side}`}>
            {st === "BASE" && <p className="m0 row sm" data-testid="p16-pi056"><Icon name="clock" />{t("PI056", lang, { 期限: data.deadline })}</p>}
            {st === "AFTER" && (
              <div className="col g8" data-testid="p16-phone">
                <p className="m0 sm">{data.phoneText}</p>
                <a className="btn bs" href={data.clinic.tel}><Icon name="phone" />{w2("callBtn", lang, { phone: data.clinic.phone })}</a>
              </div>
            )}
            {actions && (
              <div className="col g8">
                <Button full busy={busy === "change"} disabled={!!busy} onClick={change} data-testid="p16-change">{w2("changeBtn", lang)}</Button>
                <Button full variant="danger" disabled={!!busy} onClick={openSheet} data-testid="p16-cancel">{w2("cancelBtn", lang)}</Button>
              </div>
            )}
          </aside>
        )}
      </div>

      {sheet && (
        <div className={s.scrim} onKeyDown={(e) => { if (e.key === "Escape" && !confirm) close(); trapTab(e); }}>
          <div className={s.sheet} role="dialog" aria-modal="true" aria-labelledby="p16-sheet-title" data-testid="p16-sheet">
            <h2 id="p16-sheet-title" className="m0" style={{ fontSize: 17 }}>{w2("cancelSheetTitle", lang)}</h2>
            {sheet.from === "ADJUST" && <p className="warn m0 sm">{t("PI057", lang)}</p>}
            {sheet.from === "BASE" && <p className="m0 xs mut">{t("PI056", lang, { 期限: data.deadline })}</p>}
            <p className="m0 sm" data-testid="p16-summary">{data.summary}</p>
            <ErrorSummary errors={summary} lang={lang} />
            <div className="col g8">
              <span className="lbl" id="p16-reason-lbl">{w2("reason", lang)}<RequiredMark lang={lang} /></span>
              <div id="p16-reason" role="radiogroup" aria-labelledby="p16-reason-lbl" tabIndex={-1} className={s.radios} aria-describedby={errorOf("reason") ? "p16-reason-err" : undefined}>
                {PATIENT_REASONS.map((code, i) => (
                  <button
                    key={code} id={`p16-r-${code}`} ref={i === 0 ? firstRadio : undefined} type="button" role="radio" aria-checked={reason === code}
                    className={`${s.radio} ${reason === code ? s.radioOn : ""}`} onClick={() => pick(code)} onKeyDown={(e) => radioKey(e, i)}
                  >
                    <span className={s.dot} aria-hidden="true" />{w2(`r${code}` as W2Key, lang)}
                  </button>
                ))}
              </div>
              <FieldError id="p16-reason-err" message={errorOf("reason")} />
            </div>
            {reason === "OTHER" && (
              <div className="col g4">
                <label className="lbl" htmlFor="p16-reasonText">{w2("reasonOther", lang)}<RequiredMark lang={lang} /></label>
                <textarea
                  id="p16-reasonText" className="inp" rows={3} value={text} onChange={(e) => setText(e.target.value)}
                  aria-invalid={errorOf("reasonText") ? true : undefined} aria-describedby={errorOf("reasonText") ? "p16-reasonText-err" : undefined}
                />
                <span className="xs mut" style={{ textAlign: "right" }}>{w2("counter", lang, { n: [...text].length })}</span>
                <FieldError id="p16-reasonText-err" message={errorOf("reasonText")} />
              </div>
            )}
            <div className={s.sheetActs}>
              <Button variant="danger-fill" busy={busy === "check"} onClick={press18} data-testid="p16-submit">{w2("cancelBtn", lang)}</Button>
              <button type="button" className={`btn bs ${s.deskOnly}`} onClick={close}>{label("close", lang)}</button>
            </div>
            <button type="button" className={`ib ${s.x}`} aria-label={label("close", lang)} onClick={close}><Icon name="close" /></button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirm} destructive messageId="PW001" title={w2("confirmTitle", lang)}
        onConfirm={cancel} onCancel={() => setConfirm(false)}
      />
    </div>
  );
}
