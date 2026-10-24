// J-14 (W2 judge): per-IP rate limits — the proxy limiter (lib/rate-limiter.ts, every /api request by group) and the auth
// limits (lib/auth/rate-limit.ts, N-SEC-03): the limit is hit per IP, other IPs (and other groups / actions) are not
// affected, refused requests still count, the fixed window resets at its end (not one millisecond before).
import { AUTH_LIMITS, overAuthLimit, resetAuthLimits, type AuthAction } from "@/lib/auth/rate-limit";
import { APP_CONFIG } from "@/lib/config";
import { consumeRateLimitToken } from "@/lib/rate-limiter";
import { clientIp } from "@/lib/request-security";

const WINDOW = APP_CONFIG.rateLimit.windowMs;
const MAX = APP_CONFIG.rateLimit.maxRequestsByGroup;
let clock = Date.UTC(2030, 0, 1); // monotonic per test: the limiter prunes by the `now` it is given
const start = () => (clock += 10 * 24 * 3_600_000);

describe("consumeRateLimitToken (proxy, per IP and group)", () => {
  it.each(Object.keys(MAX) as Array<keyof typeof MAX>)("%s: max requests per IP pass, the next is limited; another IP is not", (group) => {
    const t = start();
    const ip = `198.51.100.${10 + Object.keys(MAX).indexOf(group)}`;
    for (let i = 1; i <= MAX[group]; i++) {
      const r = consumeRateLimitToken(ip, group, t + i);
      expect([r.limited, r.remaining]).toEqual([false, MAX[group] - i]);
    }
    const over = consumeRateLimitToken(ip, group, t + MAX[group] + 1);
    expect(over.limited).toBe(true);
    expect(over.remaining).toBe(0);
    expect(over.retryAfterSeconds).toBe(Math.ceil((t + 1 + WINDOW - (t + MAX[group] + 1)) / 1000));
    expect(consumeRateLimitToken("198.51.100.200", group, t + MAX[group] + 2).limited).toBe(false);
    expect(consumeRateLimitToken(ip, group, t + MAX[group] + 3).limited).toBe(true); // refused requests count too
  });

  it("groups are separate buckets for one IP", () => {
    const t = start();
    const ip = "198.51.100.31";
    for (let i = 0; i <= MAX.auth; i++) consumeRateLimitToken(ip, "auth", t);
    expect(consumeRateLimitToken(ip, "auth", t).limited).toBe(true);
    expect(consumeRateLimitToken(ip, "booking", t).limited).toBe(false);
    expect(consumeRateLimitToken(ip, "public", t).limited).toBe(false);
  });

  it("fixed window from the first request: still limited 1 ms before its end, reset at the end", () => {
    const t = start();
    const ip = "198.51.100.32";
    for (let i = 0; i <= MAX.booking; i++) consumeRateLimitToken(ip, "booking", t);
    expect(consumeRateLimitToken(ip, "booking", t + WINDOW - 1).limited).toBe(true);
    const fresh = consumeRateLimitToken(ip, "booking", t + WINDOW);
    expect([fresh.limited, fresh.remaining, fresh.retryAfterSeconds]).toEqual([false, MAX.booking - 1, Math.ceil(WINDOW / 1000)]);
  });
});

