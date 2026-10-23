// spec-screen: P10
// Clinic page (state 基) of `/clinics/{clinicCode}`; unknown / inactive / malformed code → ER-01 (event 1-4, PE091).
import { notFound } from "next/navigation";
import { ClinicDetail } from "@/components/public/ClinicDetail";
import { guardScreen } from "@/lib/auth/context";
import { getLanguage } from "@/lib/frame/data";
import { loadClinicPage } from "@/lib/public/p10";

export default async function ClinicPage({ params }: { params: Promise<{ clinicCode: string }> }) {
  await guardScreen("P10");
  const { clinicCode } = await params;
  const lang = await getLanguage();
  const data = await loadClinicPage(clinicCode, lang);
  if (!data) notFound();
  return <ClinicDetail data={data} lang={lang} />;
}
