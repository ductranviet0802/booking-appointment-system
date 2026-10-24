// spec-screen: S01
// Pure rules of the 予約台帳: display state (item 18, Q4 a: 候補 before 要調整), 予約番号 normalisation (F7-02), the states of item 4.
export type DisplayState = "RESERVED" | "CHECKED_IN" | "NO_SHOW" | "CANCELED" | "ADJUST" | "CANDIDATE";
export const STATES: DisplayState[] = ["RESERVED", "CHECKED_IN", "NO_SHOW", "CANCELED", "ADJUST", "CANDIDATE"];
/** item 4 initial: all but キャンセル済 */
export const DEFAULT_STATES: DisplayState[] = ["RESERVED", "CHECKED_IN", "NO_SHOW", "ADJUST", "CANDIDATE"];
export type Filter = "adjust" | "candidate" | "candidate7";
export const FILTERS: Filter[] = ["adjust", "candidate", "candidate7"];
export const DAY_MS = 86_400_000;

export function displayState(b: { status: string; noShowCandidateAt: Date | null; adjustRequiredAt: Date | null }): DisplayState {
  if (b.status === "CANCELED") return "CANCELED";
  if (b.status === "NO_SHOW") return "NO_SHOW";
  if (b.status === "CHECKED_IN") return "CHECKED_IN";
  if (b.noShowCandidateAt) return "CANDIDATE";
  return b.adjustRequiredAt ? "ADJUST" : "RESERVED";
}

/** F7-02: trim, full-width → half-width, upper case, hyphen / spaces removed; "" = empty */
export function normalizeBookingNo(raw: string) {
  return raw
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s　\-‐－ー−]/g, "")
    .toUpperCase();
}
export const BOOKING_NO = /^[A-HJ-NP-Z]{4}[0-9]{4}$/;
export const showNo = (no: string) => `${no.slice(0, 4)}-${no.slice(4)}`;