describe("overAuthLimit (N-SEC-03, per IP and per address)", () => {
  beforeEach(() => resetAuthLimits());

  it.each(Object.keys(AUTH_LIMITS) as AuthAction[])("%s: perIp requests from one IP (all addresses) pass, the next is over; another IP is not", (action) => {
    const l = AUTH_LIMITS[action];
    const t = start();
    for (let i = 0; i < l.perIp; i++) expect(overAuthLimit(action, `u${i}@x.jp`, "192.0.2.1", t + i)).toBe(false);
    expect(overAuthLimit(action, "next@x.jp", "192.0.2.1", t + l.perIp)).toBe(true);
    expect(overAuthLimit(action, "next2@x.jp", "192.0.2.2", t + l.perIp)).toBe(false);
    expect(overAuthLimit(action, "next3@x.jp", "192.0.2.1", t + l.windowMs - 1)).toBe(true); // refused ones count, window not over
    expect(overAuthLimit(action, "next4@x.jp", "192.0.2.1", t + l.windowMs)).toBe(false); // window of the first request ended
  });

  it("actions are separate buckets for one IP; resetAuthLimits clears every bucket", () => {
    const t = start();
    const l = AUTH_LIMITS.reset;
    for (let i = 0; i <= l.perIp; i++) overAuthLimit("reset", `r${i}@x.jp`, "192.0.2.9", t);
    expect(overAuthLimit("reset", "z@x.jp", "192.0.2.9", t)).toBe(true);
    expect(overAuthLimit("login", "z@x.jp", "192.0.2.9", t)).toBe(false);
    resetAuthLimits();
    expect(overAuthLimit("reset", "z@x.jp", "192.0.2.9", t)).toBe(false);
  });

  it("the address limit is independent of the IP limit (an address over its limit from fresh IPs)", () => {
    const t = start();
    const l = AUTH_LIMITS.login;
    for (let i = 0; i < l.perAddress; i++) expect(overAuthLimit("login", "victim@x.jp", `192.0.2.${100 + i}`, t)).toBe(false);
    expect(overAuthLimit("login", "victim@x.jp", "192.0.2.250", t)).toBe(true);
    expect(overAuthLimit("login", "other@x.jp", "192.0.2.250", t)).toBe(false);
  });

  it("requests without a usable IP share no bucket: one client cannot fill an 'unknown' bucket for everyone; the address limit still holds", () => {
    const t = start();
    const l = AUTH_LIMITS.register;
    for (let i = 0; i <= l.perIp; i++) overAuthLimit("register", `n${i}@x.jp`, null, t);
    expect(overAuthLimit("register", "late@x.jp", null, t)).toBe(false);
    for (let i = 0; i < l.perAddress; i++) overAuthLimit("register", "same@x.jp", null, t);
    expect(overAuthLimit("register", "same@x.jp", null, t)).toBe(true);
  });
});

describe("clientIp (X-Forwarded-For trusted only behind TRUSTED_PROXY_HOPS proxies)", () => {
  const xff = (v: string | null) => new Headers(v === null ? {} : { "x-forwarded-for": v });
  const env = process.env.TRUSTED_PROXY_HOPS;
  afterEach(() => {
    if (env === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = env;
  });

  it("default 0: the header is not trusted (a client cannot pick its address)", () => {
    delete process.env.TRUSTED_PROXY_HOPS;
    expect(clientIp(xff("203.0.113.9"))).toBeNull();
    process.env.TRUSTED_PROXY_HOPS = "0";
    expect(clientIp(xff("203.0.113.9"))).toBeNull();
  });

  it("N hops: the N-th address from the right; a spoofed left part is ignored", () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    expect(clientIp(xff("1.2.3.4, 203.0.113.9"))).toBe("203.0.113.9");
    expect(clientIp(xff("2001:db8::1"))).toBe("2001:db8::1");
    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(clientIp(xff("1.2.3.4, 203.0.113.9, 10.0.0.2"))).toBe("203.0.113.9");
  });

  it("no usable address → null: header missing, shorter than N, not an address, a bad setting", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(clientIp(xff(null))).toBeNull();
    expect(clientIp(xff("203.0.113.9"))).toBeNull();
    process.env.TRUSTED_PROXY_HOPS = "1";
    expect(clientIp(xff("unknown"))).toBeNull();
    expect(clientIp(xff(" , "))).toBeNull();
    process.env.TRUSTED_PROXY_HOPS = "one";
    expect(clientIp(xff("203.0.113.9"))).toBeNull();
  });
});
