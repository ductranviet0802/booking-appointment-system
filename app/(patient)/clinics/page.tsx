// spec-screen: P10
// Clinic-list state ① (`/clinics`); one active clinic → that clinic's page (1-3); none → ER-01 (Q9 b).
import { notFound, redirect } from "next/navigation";
import { ClinicList } from "@/components/public/ClinicList";
import { guardScreen } from "@/lib/auth/context";
import { getLanguage } from "@/lib/frame/data";
import { loadClinicIndex } from "@/lib/public/p10";

export default async function ClinicsPage() {
  await guardScreen("P10");
  const lang = await getLanguage();
  const index = await loadClinicIndex(lang);
  if (index.kind === "none") notFound();
  if (index.kind === "redirect") redirect(`/clinics/${index.code}`);
  return <ClinicList cards={index.cards} lang={lang} />;
}
