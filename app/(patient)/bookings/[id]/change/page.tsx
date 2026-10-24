// spec-screen: P11
// 予約入力 change mode `/bookings/{id}/change` (T062): the account's own / family booking only (ER-01 otherwise), RESERVED
// and inside the deadline unless 要調整 (else P16, Q8 A). ?resume=1 / ?e= as /booking/new.
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { BookingEntry } from "@/components/booking/BookingEntry";
import { currentPath, guardScreen, loginUrlFor, requireOwnBooking } from "@/lib/auth/context";
import { DRAFT_COOKIE } from "@/lib/booking/draft";
import { loadEntry } from "@/lib/entry/pages";
import { getLanguage } from "@/lib/frame/data";

export default async function BookingChangePage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await guardScreen("P11");
  if (!session) redirect(loginUrlFor(await currentPath()));
  const { id } = await params;
  await requireOwnBooking(id);
  const r = await loadEntry({
    session, draftId: (await cookies()).get(DRAFT_COOKIE)?.value, query: await searchParams, changeId: id, lang: await getLanguage(),
  });
  if (r.kind === "notFound") notFound();
  if (r.kind === "login") redirect(loginUrlFor(await currentPath()));
  if (r.kind === "redirect") redirect(r.to);
  return <BookingEntry {...r.props} />;
}
