// Contract between the auth module (feat/foundation-auth, owns this file) and the common frame (_common).
// The frame imports only these names.
import type { Language, Role } from "@prisma/client";
import { cookies, headers } from "next/headers";
import { forbidden, notFound, redirect, unauthorized } from "next/navigation";
import { cache } from "react";
import { decideAccess, internalPath, type SessionState } from "@/lib/auth/access";
import { readGuard } from "@/lib/auth/guard-store";
import { pendingConsents, staffClinics } from "@/lib/auth/scope";
import { GUARD_COOKIE, readSession, SESSION_COOKIE } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

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

/** request header set by proxy.ts on page requests: path + query of the request (the login-guard target) */
export const PATH_HEADER = "x-pathname";

/** the session state of a cookie value: anonymous, invalid (expired / revoked → ER-05) or valid with its context */
export async function resolveSession(token: string | undefined, now = new Date()): Promise<SessionState> {
  const r = await readSession(token, now);
  if (r.state !== "valid") return r;
  const session = r.session;
  const account = session.account;
  let displayName = account.displayName ?? "";
  if (account.role === "PATIENT") {
    const self = await prisma.patient.findFirst({
      where: { accountId: account.id, relation: "SELF" }, select: { familyName: true, givenName: true },
    });
    displayName = self ? `${self.familyName} ${self.givenName}` : "";
  }
  return {
    state: "valid",
    ctx: {
      sessionId: session.id,
      account: {
        id: account.id, role: account.role, language: account.language, displayName,
        allClinics: account.allClinics, mustChangePassword: account.mustChangePassword,
      },
      clinicId: session.clinicId,
      clinics: await staffClinics(account, now),
      reconsent: await pendingConsents(account, now),
    },
  };
}

const currentState = cache(async (): Promise<SessionState> => resolveSession((await cookies()).get(SESSION_COOKIE)?.value));

/** The valid session of the current request, or null (no cookie, expired, revoked). Server components and route handlers. */
export async function getSession(): Promise<SessionContext | null> {
  const s = await currentState();
  return s.state === "valid" ? s.ctx : null;
}

/** the requested path of a page request (internal only), "/" when unknown */
export async function currentPath() {
  return internalPath((await headers()).get(PATH_HEADER)) ?? "/";
}

/** where a login button sends a user with a return target (P02 via the login-guard record, F9-03; ER-05 button 32) */
export const loginUrlFor = (target: string) => `/api/auth/guard?next=${encodeURIComponent(target)}`;

/** the return target held for this browser (P02 item 1-1: PI010 / PI014 when set), or null */
export async function guardTarget() {
  return readGuard((await cookies()).get(GUARD_COOKIE)?.value)?.target ?? null;
}

/**
 * Access check of 02 §2 for a screen, called at the top of its page. Returns the session (null = anonymous allowed).
 * Otherwise it does not return: redirect (login guard to P02 with the target kept, logged-in redirects, CF-04 re-consent,
 * P05 初回変更), unauthorized() → ER-05 (session expired / revoked) or forbidden() → ER-03 (staff without the screen / clinic).
 * A patient on a staff screen gets notFound() → ER-01 (no disclosure, 01 §3.2).
 */
export async function guardScreen(screen: ScreenId): Promise<SessionContext | null> {
  const s = await currentState();
  const path = await currentPath();
  const d = decideAccess(screen, s, path);
  switch (d.kind) {
    case "allow":
      return s.state === "valid" ? s.ctx : null;
    case "redirect":
      return redirect(d.to);
    case "login":
      return redirect(loginUrlFor(path));
    case "unauthorized":
      return unauthorized();
    case "forbidden":
      return forbidden();
    case "notFound":
      return notFound();
  }
}

/** N-SEC-08: a staff request for a clinic outside the session's clinics → ER-03 (SE091); no session → ER-05 */
export async function requireStaffClinic(clinicId: string): Promise<SessionContext> {
  const s = await getSession();
  if (!s) unauthorized();
  if (s.account.role === "PATIENT" || s.account.mustChangePassword || !s.clinics.some((c) => c.id === clinicId)) forbidden();
  return s;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requirePatientSession() {
  const s = await getSession();
  if (!s) unauthorized();
  if (s.account.role !== "PATIENT") notFound();
  return s;
}

/** F8-01 / 01 §3.2: a patient record outside the account (patients.account_id ≠ session account) → ER-01 */
export async function requireOwnPatient(patientId: string): Promise<SessionContext> {
  const s = await requirePatientSession();
  if (!UUID.test(patientId) || !(await prisma.patient.count({ where: { id: patientId, accountId: s.account.id } }))) notFound();
  return s;
}

/** a booking whose patient is not under the account → ER-01 (no disclosure of other patients' bookings) */
export async function requireOwnBooking(bookingId: string): Promise<SessionContext> {
  const s = await requirePatientSession();
  if (!UUID.test(bookingId) || !(await prisma.booking.count({ where: { id: bookingId, patient: { accountId: s.account.id } } }))) {
    notFound();
  }
  return s;
}
