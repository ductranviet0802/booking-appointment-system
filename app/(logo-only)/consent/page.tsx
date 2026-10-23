// spec-screen: CF-04
// /consent: shown right after login while a consent document version is not agreed yet (F10-02, event 6).
// The guard of every patient URL leads here; the page itself needs a patient session with something to agree to.
import { redirect } from "next/navigation";
import { ConsentForm } from "@/components/frame/ConsentForm";
import type { ConsentItem } from "@/components/frame/ConsentForm";
import { getSession } from "@/lib/auth/context";
import { safeNext } from "@/lib/frame/consent";
import { getConsentLinks } from "@/lib/frame/data";
import { getLanguage } from "@/lib/i18n/server";

export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = safeNext((await searchParams).next);
  const session = await getSession();
  if (!session || session.account.role !== "PATIENT") redirect("/login");
  if (session.reconsent.length === 0) redirect(next);

  const lang = await getLanguage();
  const links = await getConsentLinks(lang);
  const items: ConsentItem[] = session.reconsent.map((kind) => {
    const doc = kind === "TERMS" ? links.terms : links.privacy;
    return { kind, version: doc?.version ?? "", url: doc?.url ?? null };
  });
  return <ConsentForm lang={lang} items={items} next={next} />;
}
