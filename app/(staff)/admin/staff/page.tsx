// spec-screen: A05
import { forbidden } from "next/navigation";
import { type Actor } from "@/lib/admin/common";
import { loadStaff, loadStaffDetail, type StaffDetail } from "@/lib/admin/staff";
import { guardScreen } from "@/lib/auth/context";
import { StaffClient } from "./StaffClient";

export default async function StaffPage() {
  const session = await guardScreen("A05");
  if (!session?.clinicId) forbidden();
  const actor: Actor = {
    accountId: session.account.id, role: session.account.role, clinicId: session.clinicId, allClinics: session.account.allClinics,
    sessionId: session.sessionId, ip: null, now: new Date(),
  };
  const lists = await loadStaff(actor);
  const first = lists.rows[0];
  const detail = first ? await loadStaffDetail(actor, first.id) : null;
  return <StaffClient lists={lists} initial={detail?.ok ? (detail.body.detail as StaffDetail) : null} />;
}
