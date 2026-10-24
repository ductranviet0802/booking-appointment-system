"use client";

// spec-screen: P13
// 予約確認: the summary of the draft (items 1–14), 予約を確定する (event 2) or, in change mode, PW002 first (events 3–4).
// While the request runs the button is busy and 戻る disabled (states ② ③, Q13 A); the server answers where to go
// (P14, back to P11 with the message, P16), the client only follows. A failed connection keeps the screen (PE093 toast):
// pressing again re-sends the same draft, which the server answers with the same booking.
import { useCallback, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useFatal } from "@/components/patient/form";
import { postJson, useApiFetch } from "@/lib/client/api";
import { t } from "@/lib/i18n";
import { formatDate, formatDateShort, formatDateTime, formatPrice, formatTime, formatTimeRange } from "@/lib/i18n/format";
import { label } from "@/lib/i18n/labels";
import { lw1 } from "@/lib/i18n/labels-w1";
import { formatPhone } from "@/lib/public/phone";
import type { ConfirmProps } from "@/lib/entry/pages";
import { Steps } from "./Steps";
import { useLeaveGuard } from "./useLeaveGuard";
import s from "./confirm.module.css";

export function ConfirmView(p: ConfirmProps) {
  const { lang } = p;
  const apiFetch = useApiFetch();
  const fatal = useFatal();
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const doctor = (d: string | null) => d ?? label("noPreference", lang);
  const short = (date: string, start: string) => `${formatDateShort(date, lang)} ${formatTime(start)}${lang === "ja" ? "〜" : ""}`;

  async function confirm() {
    setAsk(false);
    setBusy(true);
    const res = await apiFetch(...postJson("/api/booking/confirm", {}));
    if (!res) return setBusy(false); // PE093 shown; the draft is unchanged
    const body = await res.json().catch(() => ({}));
    if (body.to) return window.location.assign(body.to);
    fatal();
  }
  // P13 Q2 A: a header link asks PW005; はい → the link pressed, the draft discarded
  useLeaveGuard(useCallback((href: string) => setLeaveTo(href), []));
  async function leave() {
    await apiFetch(...postJson("/api/booking/discard", { origin: p.origin }));
    window.location.assign(leaveTo ?? p.origin);
  }

  const row = (k: string, v: React.ReactNode) => (<><dt>{k}</dt><dd>{v}</dd></>);
  return (
    <div className={s.root}>
      <Steps lang={lang} withQuestionnaire={!p.changeMode && p.category === "FIRST"} current="confirm" />
      <h1 className="m0">{lw1("confirmHeading", lang)}</h1>

      {p.before && (
        <section className={s.card}>
          <h2>{lw1("changeContent", lang)}</h2>
          <dl className={s.list}>
            {row(lw1("dateTime", lang), <><s className="mut">{short(p.before.date, p.before.start)}</s> → <b>{short(p.date, p.start)}</b></>)}
            {row(lw1("doctor", lang), <><s className="mut">{doctor(p.before.doctor)}</s> → <b>{doctor(p.doctor)}</b></>)}
          </dl>
        </section>
      )}

      <section className={s.card}>
        <div className={s.when}>
          <Icon name="cal" />
          <div><span className="xs mut">{lw1("dateTime", lang)}</span><div className={s.big}>{formatDate(p.date, lang)} {formatTimeRange(p.start, p.end, lang)}</div></div>
        </div>
        <dl className={s.list}>
          {row(lw1("person", lang), `${p.name}${label("nameSuffix", lang) ? ` ${label("nameSuffix", lang)}` : ""}`)}
          {row(lw1("clinic", lang), p.clinic)}
          {row(lw1("department", lang), p.dept)}
          {row(lw1("visitType", lang), p.type)}
          {row(lw1("doctor", lang), doctor(p.doctor))}
          {p.priceYen !== null ? row(lw1("price", lang), formatPrice(p.priceYen, lang)) : row("", <span className="sm">{t("PI033", lang)}</span>)}
          {p.questionnaire && row(lw1("stepQuestionnaire", lang), p.questionnaire === "DONE" ? <span className="row"><Icon name="check" size={16} />{lw1("questionnaireDone", lang)}</span> : lw1("questionnaireKept", lang))}
          {row(lw1("notes", lang), <span className={s.pre}>{p.notes || lw1("none", lang)}</span>)}
        </dl>
        {p.notice && <div className="warn sm"><div><b>{lw1("noticeHeading", lang)}</b><div className={s.pre}>{p.notice}</div></div></div>}
        <p className="sm m0 row">
          <Icon name="clock" size={16} />
          {p.deadline.passed
            ? t("PI051", lang, { 電話案内文: p.deadline.message || lw1("phoneDefault", lang), クリニック名: p.deadline.clinic, 電話番号: formatPhone(p.deadline.phone) })
            : t("PI056", lang, { 期限: formatDateTime(new Date(p.deadline.at), lang), deadline: formatDateTime(new Date(p.deadline.at), lang) })}
        </p>
      </section>

      <div className="w1-bar back-first">
        <Button busy={busy} busyLabel={lw1(p.changeMode ? "confirmingChange" : "confirmingBooking", lang)} onClick={() => (p.changeMode ? setAsk(true) : confirm())}>
          {lw1(p.changeMode ? "confirmChange" : "confirmBooking", lang)}
        </Button>
        {busy ? <span className="lnk mut" aria-disabled>{lw1(p.backTo === "/booking/questionnaire" ? "backToQuestionnaire" : "backToDateTime", lang)}</span>
          : <a className="lnk" href={p.backTo}>{lw1(p.backTo === "/booking/questionnaire" ? "backToQuestionnaire" : "backToDateTime", lang)}</a>}
      </div>

      <ConfirmDialog open={ask} title={lw1("changeTitle", lang)} messageId="PW002" onConfirm={confirm} onCancel={() => setAsk(false)} />
      <ConfirmDialog open={leaveTo !== null} title={lw1("quitTitle", lang)} messageId="PW005" onConfirm={leave} onCancel={() => setLeaveTo(null)} />
    </div>
  );
}
