// spec-screen: P01
// Body of the top page: notices (1, 2), main visual (3, 3-1, 4), doctor search (5, 6), clinic cards (7–12).
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { ListSkeleton } from "@/components/ui/Skeleton";
import type { Lang } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";
import type { loadHome } from "@/lib/public/home";
import { formatPhone, telHref } from "@/lib/public/phone";
import { ClinicMap } from "./ClinicMap";
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

/** main visual of the hero (decorative): a calendar page with a check and a medical cross, in the brand teal */
function HeroArt() {
  return (
    <svg className="p01-hero-art" viewBox="0 0 220 180" aria-hidden="true" focusable="false">
      <circle cx="150" cy="96" r="78" fill="#fff" opacity="0.55" />
      <rect x="62" y="40" width="128" height="112" rx="14" fill="#fff" stroke="#0b7a75" strokeWidth="4" />
      <rect x="62" y="40" width="128" height="30" rx="14" fill="#0b7a75" />
      <rect x="62" y="56" width="128" height="14" fill="#0b7a75" />
      <rect x="88" y="28" width="8" height="24" rx="4" fill="#08625e" />
      <rect x="156" y="28" width="8" height="24" rx="4" fill="#08625e" />
      <g fill="#bfe1dd">
        <rect x="80" y="84" width="18" height="14" rx="3" /><rect x="106" y="84" width="18" height="14" rx="3" /><rect x="132" y="84" width="18" height="14" rx="3" />
        <rect x="80" y="108" width="18" height="14" rx="3" /><rect x="106" y="108" width="18" height="14" rx="3" />
      </g>
      <rect x="130" y="104" width="40" height="40" rx="8" fill="#0b7a75" />
      <path d="M140 124l7 7 14-15" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <g transform="translate(20 108)">
        <circle cx="22" cy="22" r="22" fill="#fff" stroke="#bfe1dd" strokeWidth="3" />
        <path d="M18 10h8v8h8v8h-8v8h-8v-8h-8v-8h8z" fill="#e05a47" />
      </g>
    </svg>
  );
}

export function Home({ data, lang }: { data: Data; lang: Lang }) {
  const { maintenance, notices, cards } = data;
  const pins = cards.flatMap((c) => (c.pin ? [{ code: c.code, name: c.name, ...c.pin, href: `/clinics/${c.code}` }] : []));
  // the clinic name in front of a notice: 【】 is Japanese punctuation, en / vi use [ ]
  const tag = (name: string) => (lang === "ja" ? `【${name}】` : `[${name}] `);
  return (
    // DOM = mobile order (main visual, notices, search, cards); desktop puts the notices first by `order`
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_400px]" data-testid="p01">
      <section className="p01-hero md:order-2" aria-label={label("catchCopy", lang)}>
        <HeroArt />
        <p className="p01-catch m-0">{label("catchCopy", lang)}</p>
        <p className="m-0 hidden max-w-[34em] text-[color:var(--mut)] md:block">{label("catchSub", lang)}</p>
        <Link className="btn bp bw p01-book" href="/booking/new"><Icon name="cal" />{label("bookCta", lang)}</Link>
      </section>
      {(maintenance || notices.length > 0) && (
        <section className="box md:order-1 md:col-span-2" aria-label={label("detailMore", lang)} data-testid="p01-notices">
          {maintenance && <MaintenanceNotice text={maintenance} lang={lang} />}
          {notices.map((n) => (
            <div key={n.code} className="flex items-start gap-2">
              <Icon name="alert" />
              <p className="m-0 line-clamp-2 min-w-0 flex-1 md:line-clamp-none">{tag(n.name)}{n.text}</p>
              <Link className="lnk inline-flex items-center" href={`/clinics/${n.code}`}>
                {label("detailMore", lang)}<Icon name="right" size={16} />
              </Link>
            </div>
          ))}
        </section>
      )}
      <div className="box justify-center md:order-3">
        <HomeSearch lang={lang} />
      </div>
      <section className="flex flex-col gap-3 md:order-4 md:col-span-2" aria-label={label("clinicListHeading", lang)}>
        <h2 className="m-0 text-lg font-bold">{label("clinicListHeading", lang)}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {cards.map((c) => (
            <article key={c.code} className="box" data-testid="p01-card">
              <h3 className="m-0 text-lg"><Link className="lnk" href={`/clinics/${c.code}`}>{c.name}</Link></h3>
              <p className="m-0 flex gap-2"><Icon name="pin" /><span>{c.address}</span></p>
              <p className="m-0 flex gap-2"><Icon name="phone" /><a className="lnk" href={telHref(c.phone)}>{formatPhone(c.phone)}</a></p>
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
              {/* item 12: a button on mobile, a text link with an arrow on desktop */}
              <Link className="btn bs bw md:hidden" href={`/clinics/${c.code}`}>{label("clinicDetail", lang)}<Icon name="right" size={16} /></Link>
              <Link className="lnk hidden items-center gap-1 self-start md:inline-flex" href={`/clinics/${c.code}`}>{label("clinicDetail", lang)}<Icon name="right" size={16} /></Link>
            </article>
          ))}
        </div>
        <ClinicMap pins={pins} lang={lang} />
      </section>
    </div>
  );
}
