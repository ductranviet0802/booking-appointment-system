// Contract between the auth module (feat/foundation-auth, owns this file) and the common frame (_common).
// The frame imports only these names. Until the auth branch merges, getSession() answers "no session".
import type { Language, Role } from "@prisma/client";

export type ScreenId =
  | "P01" | "P02" | "P03" | "P04" | "P05" | "P06" | "P07" | "P08" | "P09" | "P10" | "P11" | "P12" | "P13" | "P14" | "P15" | "P16"
  | "S01" | "S02" | "S03" | "A01" | "A02" | "A03" | "A04" | "A05" | "A06";

export type SessionClinic = { id: string; code: string; nameJa: string };

export type SessionContext = {
  sessionId: string;
  account: {
    id: string;
    role: Role;
    language: Language;
    /** staff: accounts.display_name; patient: the SELF patient's name (抽出2), "山田 太郎" */
    displayName: string;
    allClinics: boolean;
    mustChangePassword: boolean;
  };
  /** staff: the CF-03 clinic (sessions.clinic_id); patients: null */
  clinicId: string | null;
  /** staff: the CF-03 choices (_common 抽出4), by clinics.display_order; patients: [] */
  clinics: SessionClinic[];
  /** patients: consent kinds whose current version is not agreed yet (CF-04, F10-02); [] when none */
  reconsent: Array<"TERMS" | "PRIVACY">;
};

/** The valid session of the current request, or null (no cookie, expired, revoked). Server components and route handlers. */
export async function getSession(): Promise<SessionContext | null> {
  return null;
}

/**
 * Access check of 02 §2 for a screen, called at the top of its page. Returns the session (null = anonymous allowed).
 * Otherwise it does not return: redirect (login guard to P02 with the target kept, logged-in redirects, CF-04 re-consent,
 * P05 初回変更), unauthorized() → ER-05 (session expired / revoked) or forbidden() → ER-03 (staff without the screen / clinic).
 */
export async function guardScreen(screen: ScreenId): Promise<SessionContext | null> {
  void screen;
  return getSession();
}
