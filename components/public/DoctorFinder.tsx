"use client";
// spec-screen: P08
// Search conditions (items 1–7) and the client parts of the result (16 page control, 18 clear). Every move updates the query string with
// one history entry (T037); the page re-reads on the server. State ① = card skeletons while the navigation runs, filters stay usable.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState, useTransition } from "react";
import { Icon } from "@/components/ui/Icon";
import { Skeleton } from "@/components/ui/Skeleton";
import type { Lang } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";
import type { Options } from "@/lib/public/doctors";
import { departmentsFor, doctorQueryString, type DoctorQuery } from "@/lib/public/query";
import { trimKeyword } from "@/lib/public/keyword";
import { languageName } from "@/lib/public/text";
import { cutKeyword } from "./HomeSearch";

const Nav = createContext<{ go: (qs: string) => void; pending: boolean }>({ go: () => {}, pending: false });

export function FinderShell({ lang, options, query, children }: { lang: Lang; options: Options; query: DoctorQuery; children: React.ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [f, setF] = useState({ keyword: query.keyword, clinic: query.clinic, department: query.department, language: query.language });
  const [open, setOpen] = useState(false); // mobile panel, closed at first (Q1)
  // the form follows the URL (back button, clear in state ②); the panel stays as it is
  const qs = doctorQueryString(query);
  const [seen, setSeen] = useState(qs);
  if (seen !== qs) {
    setSeen(qs);
    setF({ keyword: query.keyword, clinic: query.clinic, department: query.department, language: query.language });
  }
  const go = (qs: string) => startTransition(() => router.push(qs ? `/doctors?${qs}` : "/doctors"));
  const search = (next = f) => go(doctorQueryString({ ...next, keyword: trimKeyword(next.keyword) }));
  const departments = departmentsFor(options, f.clinic);
  const badge = [f.clinic, f.department, f.language].filter(Boolean).length;
  const onClinic = (clinic: string) => {
    // event 3: the department returns to すべて when the chosen clinic does not offer it
    const keep = !clinic || departmentsFor(options, clinic).some((d) => d.code === f.department);
    const next = { ...f, clinic, department: keep ? f.department : "" };
    setF(next);
    search(next);
  };
  const pick = (k: "department" | "language") => (v: string) => {
    const next = { ...f, [k]: v };
    setF(next);
    search(next);
  };
  const clear = () => {
    setF({ keyword: "", clinic: "", department: "", language: "" });
    go("");
  };
  const select = (id: string, text: string, value: string, onChange: (v: string) => void, opts: Array<{ value: string; text: string }>) => (
    <div className="flex flex-col gap-1">
      <label className="lbl" htmlFor={id}>{text}</label>
      <select id={id} className="inp" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{label("allOption", lang)}</option>
        {opts.map((o) => <option key={o.value} value={o.value}>{o.text}</option>)}
      </select>
    </div>
  );
  return (
    <Nav.Provider value={{ go, pending }}>
      <div className="flex flex-col gap-5 md:flex-row md:items-start" data-testid="p08">
        <form
          className="flex flex-col gap-3 md:w-[260px] md:shrink-0"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <h1 className="m-0 text-xl font-bold">{label("doctorsHeading", lang)}</h1>
          <div className="flex flex-col gap-1">
            <label className="lbl hidden md:flex" htmlFor="p08-keyword">{label("keyword", lang)}</label>
            <div className="flex gap-2">
              <input
                id="p08-keyword"
                className="inp"
                type="search"
                name="keyword"
                value={f.keyword}
                placeholder={label("kwPlaceholder", lang)}
                aria-label={label("keyword", lang)}
                autoComplete="off"
                onChange={(e) => setF({ ...f, keyword: cutKeyword(e.target.value) })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault();
                }}
              />
              <button type="button" className="btn bs md:hidden" aria-expanded={open} aria-controls="p08-panel" onClick={() => setOpen((v) => !v)}>
                {label("filterBtn", lang)}
                {badge > 0 && <span className="rounded-full bg-[color:var(--pri)] px-2 text-xs text-white" data-testid="p08-badge">{badge}</span>}
                <Icon name="down" size={16} />
              </button>
            </div>
          </div>
          <div id="p08-panel" className={`${open ? "flex" : "hidden"} flex-col gap-3 md:flex`}>
            {select("p08-clinic", label("clinicLabel", lang), f.clinic, onClinic, options.clinics.map((c) => ({ value: c.code, text: c.name })))}
            {select("p08-department", label("departmentLabel", lang), f.department, pick("department"), departments.map((d) => ({ value: d.code, text: d.name })))}
            {select("p08-language", label("languageLabel", lang), f.language, pick("language"), options.languages.map((l) => ({ value: l, text: languageName(l) })))}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn bs flex-1 whitespace-normal px-3" onClick={clear}>{label("clearBtn", lang)}</button>
              <button type="submit" className="btn bp flex-1 whitespace-normal px-3"><Icon name="search" />{label("searchBtn", lang)}</button>
            </div>
          </div>
        </form>
        <div className="min-w-0 flex-1" aria-busy={pending}>
          {pending ? (
            <div className="grid gap-4 md:grid-cols-3" data-testid="p08-skeleton">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="box"><Skeleton style={{ height: 18, width: "60%" }} /><Skeleton style={{ height: 18 }} /><Skeleton style={{ height: 18 }} /></div>
              ))}
            </div>
          ) : (
            children
          )}
        </div>
      </div>
    </Nav.Provider>
  );
}

/** item 16: 前へ / numbers (desktop) / 現在ページ (mobile) / 次へ; the current page and a disabled end are not links */
export function Pager({ query, page, pages, lang }: { query: DoctorQuery; page: number; pages: number; lang: Lang }) {
  const { go } = useContext(Nav);
  const to = (p: number) => doctorQueryString({ ...query, page: p });
  const link = (p: number, text: React.ReactNode, cls: string, aria?: string) => (
    <Link
      key={`${cls}${p}`}
      href={`/doctors${to(p) ? `?${to(p)}` : ""}`}
      className={cls}
      aria-label={aria}
      onClick={(e) => {
        e.preventDefault();
        go(to(p));
      }}
    >
      {text}
    </Link>
  );
  const off = (text: string) => <span className="btn btn-sm bdis" aria-disabled="true">{text}</span>;
  return (
    <nav aria-label={label("pagerAria", lang)} className="flex flex-wrap items-center justify-center gap-2" data-testid="p08-pager">
      {page > 1 ? link(page - 1, label("prevPage", lang), "btn btn-sm bs") : off(label("prevPage", lang))}
      <span className="hidden items-center gap-2 md:flex">
        {Array.from({ length: pages }, (_, i) => i + 1).map((p) =>
          p === page ? (
            <span key={p} className="btn btn-sm bp" aria-current="page">{p}</span>
          ) : (
            link(p, p, "btn btn-sm bs")
          ),
        )}
      </span>
      <span className="md:hidden" data-testid="p08-page-of">{label("pageOf", lang, { page, pages })}</span>
      {page < pages ? link(page + 1, label("nextPage", lang), "btn btn-sm bs") : off(label("nextPage", lang))}
    </nav>
  );
}

/** items 18 (event 4) and 19 (event 8) of state ② */
export function NoResultActions({ lang }: { lang: Lang }) {
  const { go } = useContext(Nav);
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <button type="button" className="btn bs" onClick={() => go("")}>{label("clearBtn", lang)}</button>
      <Link className="btn bs" href="/clinics">{label("seeClinics", lang)}</Link>
    </div>
  );
}
