// X2-L round trip of P06 event 5: the state cookie and the callback decision (5-2 / 5-3).
import { exchangeCode } from "@/lib/adapters/x2-line-login";
import { APP_CONFIG } from "@/lib/config";
import { linkLine } from "./mypage";

export const LINE_COOKIE = "line_oauth";
export const lineRedirectUri = () => `${APP_CONFIG.baseUrl}/api/mypage/line/callback`;

/**
 * The callback: state must equal the cookie's (else PE052, nothing written); a LINE error / cancel → PE052; then the
 * exchange and 更新6 (a LINE id of another account → PE052). Returns the message for P06.
 */
export async function lineCallback(accountId: string, q: { code: string | null; state: string | null; error: string | null }, cookie: string | undefined) {
  const [state, nonce] = (cookie ?? "").split(".");
  if (!state || !nonce || q.state !== state || q.error || !q.code) return "PE052" as const;
  let user: { userId: string; friend: boolean };
  try {
    user = await exchangeCode(q.code, lineRedirectUri(), nonce);
  } catch {
    return "PE052" as const;
  }
  return linkLine(accountId, user.userId, user.friend);
}
