// Booking draft (P11 Q1 / Q2, P12 Q1, P13 Q1 = A): a server-side record keyed by the random value of the httpOnly
// DRAFT_COOKIE, not a table. Two kinds share the store: ANON = the anonymous selections of P11 event 10 (restored by
// T010 after login), DRAFT = the booking draft of P11 event 11 (created_at fixed then, alive 30 min, holds no frame).
// A DRAFT belongs to the session that made it: another account's or an old session's cookie reads as missing (PE036),
// so the header ログアウト (session revoked) discards it. Discarded at T053 (kept as "consumed" with the booking id so a
// reload of P13 lands on P14), T057 and logout.
// shortcut: in-process store, single instance only; move to a shared store before running more than one instance
import { randomBytes } from "node:crypto";
import type { Language } from "@prisma/client";

export const DRAFT_COOKIE = "bdraft";
export const DRAFT_TTL_MS = 30 * 60_000;
const MAX_ENTRIES = 10_000; // cap: drafts held in memory, oldest dropped first; anonymous callers can create them (質疑 pending)

export type Selections = {
  patientId: string | null;
  clinicId: string | null;
  departmentId: string | null;
  visitTypeId: string | null;
  /** null = 指名なし */
  doctorId: string | null;
  date: string | null;
  start: string | null;
  notes: string;
};

export type Draft = {
  id: string;
  kind: "ANON" | "DRAFT";
  accountId: string | null;
  sessionId: string | null;
  createdAt: number;
  sel: Selections;
  /** origin screen of the draft (T057) */
  origin: string;
  /** change mode: the booking and its version read when P11 change mode opened */
  change: { bookingId: string; version: number } | null;
  /** P12 answers (as kept by 次へ or 戻る) and the UI language of 次へ (Q10 A) */
  questionnaire: { answers: Record<string, unknown>; language: Language; complete: boolean } | null;
  /** set when P13 committed: the booking made from this draft */
  bookingId: string | null;
};

export type Owner = { accountId: string; sessionId: string } | null;

// on globalThis: route handlers and pages are separate module instances in one process (as the core's bookingOnce)
const g = globalThis as unknown as { bookingDrafts?: Map<string, Draft> };
const store = (g.bookingDrafts ??= new Map<string, Draft>());

export function putDraft(d: Omit<Draft, "id" | "createdAt">, now = Date.now()): Draft {
  if (store.size >= MAX_ENTRIES) {
    for (const [k, v] of store) if (v.createdAt + DRAFT_TTL_MS <= now) store.delete(k);
    while (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value as string);
  }
  const rec: Draft = { ...d, id: randomBytes(24).toString("base64url"), createdAt: now };
  store.set(rec.id, rec);
  return rec;
}

/** the alive record of the cookie for this caller; an ANON record is readable by anyone holding the cookie */
export function getDraft(id: string | undefined, owner: Owner, now = Date.now()): Draft | null {
  const rec = id ? store.get(id) : undefined;
  if (!rec) return null;
  if (rec.createdAt + DRAFT_TTL_MS <= now) {
    store.delete(rec.id);
    return null;
  }
  if (rec.kind === "DRAFT" && (!owner || owner.accountId !== rec.accountId || owner.sessionId !== rec.sessionId)) return null;
  return rec;
}

export function patchDraft(id: string, patch: Partial<Pick<Draft, "sel" | "questionnaire" | "bookingId">>) {
  const rec = store.get(id);
  if (rec) Object.assign(rec, patch);
}

export const dropDraft = (id: string | undefined) => {
  if (id) store.delete(id);
};

export const draftCookieOptions = () => ({
  httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: DRAFT_TTL_MS / 1000,
});

export const EMPTY_SELECTIONS: Selections = {
  patientId: null, clinicId: null, departmentId: null, visitTypeId: null, doctorId: null, date: null, start: null, notes: "",
};
