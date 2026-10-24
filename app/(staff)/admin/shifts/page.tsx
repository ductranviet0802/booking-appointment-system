// spec-screen: A02
import { forbidden } from "next/navigation";
import { listDoctors, loadDetail, loadWeek, mondayOf } from "@/lib/admin/shifts";
import { guardScreen } from "@/lib/auth/context";
import { adjustRequiredCount } from "@/lib/batch/b2-frames";
import { todayJst } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { ShiftsClient } from "./ShiftsClient";

export default async function ShiftsPage() {
  const session = await guardScreen("A02");
  if (!session?.clinicId) forbidden();
  const role = session.account.role === "ADMIN" || session.account.role === "RECEPTION" ? session.account.role : "DOCTOR";
  const doctors = await listDoctors(session.clinicId, role, session.account.id);
  if (role === "DOCTOR" && doctors.length === 0) forbidden(); // a doctor account with no doctors row (Q5)
  const today = todayJst();
  const ctx = { clinicId: session.clinicId, now: new Date() };
  const [detail, week, adjustCount] = await Promise.all([
    doctors[0] ? loadDetail(ctx, doctors[0]) : null,
    loadWeek(ctx, doctors, mondayOf(today)),
    role === "DOCTOR" ? 0 : adjustRequiredCount(prisma, session.clinicId),
  ]);
  return <ShiftsClient role={role} today={today} doctors={doctors} detail={detail} week={week} adjustCount={adjustCount} />;
}
