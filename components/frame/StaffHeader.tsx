"use client";

// spec-screen: CF-03
// Staff header (items 17-20, Japanese only, desktop 1366 px; tablet variant below 1280 px with the menu behind ≡).
// Logo part (group name + badge スタッフ, no link: Q2), clinic switcher (or label with a pin for one choice), user and role, logout,
// and the role menu (ADMIN all, RECEPTION with 閲覧 badges, DOCTOR with (自分) labels).
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { STAFF } from "@/lib/i18n/labels";
import { postJson, useApiFetch } from "@/lib/client/api";
import { staffMenu } from "@/lib/frame/menu";
import type { Role } from "@prisma/client";

export type StaffHeaderProps = {
  groupName: string;
  role: Role;
  displayName: string;
  /** 抽出4 choices */
  clinics: Array<{ id: string; nameJa: string }>;
  /** sessions.clinic_id */
  clinicId: string | null;
};

export function StaffHeader({ groupName, role, displayName, clinics, clinicId }: StaffHeaderProps) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const apiFetch = useApiFetch();
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = staffMenu(role);
  const current = menu.find((e) => pathname === e.href || pathname.startsWith(`${e.href}/`));

  async function changeClinic(id: string) {
    const res = await apiFetch(...postJson("/api/session/clinic", { clinicId: id }));
    // 403 SE091: nothing was stored; the reload lets the screen guard show ER-03 (event 9, 9-2)
    if (res) router.refresh();
  }

  async function logout() {
    const res = await apiFetch("/api/auth/logout", { method: "POST" });
    if (res?.ok) {
      toast("PI011");
      router.push("/login"); // T089 → P02
      router.refresh();
    }
  }

  const clinicPart =
    clinics.length > 1 ? (
      <div className="row">
        <label className="sm clab-l" htmlFor="cf03-clinic">{STAFF.clinic}</label>
        <select id="cf03-clinic" className="csel" value={clinicId ?? ""} onChange={(e) => changeClinic(e.target.value)}>
          {clinics.map((c) => (
            <option key={c.id} value={c.id}>{c.nameJa}</option>
          ))}
        </select>
      </div>
    ) : clinics.length === 1 ? (
      <div className="clab"><Icon name="pin" size={16} />{clinics[0].nameJa}</div>
    ) : null;

  return (
    <header className="sh" data-testid="cf03">
      <div className="sh1">
        <button type="button" className="olb tab-only" aria-label={STAFF.menuOpen} aria-expanded={menuOpen} aria-controls="cf03-menu" onClick={() => setMenuOpen((o) => !o)}>
          <Icon name="menu" size={22} />
        </button>
        <div className="slogo desk-only">
          <span className="lm"><Icon name="plus" /></span>
          {groupName}
          <small>{STAFF.badge}</small>
        </div>
        <div className="slogo tab-only">{current?.label ?? ""}</div>
        {clinicPart}
        <div className="usr">
          <span>
            <span className="role">{STAFF.roles[role]}</span> {displayName}
          </span>
          <button type="button" className="olb" onClick={logout}><Icon name="logout" size={16} />{STAFF.logout}</button>
        </div>
      </div>
      <nav id="cf03-menu" className={`sh2 ${menuOpen ? "open" : ""}`} aria-label={STAFF.menuNav}>
        {menu.map((e, i) => {
          const isCur = current?.screen === e.screen;
          return (
            <span key={e.screen} className="sh2-item">
              {i > 0 && menu[i - 1].section !== e.section && <span className="grp" role="separator" />}
              <Link href={e.href} className={isCur ? "cur" : undefined} aria-current={isCur ? "page" : undefined} onClick={() => setMenuOpen(false)}>
                {e.label}
                {e.readOnly && <span className="ro">{STAFF.readOnly}</span>}
              </Link>
            </span>
          );
        })}
      </nav>
    </header>
  );
}
