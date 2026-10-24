// spec-screen: P03
// /register. A request with ?token= never reaches here (proxy.ts → /api/auth/verify, events 6 / 7); an expired / used link
// comes back as ?resend=PE004 (state ②). A logged-in user is redirected by the guard (T069).
import { RegisterForm } from "@/components/patient/RegisterForm";
import { guardScreen } from "@/lib/auth/context";
import { getConsentLinks, getLanguage } from "@/lib/frame/data";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ resend?: string }> }) {
  await guardScreen("P03");
  const lang = await getLanguage();
  // 抽出2: the versions shown here are the ones recorded at 登録する (Q6 = A)
  const { terms, privacy } = await getConsentLinks(lang);
  const doc = (d: typeof terms) => (d ? { version: d.version, url: d.url } : null);
  return <RegisterForm lang={lang} terms={doc(terms)} privacy={doc(privacy)} resend={(await searchParams).resend === "PE004"} />;
}
