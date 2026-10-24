"use client";

// spec-screen: CF-01
// Patient header (_common §4.1 items 1-12): logo, global menu, language switcher, account area, mobile drawer (< 768 px).
// Server data comes in as props (see PatientFrameHeader); `logoOnly` is the logo-only CF-01 of CF-04 (state ⑧) and ER-04 (⑫).
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { LANGS, LANG_NAMES } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";
import type { LabelKey } from "@/lib/i18n/labels";
import { postJson, useApiFetch } from "@/lib/client/api";

export type PatientHeaderProps = {
  lang: Lang;
  groupName: string;
  /** "山田 太郎" of the logged-in patient (抽出2), null = anonymous */
  userName: string | null;
  /** 抽出6: /clinics, or /clinics/{code} when one clinic is active */
  clinicsHref: string;
  logoOnly?: boolean;
};

const MENU: Array<{ href: string; key: LabelKey; loginRequired: boolean }> = [
  { href: "/", key: "navTop", loginRequired: false },
  { href: "/doctors", key: "navDoctors", loginRequired: false },
  { href: "/clinics", key: "navClinics", loginRequired: false },
  { href: "/bookings", key: "navBookings", loginRequired: true },
  { href: "/mypage", key: "navMypage", loginRequired: true },
];

function Logo({ groupName, link }: { groupName: string; link: boolean }) {
  const inner = (
    <>
      <span className="lm"><Icon name="plus" /></span>
      <span className="logo-name">{groupName}</span>
    </>
  );
  // ⑧ ⑫: shown but not a link (Q14)
  return link ? <Link className="logo" href="/">{inner}</Link> : <span className="logo">{inner}</span>;
}

