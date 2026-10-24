// spec-screen: P02
// /login. A logged-in user is redirected by the guard (T069; flagged staff → P05). Box 1-1 by the arrival, 1-2 PI093.
import { cookies } from "next/headers";
import { LoginForm } from "@/components/patient/LoginForm";
import { guardScreen, guardTarget } from "@/lib/auth/context";
import { FLASH_COOKIE } from "@/lib/auth/session";
import { getLanguage, getSettings } from "@/lib/frame/data";
import { guidanceOf } from "@/lib/patient/login";
import { maintenanceNotice } from "@/lib/public/home";

export default async function LoginPage() {
  await guardScreen("P02");
  const lang = await getLanguage();
  const guidance = guidanceOf((await cookies()).get(FLASH_COOKIE)?.value, await guardTarget());
  return <LoginForm lang={lang} guidance={guidance} maintenance={maintenanceNotice(await getSettings(), lang)} />;
}
