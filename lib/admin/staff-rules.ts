// spec-screen: A05
// Input checks of A05 §4.2 (items 5-10), shared by the form (blur) and the server (events 5 / 6). Pure.
import { emailFormatOk, type FieldError } from "@/lib/auth/validate";

export const STAFF_ROLES = ["RECEPTION", "ADMIN", "DOCTOR"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const ROLE_LABEL: Record<StaffRole, string> = { RECEPTION: "受付", ADMIN: "管理者", DOCTOR: "医師" };

export type AccountState = "disabled" | "locked" | "firstChange" | "active";

export type StaffValues = {
  displayName: string; email: string; role: string; clinicIds: string[]; allClinics: boolean; doctorId: string;
};

const blank = (v: string) => v.replace(/[\s　]/g, "") === "";

/** `needClinics`: 受付 / 管理者 without 9 need at least one clinic (check 8); 医師 needs a doctor (check 9) */
export function validateStaff(v: StaffValues): FieldError[] {
  const e: FieldError[] = [];
  const name = v.displayName.trim();
  if (blank(name)) e.push({ field: "displayName", code: "SE001", params: { 項目: "表示名" } });
  else if (name.length > 50) e.push({ field: "displayName", code: "SE003", params: { 項目: "表示名", n: 50 } });
  const email = v.email.trim();
  if (blank(email)) e.push({ field: "email", code: "SE001", params: { 項目: "メールアドレス" } });
  else if (email.length > 254) e.push({ field: "email", code: "SE003", params: { 項目: "メールアドレス", n: 254 } });
  else if (!emailFormatOk(email)) e.push({ field: "email", code: "SE002", params: { 項目: "メールアドレス" } });
  if (!v.role) e.push({ field: "role", code: "SE001", params: { 項目: "ロール" } });
  if ((v.role === "RECEPTION" || (v.role === "ADMIN" && !v.allClinics)) && v.clinicIds.length === 0) {
    e.push({ field: "clinicIds", code: "SE001", params: { 項目: "担当クリニック" } });
  }
  if (v.role === "DOCTOR" && !v.doctorId) e.push({ field: "doctorId", code: "SE001", params: { 項目: "紐付ける医師" } });
  return e;
}
