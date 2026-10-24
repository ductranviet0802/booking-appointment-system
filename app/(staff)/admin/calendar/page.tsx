// spec-screen: A01
import { forbidden } from "next/navigation";
import { loadClinic, loadState } from "@/lib/admin/calendar";
import { guardScreen } from "@/lib/auth/context";
import { todayJst } from "@/lib/datetime";
import { CalendarClient } from "./CalendarClient";

export default async function CalendarPage() {
  const session = await guardScreen("A01");
  if (!session?.clinicId) forbidden();
  const [state, clinic] = await Promise.all([loadState(session.clinicId, todayJst().slice(0, 7)), loadClinic(session.clinicId)]);
  if (!clinic) forbidden();
  return <CalendarClient role={session.account.role === "ADMIN" ? "ADMIN" : "RECEPTION"} initial={state} clinic={clinic} />;
}
