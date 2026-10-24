// spec-screen: P12
// 問診入力 `/booking/questionnaire` (login): the 初診 new-booking draft only; expired / missing / not needed → P11 PE036.
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { QuestionnaireForm } from "@/components/booking/QuestionnaireForm";
import { guardScreen } from "@/lib/auth/context";
import { DRAFT_COOKIE } from "@/lib/booking/draft";
import { loadQuestionnaire } from "@/lib/entry/pages";
import { getLanguage } from "@/lib/frame/data";

export default async function QuestionnairePage() {
  const session = await guardScreen("P12");
  const r = await loadQuestionnaire({ session: session!, draftId: (await cookies()).get(DRAFT_COOKIE)?.value, lang: await getLanguage() });
  if (r.kind === "notFound") notFound();
  if (r.kind !== "ok") redirect(r.kind === "redirect" ? r.to : "/login");
  return <QuestionnaireForm {...r.props} />;
}
