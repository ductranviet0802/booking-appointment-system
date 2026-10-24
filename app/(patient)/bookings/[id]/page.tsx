// spec-screen: P16
// /bookings/{id}: own / family booking only (requireOwnBooking: else ER-01, nothing disclosed); the state is computed on
// the server from status, start, 要調整 and the clinic's deadline (event 1).
import { notFound } from "next/navigation";
import { guardScreen, requireOwnBooking } from "@/lib/auth/context";
import { getLanguage } from "@/lib/frame/data";
import { loadDetail } from "@/lib/patient/bookings";
import { DetailView } from "./DetailView";

export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await guardScreen("P16");
  const { id } = await params;
  const session = await requireOwnBooking(id);
  const lang = await getLanguage();
  const data = await loadDetail(id, session.account.id, lang);
  if (!data) notFound();
  return <DetailView data={data} lang={lang} />;
}
