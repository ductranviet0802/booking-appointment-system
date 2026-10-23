// spec-screen: P08
// Result area: count (8), cards (9–15), page control (16) or the no-result state ② (17–19). Server-rendered.
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { t, type Lang } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";
import { PAGE_SIZE, doctorQueryString, type DoctorQuery, type searchDoctors } from "@/lib/public/doctors";
import { languageName } from "@/lib/public/text";
import { NoResultActions, Pager } from "./DoctorFinder";

type Result = Awaited<ReturnType<typeof searchDoctors>>;

export function DoctorResults({ query, result, lang }: { query: DoctorQuery; result: Result; lang: Lang }) {
  if (result.total === 0) {
    return (
      <div className="box items-center text-center" data-testid="p08-empty">
        <Icon name="search" size={32} />
        <p className="m-0">{t("PI031", lang)}</p>
        <NoResultActions lang={lang} />
      </div>
    );
  }
  // T038: the P08 query (with the page shown) rides along in one parameter, `from`
  const qs = doctorQueryString({ ...query, page: result.page });
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-sm" data-testid="p08-count">{label("countText", lang, { total: result.total, from: result.from, to: result.to })}</p>
      <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-3" data-testid="p08-cards">
        {result.cards.map((d) => (
          <li key={d.id} className="box relative flex-row gap-3">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[color:var(--pri-t)] text-[color:var(--mut)]">
              {d.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- /api/photos/<file> is served by the app itself
                <img src={d.photoUrl} alt={d.name} className="h-full w-full object-cover" />
              ) : (
                <Icon name="user" size={36} />
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <Link className="lnk after:absolute after:inset-0" href={`/doctors/${d.id}${qs ? `?from=${encodeURIComponent(qs)}` : ""}`}>{d.name}</Link>
              <span className="text-sm text-[color:var(--mut)]">{d.title}</span>
              <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
                {d.departments.map((x) => <li key={x} className="rounded-full bg-[color:var(--pri-t)] px-2 text-xs">{x}</li>)}
              </ul>
              <span className="flex items-center gap-1 text-sm"><Icon name="pin" size={14} />{d.clinic}</span>
              <span className="flex gap-1 text-xs font-bold text-[color:var(--mut)]">
                {d.languages.map((l) => <span key={l} title={languageName(l)}>{l.toUpperCase()}</span>)}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {result.total > PAGE_SIZE && <Pager query={query} page={result.page} pages={result.pages} lang={lang} />}
    </div>
  );
}
