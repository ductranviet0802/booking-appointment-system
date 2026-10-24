// spec-screen: P15
// /bookings: every booking of the session account's patients (own + family), default tab 予約中 (event 1).
import { guardScreen } from "@/lib/auth/context";
import { getLanguage } from "@/lib/frame/data";
import { listBookings } from "@/lib/patient/bookings";
import { ListView } from "./ListView";

export default async function BookingsPage() {
  const session = await guardScreen("P15");
  const lang = await getLanguage();
  return <ListView lang={lang} initial={await listBookings(session!.account.id, "upcoming", 0, lang)} />;
}
