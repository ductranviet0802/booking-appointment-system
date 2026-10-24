// spec-screen: P06
// P06 event 12 パスワードを変更する: { currentPassword, newPassword, newPasswordConfirm }; the other sessions are revoked.
import type { NextRequest } from "next/server";
import { changePassword } from "@/lib/patient/mypage";
import { patientRoute } from "@/lib/patient/route";

export function POST(req: NextRequest) {
  return patientRoute(req, changePassword);
}
