"use client";

// spec-screen: P15
// 予約一覧: tabs with counts (1, 1-1…1-3; one Tab stop, ←→ move, Enter / Space / click select), the rows (2, 3–9, 8-1;
// cards on mobile, table on desktop, one Tab stop, ↑↓ move, Enter opens P16), empty state PI045 (10) with 予約する on
// 予約中 only (11), もっと見る (12), skeleton rows while a request runs (④, tabs read-only). Rows and counts are read
// again at every tab change (Q11 A); the tab is not in the URL (Q10 A).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Skeleton } from "@/components/ui/Skeleton";
import { useFatal } from "@/components/patient/form";
import { useApiFetch } from "@/lib/client/api";
import { t, type Lang } from "@/lib/i18n";
import { w2, type W2Key } from "@/lib/i18n/labels-w2";
import type { ListPage, Tab } from "@/lib/patient/bookings";
import s from "./list.module.css";

const TAB_LABEL: Record<Tab, W2Key> = { upcoming: "tabUpcoming", past: "tabPast", canceled: "tabCanceled" };
const ORDER: Tab[] = ["upcoming", "past", "canceled"];

export function ListView({ lang, initial }: { lang: Lang; initial: ListPage }) {
  const router = useRouter();
  const apiFetch = useApiFetch();
  const fatal = useFatal();
  const [tab, setTab] = useState<Tab>("upcoming");
  const [focusTab, setFocusTab] = useState<Tab>("upcoming");
  const [page, setPage] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const rowRefs = useRef<Array<HTMLAnchorElement | null>>([]);

  async function load(next: Tab, offset: number) {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/bookings/list?tab=${next}&offset=${offset}`);
      if (!res) return;
      if (res.status === 401) return router.refresh(); // session ended → ER-05 on reload
      if (!res.ok) return fatal(); // _common event 13 → ER-02
      const data = (await res.json()) as ListPage;
      setPage((prev) => (offset > 0 ? { ...data, rows: [...prev.rows, ...data.rows] } : data));
      if (offset === 0) setActive(0);
    } finally {
      setLoading(false);
    }
  }

  function select(next: Tab) {
    if (loading) return;
    setTab(next);
    setFocusTab(next);
    setPage((p) => ({ ...p, rows: [], more: false })); // ④: skeletons in place of the new tab's rows
    void load(next, 0); // event 2: rows and counts read again (Q11 A)
  }

  function onTabKey(e: React.KeyboardEvent) {
    const i = ORDER.indexOf(focusTab);
    const to = e.key === "ArrowRight" ? ORDER[(i + 1) % 3] : e.key === "ArrowLeft" ? ORDER[(i + 2) % 3] : null;
    if (to) {
      e.preventDefault();
      setFocusTab(to);
      tabRefs.current[to]?.focus();
    }
  }

  function onRowKey(e: React.KeyboardEvent) {
    const to = e.key === "ArrowDown" ? active + 1 : e.key === "ArrowUp" ? active - 1 : -1;
    if (to >= 0 && to < page.rows.length) {
      e.preventDefault();
      setActive(to);
      rowRefs.current[to]?.focus();
    }
  }

  const rows = page.rows;
  const empty = !loading && rows.length === 0;
  return (
    <div className={s.wrap} data-testid="p15">
      <h1 className="m0" style={{ fontSize: 22 }}>{w2("bookingsTitle", lang)}</h1>
      <div className={s.tabs} role="tablist" aria-label={w2("tabsAria", lang)} onKeyDown={onTabKey}>
        {ORDER.map((k) => (
          <button
            key={k} ref={(el) => { tabRefs.current[k] = el; }} type="button" role="tab" id={`p15-tab-${k}`}
            aria-selected={tab === k} aria-controls="p15-list" tabIndex={focusTab === k ? 0 : -1} disabled={loading}
            className={tab === k ? s.on : undefined} onClick={() => select(k)} data-testid={`p15-tab-${k}`}
          >
            {w2(TAB_LABEL[k], lang)}<span className={s.count}>{page.counts[k]}</span>
          </button>
        ))}
      </div>

      <div id="p15-list" role="tabpanel" aria-labelledby={`p15-tab-${tab}`} aria-busy={loading || undefined}>
        {empty ? (
          <div className={`box ${s.empty}`} data-testid="p15-empty">
            <Icon name="cal" size={32} />
            <p className="m0">{t("PI045", lang)}</p>
            {tab === "upcoming" && <Link className="btn bp" href="/booking/new?from=bookings" data-testid="p15-book">{w2("book", lang)}</Link>}
          </div>
        ) : (
          <>
            <div className={s.head} aria-hidden="true">
              <span>{w2("dateTime", lang)}</span><span>{w2("person", lang)}</span><span>{w2("colClinicDept", lang)}</span>
              <span>{w2("colVisitType", lang)}</span><span>{w2("doctor", lang)}</span><span>{w2("colStatus", lang)}</span>
              <span>{w2("bookingNo", lang)}</span>
            </div>
            <ul className={s.list} onKeyDown={onRowKey}>
              {rows.map((r, i) => (
                <li key={r.id}>
                  <a
                    ref={(el) => { rowRefs.current[i] = el; }} href={`/bookings/${r.id}`} className={s.row}
                    tabIndex={i === active ? 0 : -1} onFocus={() => setActive(i)} data-testid="p15-row"
                  >
                    <span className={s.date}>{r.dateText}</span>
                    <span className={s.person}>{r.person ?? ""}</span>
                    <span>{r.clinicDept}</span>
                    <span className={s.vt}>{r.visitType}</span>
                    <span className={s.doc}>{r.doctor}</span>
                    <span className={s.st}>
                      <span className={`badge ${r.pending ? "badge-warn" : r.statusKey === "stRESERVED" ? "badge-pri" : ""}`}>{r.status}</span>
                      {r.pending && <span className="xs mut" data-testid="p15-pi055">{t("PI055", lang)}</span>}
                    </span>
                    <span className={s.no}><span className={s.noLabel}>{w2("bookingNo", lang)} </span>{r.bookingNo}</span>
                    <Icon name="right" className={s.chev} />
                  </a>
                </li>
              ))}
            </ul>
            {loading && (
              <div className={s.list} role="status" aria-label={w2("bookingsTitle", lang)}>
                {[0, 1, 2].map((i) => <Skeleton key={i} className={s.sk} />)}
              </div>
            )}
            {page.more && !loading && (
              <button type="button" className="btn bs bw" onClick={() => load(tab, rows.length)} data-testid="p15-more">{w2("more", lang)}</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
