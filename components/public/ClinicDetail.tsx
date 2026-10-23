// spec-screen: P10
// Clinic page (state 基): tabs, notice, basic information, hours, closures, departments, doctors, booking button.
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import type { Lang } from "@/lib/i18n";
import { formatTimeRange } from "@/lib/i18n/format";
import { label } from "@/lib/i18n/labels";
import { WEEK_ORDER, type HoursTable } from "@/lib/public/hours";
import { formatPhone, telHref } from "@/lib/public/phone";
import { postcodeText } from "@/lib/public/text";
import type { loadClinicPage } from "@/lib/public/p10";

type Data = NonNullable<Awaited<ReturnType<typeof loadClinicPage>>>;

const wdColor = (wd: number) => (wd === 6 ? "text-[color:var(--sat)]" : wd === 0 ? "text-[color:var(--sun)]" : "");
const wdName = (wd: number, lang: Lang) => (wd === 0 ? label("sunHoliday", lang) : label(`wd${wd}` as "wd1", lang));
const bandName = (band: "AM" | "PM", lang: Lang) => label(band === "AM" ? "bandAM" : "bandPM", lang);

function Cell({ hours, wd, band, lang }: { hours: HoursTable; wd: number; band: "AM" | "PM"; lang: Lang }) {
  const c = hours.cell(wd, band);
  if (c.kind === "usual") return <td className="px-2 py-2 text-center" aria-label={label("openAria", lang)}>{label("openMark", lang)}</td>;
  if (c.kind === "own") return <td className="px-2 py-2 text-center text-sm whitespace-nowrap">{formatTimeRange(c.open, c.close, lang)}</td>;
  return <td className="px-2 py-2 text-center text-[color:var(--mut)]">{label("closedMark", lang)}</td>;
}

