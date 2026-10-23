// Demo login accounts of the seed (prisma/seed.ts). Shared with tests and the capture / QA notes in dev/STATE.md.
// Every account uses SEED_PASSWORD (F9-07: 8–64 ASCII, a letter and a digit).
import type { AccountStatus, Language, Role } from "@prisma/client";

export const SEED_PASSWORD = "Demo1234";

export type SeedAccount = {
  email: string;
  role: Role;
  status: AccountStatus;
  displayName?: string;
  language?: Language;
  allClinics?: boolean;
  clinics?: string[]; // clinics.code → staff_clinics
  doctorCode?: string; // doctors.code linked to a DOCTOR account
  mustChangePassword?: boolean;
  /** true: a correct login opens a session (ACTIVE, not first-change, has a clinic when staff) */
  loginOpensSession: boolean;
};

export const SEED_ACCOUNTS: SeedAccount[] = [
  // staff
  { email: "admin.all@example.jp", role: "ADMIN", status: "ACTIVE", displayName: "事務長 森田", allClinics: true, loginOpensSession: true },
  { email: "admin.honin@example.jp", role: "ADMIN", status: "ACTIVE", displayName: "管理者 小野", clinics: ["honin"], loginOpensSession: true },
  { email: "reception.honin@example.jp", role: "RECEPTION", status: "ACTIVE", displayName: "受付 小川", clinics: ["honin"], loginOpensSession: true },
  { email: "reception.multi@example.jp", role: "RECEPTION", status: "ACTIVE", displayName: "受付 新井", clinics: ["honin", "ekimae"], loginOpensSession: true },
  { email: "doctor.tanaka@example.jp", role: "DOCTOR", status: "ACTIVE", displayName: "田中 誠", doctorCode: "D001", loginOpensSession: true },
  { email: "doctor.kobayashi@example.jp", role: "DOCTOR", status: "ACTIVE", displayName: "小林 直樹", doctorCode: "D007", loginOpensSession: true },
  // staff edge cases: no clinic → ER-03 (SE091); first login → P05 初回変更; disabled → PE010
  { email: "reception.noclinic@example.jp", role: "RECEPTION", status: "ACTIVE", displayName: "受付 村上", loginOpensSession: false },
  { email: "reception.firstlogin@example.jp", role: "RECEPTION", status: "ACTIVE", displayName: "受付 大西", clinics: ["nishiguchi"], mustChangePassword: true, loginOpensSession: false },
  { email: "reception.disabled@example.jp", role: "RECEPTION", status: "DISABLED", displayName: "受付 退職者", clinics: ["honin"], loginOpensSession: false },
  // patients
  { email: "yamada.taro@example.jp", role: "PATIENT", status: "ACTIVE", language: "JA", loginOpensSession: true },
  { email: "suzuki.ichiro@example.jp", role: "PATIENT", status: "ACTIVE", language: "JA", loginOpensSession: true },
  { email: "nguyen.van.an@example.com", role: "PATIENT", status: "ACTIVE", language: "VI", loginOpensSession: true },
  { email: "emily.smith@example.com", role: "PATIENT", status: "ACTIVE", language: "EN", loginOpensSession: true },
  // patient edge case: mail not verified → PE017
  { email: "sasaki.pending@example.jp", role: "PATIENT", status: "PENDING", language: "JA", loginOpensSession: false },
];
