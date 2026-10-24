// spec-screen: P05
// /password/change (初回変更 mode, state ②): a staff session with must_change_password only (the guard redirects
// anyone else: patient → P06, other staff → S01, anonymous → login guard). Logo-only CF-01 (Q12); staff UI is ja.
import { NewPasswordForm } from "@/components/patient/NewPasswordForm";
import { guardScreen } from "@/lib/auth/context";
import { prisma } from "@/lib/prisma";

export default async function FirstChangePage() {
  const session = await guardScreen("P05");
  const { email } = await prisma.account.findUniqueOrThrow({ where: { id: session!.account.id }, select: { email: true } });
  return <NewPasswordForm lang="ja" mode="first" email={email} valid />;
}
