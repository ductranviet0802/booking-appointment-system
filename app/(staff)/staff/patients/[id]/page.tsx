// spec-screen: S03
// 詳細 view (events 2, 3, 15, 16): states ③ admin / ④ reception / ⑤ merged / ⑥ staff-registered; PATIENT_VIEW at every open.
import { headers } from "next/headers";
import { forbidden } from "next/navigation";
import { guardScreen } from "@/lib/auth/context";
import { clientIp } from "@/lib/request-security";
import { loadDetail, viewAudit } from "@/lib/staff/patients";
import { DetailClient } from "./DetailClient";

export default async function PatientDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await guardScreen("S03");
  if (!session?.clinicId) forbidden();
  const { id } = await params;
  const detail = await loadDetail(id, { accountId: session.account.id });
  if (!detail) throw new Error("ER-02: unknown or anonymised patient"); // 2-2 (Q14)
  const ip = clientIp(await headers());
  await viewAudit({ accountId: session.account.id, role: session.account.role, ip, clinicId: session.clinicId }, detail.id);
  const back = (await searchParams).back;
  return <DetailClient detail={detail} admin={session.account.role === "ADMIN"} back={typeof back === "string" ? back : ""} />;
}
