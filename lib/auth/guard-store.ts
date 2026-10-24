// Login guard (F9-03, P02 §11 Q1 = A): a short-lived anonymous server-side record holding the return target (and,
// later, the booking selections of P11), keyed by the random value of the GUARD_COOKIE.
// shortcut: in-process store, single instance only; move to a shared store before running more than one instance
import { randomBytes } from "node:crypto";

export const GUARD_TTL_MS = 30 * 60_000;
const MAX_ENTRIES = 10_000; // anonymous callers can create records: cap memory

export type GuardRecord = { target: string | null; selections?: Record<string, unknown>; expiresAt: number };

// on globalThis: pages and route handlers are separate module instances in one process (W34: found by P11's draft store)
const g = globalThis as unknown as { guardStore?: Map<string, GuardRecord> };
const store = (g.guardStore ??= new Map<string, GuardRecord>());

export function createGuard(target: string | null, now = Date.now()) {
  if (store.size >= MAX_ENTRIES) {
    for (const [k, v] of store) if (v.expiresAt <= now) store.delete(k);
    while (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value as string);
  }
  const id = randomBytes(24).toString("base64url");
  store.set(id, { target, expiresAt: now + GUARD_TTL_MS });
  return id;
}

export function readGuard(id: string | undefined, now = Date.now()): GuardRecord | null {
  const rec = id ? store.get(id) : undefined;
  if (!rec) return null;
  if (rec.expiresAt <= now) {
    store.delete(id!);
    return null;
  }
  return rec;
}

/** the record is used once by a successful login / verification */
export function takeGuard(id: string | undefined, now = Date.now()) {
  const rec = readGuard(id, now);
  if (rec) store.delete(id!);
  return rec;
}

export const guardCookieOptions = () => ({
  httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/",
  maxAge: GUARD_TTL_MS / 1000,
});
