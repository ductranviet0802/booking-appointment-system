// spec-screen: P14
// 予約完了: steps (1), PI052 / PI053 or the status badge of state ② (2, 2-1), 予約番号 + コピー (3, 3-1), the booking (4–8),
// 持ち物 (9), PI054 (10), 予約内容を見る (11) / クリニック案内 (12). Read-only; Tab order 3-1 → 5-1 → 11 → 12.
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { t, type Lang } from "@/lib/i18n";
import { w2, type W2Key } from "@/lib/i18n/labels-w2";
import type { DoneView as Data } from "@/lib/patient/bookings";
import { CopyButton } from "./CopyButton";
import s from "./done.module.css";

export function DoneView({ data, lang }: { data: Data; lang: Lang }) {
  const steps: W2Key[] = data.firstVisit ? ["stepSelect", "stepQuestionnaire", "stepConfirm", "stepDone"] : ["stepSelect", "stepConfirm", "stepDone"];
  const reserved = data.status === "RESERVED";
  const [pre, post] = t("PI054", lang, { 通知先: "\u0000" }).split("\u0000"); // {通知先} shown bold
  return (
    <div className={s.wrap} data-testid="p14">
      <ol className={s.steps} aria-label={w2("stepsAria", lang)}>
        {steps.map((k, i) => {
          const cur = i === steps.length - 1;
          return (
            <li key={k} className={cur ? s.cur : s.done} aria-current={cur ? "step" : undefined}>
              <span className={s.dot} aria-hidden="true">{cur ? i + 1 : <Icon name="check" size={14} />}</span>
              {w2(k, lang)}
            </li>
          );
        })}
      </ol>

      <section className={`box ${s.card}`}>
        {reserved ? (
          <h1 className={s.head} data-testid="p14-message">
            <span className={s.check} aria-hidden="true"><Icon name="check" /></span>
            {t(data.changed ? "PI053" : "PI052", lang)}
          </h1>
        ) : (
          <p className={s.badge} data-testid="p14-status"><Icon name="close" size={16} />{data.statusLabel}</p>
        )}

        <div className={s.no}>
          <span className="sm mut">{w2("bookingNoPhone", lang)}</span>
          <div className="row" style={{ justifyContent: "center", flexWrap: "wrap" }}>
            <span id="p14-no" className={s.number} data-testid="p14-no">{data.bookingNo}</span>
            <CopyButton value={data.bookingNo} targetId="p14-no" lang={lang} />
          </div>
        </div>

        <dl className={s.items}>
          <div className={s.when}><dt>{w2("dateTime", lang)}</dt><dd data-testid="p14-date">{data.dateText}</dd></div>
          <div>
            <dt>{w2("clinic", lang)}</dt>
            <dd>
              {data.clinic.name}
              <a className={`lnk row ${s.tel}`} href={data.clinic.tel}><Icon name="phone" size={16} />{data.clinic.phone}</a>
            </dd>
          </div>
          <div><dt>{w2("deptVisit", lang)}</dt><dd>{data.deptVisit}</dd></div>
          <div><dt>{w2("doctor", lang)}</dt><dd data-testid="p14-doctor">{data.doctor}</dd></div>
          <div><dt>{w2("person", lang)}</dt><dd>{data.person}</dd></div>
        </dl>

        {data.notice && (
          <div className="warn" data-testid="p14-notice">
            <div className="col g4">
              <b className="md:hidden">{w2("bringHeading", lang)}</b>
              <span><b className="hidden md:inline">{w2("bringPrefix", lang)} </b>{data.notice}</span>
            </div>
          </div>
        )}

        {data.destination && (
          <p className="info m0" data-testid="p14-destination">
            <Icon name="alert" />
            <span>{pre}<b>{data.destination}</b>{post}</span>
          </p>
        )}

        <div className={s.acts}>
          <Link className="btn bp" href={`/bookings/${data.id}`}>{w2("viewBooking", lang)}</Link>
          <Link className="btn bs" href={`/clinics/${data.clinic.code}`}><Icon name="pin" />{w2("clinicGuide", lang)}</Link>
        </div>
      </section>
    </div>
  );
}
