// spec-screen: P14
// /bookings/{id}/done: own / family booking only (requireOwnBooking: else ER-01, nothing disclosed); every status is
// shown (EV-06 / EV-07), so a reload after a cancel shows state ②.
import { notFound } from "next/navigation";
import { guardScreen, requireOwnBooking } from "@/lib/auth/context";
import { getLanguage } from "@/lib/frame/data";
import { loadDone } from "@/lib/patient/bookings";
import { DoneView } from "./DoneView";

export default async function BookingDonePage({ params }: { params: Promise<{ id: string }> }) {
  await guardScreen("P14");
  const { id } = await params;
  const session = await requireOwnBooking(id);
  const lang = await getLanguage();
  const data = await loadDone(id, session.account.id, lang);
  if (!data) notFound();
  return <DoneView data={data} lang={lang} />;
}
