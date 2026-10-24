// P16 §4.2 (F5-02): the cancel reason checks, run on 18 in the browser and again on the server at PW001 はい (event 5).
// Pure: safe for client and server code.
import type { FieldError } from "@/lib/auth/validate";

/** the four reasons a patient may choose, in the order of every layout (item 16); CLINIC is staff only */
export const PATIENT_REASONS = ["RECOVERED", "SCHEDULE", "RESCHEDULE", "OTHER"] as const;
export type PatientReason = (typeof PATIENT_REASONS)[number];
export const REASON_TEXT_MAX = 200;

export const isPatientReason = (v: unknown): v is PatientReason => typeof v === "string" && (PATIENT_REASONS as readonly string[]).includes(v);

/** field errors of items 16 / 17: PE001 no reason; PE001 その他 without text; PE003 text over 200 characters */
export function checkCancelReason(code: string, text: string): FieldError[] {
  if (!code) return [{ field: "reason", code: "PE001" }];
  if (code !== "OTHER") return [];
  if (text.replace(/[\s　]/g, "") === "") return [{ field: "reasonText", code: "PE001" }];
  if ([...text].length > REASON_TEXT_MAX) return [{ field: "reasonText", code: "PE003", params: { n: REASON_TEXT_MAX } }];
  return [];
}