export function PatientHeader({ lang, groupName, userName, clinicsHref, logoOnly = false }: PatientHeaderProps) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const apiFetch = useApiFetch();
  const { toast } = useToast();
  const [drawer, setDrawer] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const burger = useRef<HTMLButtonElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const langBox = useRef<HTMLDivElement>(null);
  const langBtn = useRef<HTMLButtonElement>(null);
  const loggedIn = userName !== null;

  useEffect(() => {
    if (drawer) closeBtn.current?.focus();
  }, [drawer]);

  useEffect(() => {
    if (langOpen) langBox.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }, [langOpen]);

  useEffect(() => {
    if (!drawer && !langOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (drawer) {
        setDrawer(false);
        burger.current?.focus(); // focus returns to item 7 (Q14)
      }
      if (langOpen) langBtn.current?.focus();
      setLangOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (langOpen && !langBox.current?.contains(e.target as Node)) setLangOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [drawer, langOpen]);

  if (logoOnly) {
    return (
      <header className="hd hd-bare" data-testid="cf01-logo-only">
        <Logo groupName={groupName} link={false} />
      </header>
    );
  }

  async function switchLang(next: Lang) {
    setLangOpen(false);
    if (next === lang) return;
    const res = await apiFetch(...postJson("/api/locale", { language: next }));
    if (res?.ok) {
      toast("PI044", { lang: next });
      router.refresh(); // same screen in the new language; client state (form input) is kept
    }
  }

  async function logout() {
    const res = await apiFetch("/api/auth/logout", { method: "POST" });
    if (res?.ok) {
      toast("PI011");
      router.push("/");
      router.refresh();
    }
  }

  // listbox keys (item 8): ↑ ↓ Home End move, Enter / Space choose (buttons), Esc closes (above), Tab leaves and closes
  function listKeys(e: React.KeyboardEvent<HTMLDivElement>) {
    const opts = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'));
    const i = opts.indexOf(document.activeElement as HTMLElement);
    const next = ({ ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: opts.length - 1 } as Record<string, number>)[e.key];
    if (next !== undefined) {
      e.preventDefault();
      opts[(next + opts.length) % opts.length].focus();
    } else if (e.key === "Tab") setLangOpen(false);
  }

  const hrefOf = (href: string) => (href === "/clinics" ? clinicsHref : href);
  const isCurrent = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
  const name = userName ? `${userName}${label("nameSuffix", lang)}` : "";

  const items = (variant: "bar" | "drawer") =>
    MENU.map((m) => {
      const locked = m.loginRequired && !loggedIn;
      return (
        <Link
          key={m.href}
          href={hrefOf(m.href)}
          className={isCurrent(m.href) ? "cur" : undefined}
          aria-current={isCurrent(m.href) ? "page" : undefined}
          onClick={() => setDrawer(false)}
        >
          {label(m.key, lang)}
          {locked && <Icon name="lock" size={variant === "drawer" ? 16 : 14} className="lock" />}
          {locked && <span className="sr-only">{label("lockAria", lang)}</span>}
          {variant === "drawer" && !locked && <Icon name="right" size={16} className="r" />}
        </Link>
      );
    });

  return (
    <header className="hd" data-testid="cf01">
      <Logo groupName={groupName} link />
      <nav className="nav" aria-label={label("menuNav", lang)}>{items("bar")}</nav>
      <span className="sp" />

      {/* before 8 in the DOM: Tab 1 → 7 → 8 on mobile (_common §3.1); drawn rightmost by .burger order */}
      <button
        ref={burger}
        type="button"
        className="ib burger"
        aria-label={label("openMenu", lang)}
        aria-expanded={drawer}
        aria-controls="cf01-drawer"
        onClick={() => setDrawer(true)}
      >
        <Icon name="menu" size={24} />
      </button>

      <div className="lang-box" ref={langBox}>
        <button
          ref={langBtn}
          type="button"
          className="lang"
          aria-haspopup="listbox"
          aria-expanded={langOpen}
          aria-label={`${label("langAria", lang)}: ${LANG_NAMES[lang]}`}
          onClick={() => setLangOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setLangOpen(true);
            }
          }}
        >
          <Icon name="globe" />
          <span className="lang-full">{LANG_NAMES[lang]}</span>
          <span className="lang-code">{lang.toUpperCase()}</span>
          <Icon name="down" size={16} className="lang-caret" />
        </button>
        {langOpen && (
          <div className="dd" role="listbox" aria-label={label("langAria", lang)} onKeyDown={listKeys}>
            {LANGS.map((l) => (
              <button key={l} type="button" role="option" tabIndex={-1} aria-selected={l === lang} className={l === lang ? "on2" : undefined} onClick={() => switchLang(l)}>
                {l === lang ? <Icon name="check" /> : <span style={{ width: 18 }} />}
                {LANG_NAMES[l]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="acc">
        {loggedIn ? (
          <>
            <span className="row acc-name"><Icon name="user" />{name}</span>
            <button type="button" className="btn bs btn-sm" onClick={logout}><Icon name="logout" />{label("logout", lang)}</button>
          </>
        ) : (
          <>
            <Link className="btn bs btn-sm" href="/login">{label("login", lang)}</Link>
            <Link className="btn bp btn-sm" href="/register">{label("register", lang)}</Link>
          </>
        )}
      </div>

      {drawer && <div className="scrim-fixed drawer-scrim" onClick={() => setDrawer(false)} />}
      <aside id="cf01-drawer" className={`drawer ${drawer ? "open" : ""}`} aria-label={label("drawerTitle", lang)} hidden={!drawer}>
        <div className="dh">
          <span>{label("drawerTitle", lang)}</span>
          <button
            ref={closeBtn}
            type="button"
            className="ib"
            aria-label={label("closeMenu", lang)}
            aria-expanded={drawer}
            onClick={() => {
              setDrawer(false);
              burger.current?.focus();
            }}
          >
            <Icon name="close" size={22} />
          </button>
        </div>
        <nav aria-label={label("menuNav", lang)}>{items("drawer")}</nav>
        {!loggedIn && (
          <p className="legend-lock"><Icon name="lock" size={14} />{label("lockLegend", lang)}</p>
        )}
        <div className="sec sec-line">
          {loggedIn ? (
            <>
              <div className="row" style={{ fontWeight: 700 }}><Icon name="user" />{name}</div>
              <button type="button" className="btn bs bw" onClick={logout}><Icon name="logout" />{label("logout", lang)}</button>
            </>
          ) : (
            <>
              {/* Tab 9 → 10; 10 drawn above 9 by its order */}
              <Link className="btn bs bw" href="/login">{label("login", lang)}</Link>
              <Link className="btn bp bw drawer-reg" href="/register">{label("register", lang)}</Link>
            </>
          )}
        </div>
        <div className="sec" role="radiogroup" aria-label={label("langHeading", lang)}>
          <div className="lbl"><Icon name="globe" />{label("langHeading", lang)}</div>
          {LANGS.map((l) => (
            <label key={l} className={`lopt ${l === lang ? "on" : ""}`}>
              <input type="radio" name="cf01-lang" value={l} checked={l === lang} onChange={() => switchLang(l)} />
              {LANG_NAMES[l]}
            </label>
          ))}
        </div>
      </aside>
    </header>
  );
}
