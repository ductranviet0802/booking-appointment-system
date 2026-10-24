// spec-screen: P13
// 予約確認 `/booking/confirm` (login): the alive draft (expired / missing → P11 PE036; already committed → P14).
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ConfirmView } from "@/components/booking/ConfirmView";
import { guardScreen } from "@/lib/auth/context";
import { DRAFT_COOKIE } from "@/lib/booking/draft";
import { loadConfirm } from "@/lib/entry/pages";
import { getLanguage } from "@/lib/frame/data";

export default async function ConfirmPage() {
  const session = await guardScreen("P13");
  const r = await loadConfirm({ session: session!, draftId: (await cookies()).get(DRAFT_COOKIE)?.value, lang: await getLanguage() });
  if (r.kind === "notFound") notFound();
  if (r.kind !== "ok") redirect(r.kind === "redirect" ? r.to : "/login");
  return <ConfirmView {...r.props} />;
}
