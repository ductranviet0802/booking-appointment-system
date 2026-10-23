// CF-03 role menu (items 18-1…18-9, 02 §2, _common §3.2 states ④ ⑤ ⑥). Entries a role lacks are hidden, not greyed.
import type { Role } from "@prisma/client";
import type { ScreenId } from "@/lib/auth/context";

export type StaffEntry = { screen: ScreenId; href: string; label: string; readOnly: boolean; section: "S" | "A" };

const ENTRIES: Array<Omit<StaffEntry, "readOnly"> & { roles: Partial<Record<Role, "E" | "R">>; doctorLabel?: string }> = [
  { screen: "S01", href: "/staff/ledger", label: "予約台帳", section: "S", roles: { ADMIN: "E", RECEPTION: "E", DOCTOR: "E" }, doctorLabel: "予約台帳（自分）" },
  { screen: "S02", href: "/staff/booking", label: "代理予約", section: "S", roles: { ADMIN: "E", RECEPTION: "E" } },
  { screen: "S03", href: "/staff/patients", label: "患者検索", section: "S", roles: { ADMIN: "E", RECEPTION: "E" } },
  { screen: "A01", href: "/admin/calendar", label: "診療カレンダー", section: "A", roles: { ADMIN: "E", RECEPTION: "R" } },
  { screen: "A02", href: "/admin/shifts", label: "医師シフト", section: "A", roles: { ADMIN: "E", RECEPTION: "R", DOCTOR: "R" }, doctorLabel: "医師シフト（自分）" },
  // Reception sees A03 with the badge 閲覧 (state ⑤, 質疑 Q-006)
  { screen: "A03", href: "/admin/masters", label: "マスタ", section: "A", roles: { ADMIN: "E", RECEPTION: "R" } },
  { screen: "A04", href: "/admin/policy", label: "通知・ポリシー", section: "A", roles: { ADMIN: "E" } },
  { screen: "A05", href: "/admin/staff", label: "スタッフ", section: "A", roles: { ADMIN: "E" } },
  { screen: "A06", href: "/admin/export", label: "CSV出力", section: "A", roles: { ADMIN: "E", RECEPTION: "E" } },
];

export function staffMenu(role: Role): StaffEntry[] {
  return ENTRIES.flatMap(({ roles, doctorLabel, ...e }) => {
    const access = roles[role];
    if (!access) return [];
    // the 閲覧 badge marks reception only; a doctor's (自分) labels already say so
    return [{ ...e, label: role === "DOCTOR" && doctorLabel ? doctorLabel : e.label, readOnly: access === "R" && role === "RECEPTION" }];
  });
}
