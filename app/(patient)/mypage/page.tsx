// spec-screen: P06
// /mypage: always the account holder (SELF patient of the session, reading 3). Anonymous → login guard, staff → S01.
// Toasts after T009 / T017 / event 14 come with the client (PI012) or the flash cookie (PI002, PI061, PE004 …).
import { cookies } from "next/headers";
import { MypageForm } from "@/components/patient/MypageForm";
import { guardScreen } from "@/lib/auth/context";
import { FLASH_COOKIE } from "@/lib/auth/session";
import { getLanguage } from "@/lib/frame/data";
import { loadMypage } from "@/lib/patient/mypage";

export default async function MypagePage() {
  const session = await guardScreen("P06");
  const lang = await getLanguage();
  const flash = (await cookies()).get(FLASH_COOKIE)?.value;
  const data = await loadMypage(session!.account.id, lang);
  return <MypageForm lang={lang} data={{ ...data, inline: flash === "PE005" || flash === "PE052" ? flash : null }} />;
}
