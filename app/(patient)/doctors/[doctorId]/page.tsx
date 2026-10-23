// spec-screen: P09
// 医師詳細 `/doctors/{doctorId}` (doctors.id): malformed, unknown or inactive → ER-01.
import { notFound } from "next/navigation";
import { DoctorDetail } from "@/components/public/DoctorDetail";
import { guardScreen } from "@/lib/auth/context";
import { getLanguage } from "@/lib/frame/data";
import { backHref, loadDoctorPage } from "@/lib/public/doctor";

export default async function DoctorPage({
  params, searchParams,
}: { params: Promise<{ doctorId: string }>; searchParams: Promise<{ from?: string | string[] }> }) {
  await guardScreen("P09");
  const { doctorId } = await params;
  const lang = await getLanguage();
  const data = await loadDoctorPage(doctorId, lang);
  if (!data) notFound();
  return <DoctorDetail data={data} backHref={backHref((await searchParams).from)} lang={lang} />;
}
