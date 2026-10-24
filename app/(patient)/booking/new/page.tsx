// spec-screen: P11
// 予約入力 `/booking/new` (guest allowed, OD-3). Presets: ?patient= (T036), ?clinic= (T043), ?clinic=&department=&doctor=
// (T040), ?from=bookings (T061); ?resume=1 restores the draft (T010 / T052), ?e= the return message (T054–T056).
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { BookingEntry } from "@/components/booking/BookingEntry";
import { currentPath, guardScreen, loginUrlFor } from "@/lib/auth/context";
import { DRAFT_COOKIE } from "@/lib/booking/draft";
import { loadEntry } from "@/lib/entry/pages";
import { getLanguage } from "@/lib/frame/data";

export default async function BookingNewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await guardScreen("P11");
  const r = await loadEntry({
    session, draftId: (await cookies()).get(DRAFT_COOKIE)?.value, query: await searchParams, lang: await getLanguage(),
  });
  if (r.kind === "notFound") notFound();
  if (r.kind === "login") redirect(loginUrlFor(await currentPath()));
  if (r.kind === "redirect") redirect(r.to);
  return <BookingEntry {...r.props} />;
}