function HoursTables({ hours, lang }: { hours: HoursTable; lang: Lang }) {
  const th = "px-2 py-2 font-bold bg-[color:var(--pri-t)] border border-[color:var(--line)]";
  const td = "border border-[color:var(--line)]";
  const bandHead = (b: HoursTable["bands"][number]) => `${bandName(b.band, lang)} ${formatTimeRange(b.open, b.close, lang)}`;
  return (
    <>
      {/* desktop: rows = bands, columns = weekdays */}
      <table className="hidden w-full border-collapse md:table" data-testid="hours-desktop">
        <thead>
          <tr>
            <td className={th} />
            {WEEK_ORDER.map((wd) => <th key={wd} scope="col" className={`${th} ${wdColor(wd)}`}>{wdName(wd, lang)}</th>)}
          </tr>
        </thead>
        <tbody>
          {hours.bands.map((b) => (
            <tr key={b.band}>
              <th scope="row" className={`${th} text-left whitespace-nowrap`}>{bandHead(b)}</th>
              {WEEK_ORDER.map((wd) => <Cell key={wd} hours={hours} wd={wd} band={b.band} lang={lang} />)}
            </tr>
          ))}
        </tbody>
      </table>
      {/* mobile: rows = weekdays, columns = bands */}
      <table className="w-full border-collapse md:hidden" data-testid="hours-mobile">
        <thead>
          <tr>
            <td className={th} />
            {hours.bands.map((b) => <th key={b.band} scope="col" className={th}>{bandHead(b)}</th>)}
          </tr>
        </thead>
        <tbody>
          {WEEK_ORDER.map((wd) => (
            <tr key={wd} className={td}>
              <th scope="row" className={`${th} text-left ${wdColor(wd)}`}>{wdName(wd, lang)}</th>
              {hours.bands.map((b) => <Cell key={b.band} hours={hours} wd={wd} band={b.band} lang={lang} />)}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function ClinicDetail({ data, lang }: { data: Data; lang: Lang }) {
  const { clinic, tabs, hours, closures, departments, doctors } = data;
  const bookHref = `/booking/new?clinic=${encodeURIComponent(clinic.code)}`;
  const address = lang === "ja" ? `${postcodeText(clinic.postcode)} ${clinic.address}` : clinic.address;
  const reception = hours.reception;
  return (
    <div className="flex flex-col gap-5 pb-20 md:pb-0" data-testid="p10-clinic">
      <h1 className="m-0 text-xl font-bold">{label("clinicInfoHeading", lang)}</h1>
      {tabs.length > 0 && (
        <nav aria-label={label("switchClinicAria", lang)} className="flex gap-2 overflow-x-auto" data-testid="p10-tabs">
          {tabs.map((t) => (
            <Link
              key={t.code}
              href={`/clinics/${t.code}`}
              aria-current={t.code === clinic.code ? "page" : undefined}
              className={`btn btn-sm shrink-0 ${t.code === clinic.code ? "bp" : "bs"}`}
            >
              {t.name}
            </Link>
          ))}
        </nav>
      )}
      {clinic.notice && (
        <p className="m-0 flex gap-2 rounded-lg bg-[color:var(--pri-t)] p-3 whitespace-pre-line" data-testid="p10-notice">
          <Icon name="alert" />
          <span>{clinic.notice}</span>
        </p>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-5">
          <section className="box" aria-label={clinic.name}>
            <h2 className="m-0 text-lg font-bold">{clinic.name}</h2>
            <p className="m-0 flex gap-2"><Icon name="pin" /><span>{address}</span></p>
            {clinic.mapUrl && (
              <a className="lnk inline-flex items-center gap-1" href={clinic.mapUrl} target="_blank" rel="noopener noreferrer">
                {label("mapLink", lang)}<Icon name="ext" size={16} />
                <span className="sr-only">{label("newTab", lang)}</span>
              </a>
            )}
            <a className="lnk" href={telHref(clinic.phone)}>{formatPhone(clinic.phone)}</a>
            <div className="flex flex-col gap-1">
              <b>{label("accessLabel", lang)}</b>
              <p className="m-0 whitespace-pre-line">{clinic.access}</p>
            </div>
          </section>
          <section className="box" aria-label={label("hoursHeading", lang)}>
            <h2 className="m-0 flex items-center gap-2 text-lg font-bold"><Icon name="clock" />{label("hoursHeading", lang)}</h2>
            <HoursTables hours={hours} lang={lang} />
            {reception && (
              <p className="m-0 text-sm text-[color:var(--mut)]" data-testid="p10-reception">
                {label("receptionNote", lang, {
                  bands: reception.items
                    .map((i) => label("receptionBand", lang, { band: bandName(i.band, lang), time: i.time.replace(/^0/, "") }))
                    .join(lang === "ja" ? "、" : ", "),
                })}
                {reception.minutesBefore !== null && label("receptionBefore", lang, { min: reception.minutesBefore })}
              </p>
            )}
          </section>
        </div>
        <div className="flex flex-col gap-5">
          {/* wrapper: .btn is unlayered CSS and would beat a `hidden` utility on the same element */}
          <div className="hidden md:block"><Link className="btn bp bw" href={bookHref}>{label("bookAtClinic", lang)}</Link></div>
          <section className="box" aria-label={label("closuresHeading", lang)}>
            <h2 className="m-0 flex flex-wrap items-baseline gap-2 text-lg font-bold">
              {label("closuresHeading", lang)}<small className="font-normal text-[color:var(--mut)]">{label("closuresCaption", lang)}</small>
            </h2>
            {closures.length === 0 ? (
              <p className="m-0">{label("closuresEmpty", lang)}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="p10-closures">
                {closures.map((c) => (
                  <li key={c.date} className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{c.dateText}</span>
                    <span className={`rounded px-2 text-xs font-bold ${c.kind === "special" ? "bg-[color:var(--pri-t)]" : "bg-[color:var(--dan-t)] text-[color:var(--dan)]"}`}>{c.badge}</span>
                    <span>{c.content}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {(departments.length > 0 || doctors.length > 0) && (
            <section className="box" aria-label={label("deptDoctorsHeading", lang)}>
              <h2 className="m-0 text-lg font-bold">{label("deptDoctorsHeading", lang)}</h2>
              {departments.length > 0 && (
                <ul className="m-0 flex list-none flex-wrap gap-2 p-0" data-testid="p10-departments">
                  {departments.map((d) => <li key={d} className="rounded-full bg-[color:var(--pri-t)] px-3 py-1 text-sm">{d}</li>)}
                </ul>
              )}
              {doctors.length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="p10-doctors">
                  {doctors.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                      <Link className="lnk" href={`/doctors/${d.id}`}>{d.name}</Link>
                      <span className="text-sm text-[color:var(--mut)]">{d.sub}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>
      {/* mobile sticky bar: 電話 (6-1) and このクリニックで予約 (12) */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t border-[color:var(--line)] bg-white p-3 md:hidden">
        <a className="btn bs" href={telHref(clinic.phone)}>{label("phoneBtn", lang)}</a>
        <Link className="btn bp flex-1" href={bookHref}>{label("bookAtClinic", lang)}</Link>
      </div>
    </div>
  );
}
