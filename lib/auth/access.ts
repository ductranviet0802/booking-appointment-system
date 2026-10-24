// 02 §1 (URLs) and §2 (role access per screen) as data and one pure decision, used by guardScreen and by the
// return-target check of a login (T010: "staff go to a target their role may open, else S01").
import type { Role } from "@prisma/client";
import type { ScreenId, SessionContext } from "@/lib/auth/context";

export const PATIENT_HOME = "/mypage";
export const STAFF_HOME = "/staff/ledger";
export const CONSENT_PATH = "/consent";
export const FIRST_CHANGE_PATH = "/password/change";

const SCREEN_PATHS: Array<[RegExp, ScreenId]> = [
  [/^\/$/, "P01"],
  [/^\/login$/, "P02"],
  [/^\/register$/, "P03"],
  [/^\/password\/forgot$/, "P04"],
  [/^\/password\/(reset|change)$/, "P05"],
  [/^\/mypage$/, "P06"],
  [/^\/mypage\/family$/, "P07"],
  [/^\/doctors$/, "P08"],
  [/^\/doctors\/[^/]+$/, "P09"],
  [/^\/clinics(\/[^/]+)?$/, "P10"],
  [/^\/booking\/new$/, "P11"],
  [/^\/bookings\/[^/]+\/change$/, "P11"],
  [/^\/booking\/questionnaire$/, "P12"],
  [/^\/booking\/confirm$/, "P13"],
  [/^\/bookings\/[^/]+\/done$/, "P14"],
  [/^\/bookings$/, "P15"],
  [/^\/bookings\/[^/]+$/, "P16"],
  [/^\/staff\/ledger$/, "S01"],
  [/^\/staff\/booking$/, "S02"],
  [/^\/staff\/patients(\/[^/]+)?$/, "S03"],
  [/^\/admin\/calendar$/, "A01"],
  [/^\/admin\/shifts$/, "A02"],
  [/^\/admin\/masters$/, "A03"],
  [/^\/admin\/policy$/, "A04"],
  [/^\/admin\/staff$/, "A05"],
  [/^\/admin\/export$/, "A06"],
];

export function screenOfPath(path: string): ScreenId | null {
  const pathname = path.split(/[?#]/)[0];
  return SCREEN_PATHS.find(([re]) => re.test(pathname))?.[1] ?? null;
}

/** F9-03 "internal paths only": a same-origin absolute path, normalised; anything else → null (no open redirect) */
export function internalPath(candidate: unknown): string | null {
  if (typeof candidate !== "string" || !candidate.startsWith("/") || candidate.startsWith("//")) return null;
  if (/[\\\u0000-\u001f]/.test(candidate)) return null;
  try {
    const url = new URL(candidate, "http://internal.invalid");
    // the normalised path may start with "//" again ("/a/../..//evil") → protocol-relative, refused
    return url.origin === "http://internal.invalid" && !url.pathname.startsWith("//") ? url.pathname + url.search : null;
  } catch {
    return null;
  }
}

/** P screens that need a patient session ("—" for anonymous in 02 §2) */
const PATIENT_LOGIN_SCREENS = new Set<ScreenId>(["P06", "P07", "P12", "P13", "P14", "P15", "P16"]);

const AUTH_SCREENS = new Set<ScreenId>(["P02", "P03", "P04", "P05"]);

/** staff screens by role; A03 for reception per Q-006 (read-only comes with A03) */
const STAFF_ACCESS: Partial<Record<ScreenId, Role[]>> = {
  S01: ["RECEPTION", "ADMIN", "DOCTOR"],
  S02: ["RECEPTION", "ADMIN"],
  S03: ["RECEPTION", "ADMIN"],
  A01: ["RECEPTION", "ADMIN"],
  A02: ["RECEPTION", "ADMIN", "DOCTOR"],
  A03: ["RECEPTION", "ADMIN"],
  A04: ["ADMIN"],
  A05: ["ADMIN"],
  A06: ["RECEPTION", "ADMIN"],
};

export const isStaffScreen = (screen: ScreenId) => screen[0] === "S" || screen[0] === "A";

export type SessionState =
  | { state: "anonymous" }
  | { state: "invalid" }
  | { state: "valid"; ctx: SessionContext };

export type Decision =
  | { kind: "allow" }
  | { kind: "redirect"; to: string }
  | { kind: "login" }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "notFound" };

/** 02 §2 for one screen and one request. `path` = the requested path (P05 has two modes by URL). */
export function decideAccess(screen: ScreenId, s: SessionState, path: string): Decision {
  const firstChangeMode = screen === "P05" && path.split(/[?#]/)[0] === FIRST_CHANGE_PATH;
  const needsLogin = PATIENT_LOGIN_SCREENS.has(screen) || isStaffScreen(screen) || firstChangeMode;

  if (s.state === "anonymous") return needsLogin ? { kind: "login" } : { kind: "allow" };
  if (s.state === "invalid") {
    // T068 / _common event 12: "any screen" → ER-05; P02–P05 stay open as the ways out of ER-05 (質疑 drafted)
    return AUTH_SCREENS.has(screen) && !firstChangeMode ? { kind: "allow" } : { kind: "unauthorized" };
  }
  // a token link always runs token mode, whatever the session (02 §2 P05 note)
  if (screen === "P05" && !firstChangeMode) return { kind: "allow" };

  const { account, reconsent, clinics } = s.ctx;
  if (account.role === "PATIENT") {
    if (firstChangeMode) return { kind: "redirect", to: PATIENT_HOME };
    if (reconsent.length > 0) return { kind: "redirect", to: CONSENT_PATH };
    // Q-011 answer: a logged-in patient on a staff URL gets ER-03, not a redirect to P06
    if (isStaffScreen(screen)) return { kind: "forbidden" };
    if (screen === "P02" || screen === "P03" || screen === "P04") return { kind: "redirect", to: PATIENT_HOME };
    return { kind: "allow" };
  }

  if (account.mustChangePassword) return firstChangeMode ? { kind: "allow" } : { kind: "redirect", to: FIRST_CHANGE_PATH };
  if (firstChangeMode) return { kind: "redirect", to: STAFF_HOME };
  if (!isStaffScreen(screen)) {
    return { kind: "redirect", to: screen === "P11" && account.role !== "DOCTOR" ? "/staff/booking" : STAFF_HOME };
  }
  if (clinics.length === 0) return { kind: "forbidden" };
  return STAFF_ACCESS[screen]?.includes(account.role) ? { kind: "allow" } : { kind: "forbidden" };
}
