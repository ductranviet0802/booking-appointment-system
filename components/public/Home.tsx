// spec-screen: P01
// Body of the top page: notices (1, 2), main visual (3, 3-1, 4), doctor search (5, 6), clinic cards (7–12).
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { ListSkeleton } from "@/components/ui/Skeleton";
import type { Lang } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";
import type { loadHome } from "@/lib/public/home";
import { formatPhone, telHref } from "@/lib/public/phone";
import { HomeSearch } from "./HomeSearch";
import { MaintenanceNotice } from "./MaintenanceNotice";

type Data = Awaited<ReturnType<typeof loadHome>>;

/** state ①: two skeleton cards (Q12 = A) */
export function HomeSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-3" data-testid="p01-skeleton">
      <ListSkeleton rows={4} />
      <ListSkeleton rows={4} />
    </div>
  );
}

export function Home({ data, lang }: { data: Data; lang: Lang }) {
  const { maintenance, notices, cards } = data;
  return (
    <div className="flex flex-col gap-6" data-testid="p01">
      {(maintenance || notices.length > 0) && (
        <section className="box" aria-label={label("detailMore", lang)} data-testid="p01-notices">
          {maintenance && <MaintenanceNotice text={maintenance} lang={lang} />}
          {notices.map((n) => (
            <div key={n.code} className="flex items-start gap-2">
              <Icon name="alert" />
              <p className="m-0 min-w-0 flex-1 truncate md:whitespace-normal">【{n.name}】{n.text}</p>
              <Link className="lnk inline-flex items-center" href={`/clinics/${n.code}`}>
                {label("detailMore", lang)}<Icon name="right" size={16} />
              </Link>
            </div>
          ))}
        </section>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <p className="m-0 hidden text-2xl font-bold md:block">{label("catchCopy", lang)}</p>
          <p className="m-0 hidden md:block">{label("catchSub", lang)}</p>
          <Link className="btn bp bw min-h-12" href="/booking/new">{label("bookCta", lang)}</Link>
        </div>
        <HomeSearch lang={lang} />
      </div>
      <section className="flex flex-col gap-3" aria-label={label("clinicListHeading", lang)}>
        <h2 className="m-0 text-lg font-bold">{label("clinicListHeading", lang)}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {cards.map((c) => (
            <article key={c.code} className="box" data-testid="p01-card">
              <h3 className="m-0 text-lg"><Link className="lnk" href={`/clinics/${c.code}`}>{c.name}</Link></h3>
              <p className="m-0 flex gap-2"><Icon name="pin" /><span>{c.address}</span></p>
              <a className="lnk" href={telHref(c.phone)}>{formatPhone(c.phone)}</a>
              {c.todayText ? (
                <p className="m-0 flex gap-2"><Icon name="clock" /><span>{label("todayPrefix", lang)} {c.todayText}</span></p>
              ) : (
                <p className="m-0 flex gap-2 font-bold text-[color:var(--dan)]"><Icon name="clock" /><span>{label("todayClosed", lang)}</span></p>
              )}
              {c.departments.length > 0 && (
                <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                  {c.departments.map((d) => <li key={d} className="rounded-full bg-[color:var(--pri-t)] px-3 py-1 text-sm">{d}</li>)}
                </ul>
              )}
              <Link className="btn bs bw" href={`/clinics/${c.code}`}>{label("clinicDetail", lang)}<Icon name="right" size={16} /></Link>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
