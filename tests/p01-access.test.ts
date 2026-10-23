// spec-screen: P01 P08 P09 P10 — access (02 §2): anonymous and patients see the screens; staff go to S01 (T070 → /staff/ledger).
import { decideAccess, type SessionState } from "@/lib/auth/access";
import type { SessionContext } from "@/lib/auth/context";

const valid = (role: "PATIENT" | "RECEPTION" | "ADMIN" | "DOCTOR"): SessionState => ({
  state: "valid",
  ctx: { account: { role, mustChangePassword: false }, reconsent: [], clinics: [{ id: "c" }] } as unknown as SessionContext,
});

describe.each([
  ["P01", "/"],
  ["P08", "/doctors"],
  ["P09", "/doctors/3f2b8d3e-0000-4000-8000-000000000000"],
  ["P10", "/clinics"],
] as const)("access to %s", (screen, path) => {
  it("anonymous is allowed", () => expect(decideAccess(screen, { state: "anonymous" }, path)).toEqual({ kind: "allow" }));
  it("a patient is allowed", () => expect(decideAccess(screen, valid("PATIENT"), path)).toEqual({ kind: "allow" }));
  it.each(["RECEPTION", "ADMIN", "DOCTOR"] as const)("%s is redirected to /staff/ledger", (role) =>
    expect(decideAccess(screen, valid(role), path)).toEqual({ kind: "redirect", to: "/staff/ledger" }),
  );
});
