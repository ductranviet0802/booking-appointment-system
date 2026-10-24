// spec-screen: P07
// /mypage/family: the members of the session's account (reading 3). Anonymous → login guard, staff → S01 (decideAccess).
import { FamilyManager } from "@/components/patient/FamilyManager";
import { guardScreen } from "@/lib/auth/context";
import { getLanguage } from "@/lib/frame/data";
import { loadFamily } from "@/lib/patient/family";

export default async function FamilyPage() {
  const session = await guardScreen("P07");
  const lang = await getLanguage();
  return <FamilyManager lang={lang} data={await loadFamily(session!.account.id, lang)} />;
}
