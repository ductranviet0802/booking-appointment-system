// spec-screen: S02
import { forbidden, redirect } from "next/navigation";
import { type Actor } from "@/lib/admin/common";
import { guardScreen } from "@/lib/auth/context";
import { loadPreset } from "@/lib/staff/proxy";
import { ProxyClient } from "./ProxyClient";

type Params = { date?: string; bookingId?: string; patientId?: string };

export default async function Booking({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await guardScreen("S02");
  if (!session?.clinicId) forbidden();
  const p = await searchParams;
  const actor: Actor = {
    accountId: session.account.id, role: session.account.role, clinicId: session.clinicId, allClinics: session.account.allClinics,
    sessionId: session.sessionId, ip: null, now: new Date(),
  };
  const preset = await loadPreset(actor, p); // T075 (date / bookingId), T084 (patientId), T088 (none); names Q15
  if (preset === "ER03") forbidden();
  if (preset === "ER02") redirect("/staff/error/error");
  return <ProxyClient preset={preset} />;
}
