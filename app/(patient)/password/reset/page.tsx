// spec-screen: P05
// /password/reset?token= (token mode, whatever the session): event 1 checks the token (抽出1) → 基 or ① PE021.
import { NewPasswordForm } from "@/components/patient/NewPasswordForm";
import { guardScreen } from "@/lib/auth/context";
import { checkResetToken } from "@/lib/auth/service";
import { getLanguage } from "@/lib/frame/data";

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  await guardScreen("P05");
  const raw = (await searchParams).token;
  const token = Array.isArray(raw) ? raw[0] : (raw ?? "");
  const r = await checkResetToken(token);
  return (
    <NewPasswordForm
      lang={await getLanguage()} mode="token" token={token} valid={r.ok} email={r.ok ? String(r.body.maskedEmail) : ""}
    />
  );
}
