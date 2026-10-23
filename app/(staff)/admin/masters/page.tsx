// spec-screen: A03
import { forbidden } from "next/navigation";
import { loadDetail, loadLists, type DoctorDetail } from "@/lib/admin/masters";
import { guardScreen } from "@/lib/auth/context";
import { MastersClient } from "./MastersClient";

export default async function MastersPage() {
  const session = await guardScreen("A03");
  if (!session?.clinicId) forbidden();
  const lists = await loadLists(session.clinicId);
  const first = lists.doctors.find((d) => d.isActive);
  const initial = first ? ((await loadDetail("doctor", first.id, session.clinicId)) as DoctorDetail | null) : null;
  return <MastersClient role={session.account.role === "ADMIN" ? "ADMIN" : "RECEPTION"} lists={lists} initial={initial} />;
}
