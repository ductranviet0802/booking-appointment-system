// P02 item 1-1 (Q2 = A): one box, order PI021 → PI011 → PI014 → PI010. PI021 / PI011 are one-time flags (flash cookie of
// the reset / staff logout answer); PI014 / PI010 follow the kept return target (P11 → PI014, any other target → PI010).
import { screenOfPath } from "@/lib/auth/access";

export function guidanceOf(flash: string | null | undefined, target: string | null) {
  if (flash === "PI021" || flash === "PI011") return flash;
  if (target) return screenOfPath(target) === "P11" ? "PI014" : "PI010";
  return null;
}
