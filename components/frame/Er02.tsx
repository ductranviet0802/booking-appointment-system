"use client";

// spec-screen: ER-02
// Unexpected error: no detail is shown. PE090 for patients and anonymous visitors, SE090 for staff (URL under /staff or /admin).
// The link 「トップへ」 / 「予約台帳へ」 (item 30) comes first in tab order, the reload button (31) is drawn above it.
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { useLang } from "@/components/ui/Toast";
import { LANG_COOKIE, parseLang, t } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";
import { ErrorBlock } from "./ErrorBlock";

export const isStaffPath = (pathname: string | null) => /^\/(staff|admin)(\/|$)/.test(pathname ?? "");

export function Er02View({ lang, staff, inFrame }: { lang: Lang; staff: boolean; inFrame?: boolean }) {
  return (
    <ErrorBlock icon="alert" tone="red" title={label("er02Title", lang)} message={t(staff ? "SE090" : "PE090", lang)} testId="er02" inFrame={inFrame}>
      <div className="acts acts-rev">
        {staff ? (
          <Link className="btn bs" href="/staff/ledger">{label("toLedger", "ja")}</Link>
        ) : (
          <Link className="btn bs" href="/">{label("toTop", lang)}</Link>
        )}
        <button type="button" className="btn bp" onClick={() => window.location.reload()}>
          <Icon name="refresh" />
          {label("reload", lang)}
        </button>
      </div>
    </ErrorBlock>
  );
}

/** For app/error.tsx and the group error boundaries (inFrame: inside a layout that already has <main>) */
export function Er02({ inFrame }: { inFrame?: boolean }) {
  const staff = isStaffPath(usePathname());
  const lang = useLang();
  return <Er02View lang={staff ? "ja" : lang} staff={staff} inFrame={inFrame} />;
}

/** For app/global-error.tsx, which has no providers: the language comes from the cookie once mounted */
export function Er02Root() {
  const [state, setState] = useState<{ lang: Lang; staff: boolean }>({ lang: "ja", staff: false });
  useEffect(() => {
    const m = new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]*)`).exec(document.cookie);
    const staff = isStaffPath(window.location.pathname);
    setState({ lang: staff ? "ja" : (parseLang(m?.[1]) ?? "ja"), staff });
  }, []);
  return <Er02View lang={state.lang} staff={state.staff} />;
}
