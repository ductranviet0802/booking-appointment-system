// X2-L LINE Login (05 X2-L, P06 event 5, reading 5): OAuth 2.0 / OpenID Connect with the add-friend option.
// LINE_LOGIN = fake (default, no channel before go-live) | line (LINE_CHANNEL_ID, LINE_CHANNEL_SECRET).
// fake: the authorize URL is our own callback with code=fake-<random> and the friendship flag; the exchange returns a
// deterministic user id for the code.
import { newSecret, sha256 } from "@/lib/auth/session";

export const lineMode = () => (process.env.LINE_LOGIN === "line" ? "line" : "fake");
export const randomToken = () => newSecret().value;

export function authorizeUrl(o: { state: string; nonce: string; redirectUri: string }) {
  if (lineMode() === "fake") {
    const q = new URLSearchParams({ code: `fake-${randomToken()}`, state: o.state, friendship_status_changed: "true" });
    return `${o.redirectUri}?${q}`;
  }
  const q = new URLSearchParams({
    response_type: "code", client_id: process.env.LINE_CHANNEL_ID ?? "", redirect_uri: o.redirectUri, state: o.state,
    scope: "profile openid", nonce: o.nonce, bot_prompt: "aggressive", // add-friend option (X2-L)
  });
  return `https://access.line.me/oauth2/v2.1/authorize?${q}`;
}

/** the LINE user id and whether the user is a friend of the official account; throws on any error (→ PE052) */
export async function exchangeCode(code: string, redirectUri: string, nonce: string): Promise<{ userId: string; friend: boolean }> {
  if (lineMode() === "fake") {
    if (!code.startsWith("fake-")) throw new Error("not a fake code");
    return { userId: `U${sha256(code).slice(0, 32)}`, friend: true };
  }
  const res = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, redirect_uri: redirectUri,
      client_id: process.env.LINE_CHANNEL_ID ?? "", client_secret: process.env.LINE_CHANNEL_SECRET ?? "",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`LINE token ${res.status}`);
  const tok = (await res.json()) as { access_token: string; id_token: string };
  // shortcut: fake LINE Login until the channel exists (X2-L); verify the id_token signature before go-live
  const claims = JSON.parse(Buffer.from(tok.id_token.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: string; nonce?: string };
  if (!claims.sub || claims.nonce !== nonce) throw new Error("id_token without sub / nonce mismatch");
  const fr = await fetch("https://api.line.me/friendship/v1/status", {
    headers: { Authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(10_000),
  });
  const friend = fr.ok ? Boolean(((await fr.json()) as { friendFlag?: boolean }).friendFlag) : false;
  return { userId: claims.sub, friend };
}
