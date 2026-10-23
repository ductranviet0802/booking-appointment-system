// N-SEC-03: per address and per IP, fixed window from the first request, every request counted (refused ones too).
// shortcut: in-process store, single instance only; move to a shared store before running more than one instance
const MIN = 60_000;

export const AUTH_LIMITS = {
  login: { windowMs: 15 * MIN, perAddress: 10, perIp: 30 },
  register: { windowMs: 60 * MIN, perAddress: 5, perIp: 20 },
  resend: { windowMs: 60 * MIN, perAddress: 5, perIp: 20 },
  reset: { windowMs: 15 * MIN, perAddress: 5, perIp: 20 },
} as const;

export type AuthAction = keyof typeof AUTH_LIMITS;

const hits = new Map<string, { count: number; resetAt: number }>();

function bump(key: string, windowMs: number, now: number) {
  if (hits.size > 50_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  const cur = hits.get(key);
  if (!cur || cur.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  return ++cur.count;
}

/** counts the request and answers true when it is over the limit (→ PE092, nothing read or written) */
export function overAuthLimit(action: AuthAction, address: string, ip: string | null, now = Date.now()) {
  const l = AUTH_LIMITS[action];
  const byAddress = address ? bump(`${action}:a:${address}`, l.windowMs, now) > l.perAddress : false;
  const byIp = bump(`${action}:i:${ip ?? "unknown"}`, l.windowMs, now) > l.perIp;
  return byAddress || byIp;
}

/** tests only */
export function resetAuthLimits() {
  hits.clear();
}
