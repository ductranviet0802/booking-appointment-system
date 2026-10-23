// spec-screen: P09
// Doctor profile: back link (13), photo / name / title / departments / languages (1–6), booking box (7, 7-1), schedule (8, 9), career (10, 11), PI033 (12).
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { t, type Lang } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";
import type { loadDoctorPage } from "@/lib/public/doctor";

type Data = NonNullable<Awaited<ReturnType<typeof loadDoctorPage>>>;

const WEEKDAYS = [1, 2, 3, 4, 5, 6] as const;
const wdColor = (wd: number) => (wd === 6 ? "text-[color:var(--sat)]" : wd === 0 ? "text-[color:var(--sun)]" : "");

function Schedule({ block, lang }: { block: Data["schedule"][number]; lang: Lang }) {
  const days = block.sunday ? [...WEEKDAYS, 0] : [...WEEKDAYS];
  const th = "px-2 py-2 font-bold bg-[color:var(--pri-t)] border border-[color:var(--line)]";
  const td = "px-2 py-2 text-center text-sm border border-[color:var(--line)]";
  const cell = (wd: number, band: "AM" | "PM") => {
    const lines = block.cell(wd, band);
    return <td key={`${wd}${band}`} className={td}>{lines.length ? lines.map((l) => <div key={l} className="whitespace-nowrap">{l}</div>) : label("dash", lang)}</td>;
  };
  const wdName = (wd: number) => label(`wd${wd}` as "wd1", lang);
  return (
    <div className="flex flex-col gap-2" data-testid="p09-schedule">
      <h3 className="m-0 text-base font-bold"><Link className="lnk" href={`/clinics/${block.clinicCode}`}>{block.clinicName}</Link></h3>
      {/* desktop: weekdays as columns, 午前 / 午後 as rows */}
      <table className="hidden w-full border-collapse md:table">
        <thead>
          <tr><td className={th} />{days.map((wd) => <th key={wd} scope="col" className={`${th} ${wdColor(wd)}`}>{wdName(wd)}</th>)}</tr>
        </thead>
        <tbody>
          {(["AM", "PM"] as const).map((band) => (
            <tr key={band}><th scope="row" className={`${th} text-left`}>{label(band === "AM" ? "bandAM" : "bandPM", lang)}</th>{days.map((wd) => cell(wd, band))}</tr>
          ))}
        </tbody>
      </table>
      {/* mobile: weekdays as rows */}
      <table className="w-full border-collapse md:hidden">
        <thead>
          <tr><td className={th} /><th scope="col" className={th}>{label("bandAM", lang)}</th><th scope="col" className={th}>{label("bandPM", lang)}</th></tr>
        </thead>
        <tbody>
          {days.map((wd) => (
            <tr key={wd}><th scope="row" className={`${th} text-left ${wdColor(wd)}`}>{wdName(wd)}</th>{cell(wd, "AM")}{cell(wd, "PM")}</tr>
          ))}
        </tbody>
      </table>
      <p className="m-0 text-sm text-[color:var(--mut)]">{label("scheduleNote", lang)}</p>
    </div>
  );
}

export function DoctorDetail({ data, backHref, lang }: { data: Data; backHref: string; lang: Lang }) {
  const single = data.buttons.length === 1;
  const buttons = (cls = "") => (
    <div className={`flex flex-col gap-2 ${cls}`}>
      {data.buttons.map((b) => <Link key={b.href} className="btn bp bw !h-auto whitespace-normal py-2" href={b.href}>{b.text}</Link>)}
    </div>
  );
  return (
    <div className={`flex flex-col gap-5 ${single ? "pb-20 md:pb-0" : ""}`} data-testid="p09">
      <Link className="lnk inline-flex items-center gap-1" href={backHref}>‹ {label("backToList", lang)}</Link>
      {/* mobile order: profile head, booking, career, schedule (the wrappers dissolve and `order` sorts); desktop: two columns */}
      <div className="flex flex-col gap-5 md:grid md:grid-cols-[1fr_380px]">
        <div className="contents md:flex md:flex-col md:gap-5">
          <section className="order-1 flex gap-4 md:order-none" aria-label={data.name}>
            <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[color:var(--pri-t)] text-[color:var(--mut)] md:h-32 md:w-32">
              {data.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- /api/photos/<file> is served by the app itself
                <img src={data.photoUrl} alt={data.name} className="h-full w-full object-cover" />
              ) : (
                <Icon name="user" size={48} />
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="w-fit rounded bg-[color:var(--pri-t)] px-2 text-sm font-bold">{data.title}</span>
              <h1 className="m-0 text-2xl font-bold [overflow-wrap:anywhere]">{data.name}</h1>
              {data.kana && <span className="text-sm text-[color:var(--mut)]">{data.kana}</span>}
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {data.departments.map((d) => <li key={d} className="rounded-full bg-[color:var(--pri-t)] px-3 py-1 text-sm">{d}</li>)}
              </ul>
              <span className="flex items-center gap-1 text-sm"><Icon name="globe" size={16} />{data.languages}</span>
            </div>
          </section>
          <section className="box order-3 md:order-none">
            <h2 className="m-0 text-lg font-bold">{label("profileHeading", lang)}</h2>
            <p className="m-0 whitespace-pre-line">{data.profile}</p>
          </section>
          {data.qualifications.length > 0 && (
            <section className="box order-4 md:order-none">
              <h2 className="m-0 text-lg font-bold">{label("qualificationsHeading", lang)}</h2>
              <ul className="m-0 list-disc pl-5">{data.qualifications.map((q) => <li key={q}>{q}</li>)}</ul>
            </section>
          )}
          <p className="order-5 m-0 rounded-lg bg-[#eaf3fb] p-3 md:order-none" data-testid="p09-insurance">{t("PI033", lang)}</p>
        </div>
        <div className="contents md:flex md:flex-col md:gap-5">
          <section className="box order-2 md:order-none" aria-label={label("bookWithDoctor", lang)}>
            <h2 className="m-0 hidden text-lg font-bold md:block">{label("bookWithDoctor", lang)}</h2>
            {data.buttons.length === 0 ? (
              <p className="m-0 flex gap-2 rounded-lg bg-[#fff5e0] p-3" data-testid="p09-unavailable"><Icon name="alert" />{t("PI036", lang)}</p>
            ) : single ? (
              <div className="hidden md:block">{buttons()}</div>
            ) : (
              buttons()
            )}
          </section>
          {data.schedule.length > 0 && (
            <section className="box order-6 md:order-none" aria-label={label("scheduleHeading", lang)}>
              <h2 className="m-0 text-lg font-bold">{label("scheduleHeading", lang)}</h2>
              {data.schedule.map((b) => <Schedule key={b.clinicCode} block={b} lang={lang} />)}
            </section>
          )}
        </div>
      </div>
      {single && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[color:var(--line)] bg-white p-3 md:hidden" data-testid="p09-sticky">
          {buttons()}
        </div>
      )}
    </div>
  );
}
