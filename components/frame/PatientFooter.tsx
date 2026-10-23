// spec-screen: CF-02
// Patient footer (items 13-16): group name, 利用規約 / プライバシーポリシー (new tab), クリニック案内, copyright line. No vendor credit.
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import type { Lang } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";
import { getClinicsHref, getConsentLinks, getGroupName } from "@/lib/frame/data";

export function FooterView({
  lang,
  groupName,
  termsUrl,
  privacyUrl,
  clinicsHref,
  year,
}: {
  lang: Lang;
  groupName: string;
  termsUrl: string | null;
  privacyUrl: string | null;
  clinicsHref: string;
  year: number;
}) {
  const external = (url: string | null, text: string) =>
    url ? (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {text}
        <Icon name="ext" size={14} />
        <span className="sr-only">{label("newTab", lang)}</span>
      </a>
    ) : (
      <span>{text}</span>
    );
  return (
    <footer className="ft" data-testid="cf02">
      <div className="col g4">
        <div className="gn">{groupName}</div>
        <div className="copy">{label("copyright", lang, { year, group: groupName })}</div>
      </div>
      <nav aria-label={label("footerNav", lang)}>
        {external(termsUrl, label("terms", lang))}
        {external(privacyUrl, label("privacy", lang))}
        <Link href={clinicsHref}>{label("navClinics", lang)}</Link>
      </nav>
    </footer>
  );
}

export async function PatientFooter({ lang }: { lang: Lang }) {
  const [groupName, links, clinicsHref] = await Promise.all([getGroupName(lang), getConsentLinks(lang), getClinicsHref()]);
  return (
    <FooterView
      lang={lang}
      groupName={groupName}
      termsUrl={links.terms?.url ?? null}
      privacyUrl={links.privacy?.url ?? null}
      clinicsHref={clinicsHref}
      year={new Date().getFullYear()}
    />
  );
}
