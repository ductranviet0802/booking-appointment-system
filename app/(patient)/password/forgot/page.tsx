// spec-screen: P04
// /password/forgot. A logged-in user is redirected by the guard (T069).
import { ForgotForm } from "@/components/patient/ForgotForm";
import { guardScreen } from "@/lib/auth/context";
import { getLanguage } from "@/lib/frame/data";

export default async function ForgotPage() {
  await guardScreen("P04");
  return <ForgotForm lang={await getLanguage()} />;
}
