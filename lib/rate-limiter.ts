import { APP_CONFIG, type RateLimitGroup } from "@/lib/config";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

// one store per process (pages and route handlers are separate module instances)
const g = globalThis as unknown as { rateLimitStore?: Map<string, RateLimitEntry> };
const store = (g.rateLimitStore ??= new Map<string, RateLimitEntry>());

function prune(now: number) {
  for (const [key, value] of store.entries()) {
    if (value.resetAt <= now) {
      store.delete(key);
    }
  }
}

export function consumeRateLimitToken(ip: string, group: RateLimitGroup, now = Date.now()) {
  prune(now);

  const key = `${group}:${ip}`;
  const windowMs = APP_CONFIG.rateLimit.windowMs;
  const maxRequests = APP_CONFIG.rateLimit.maxRequestsByGroup[group];
  const existing = store.get(key);

  if (!existing || existing.resetAt <= now) {
    store.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });

    return {
      limited: false,
      remaining: maxRequests - 1,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  existing.count += 1;
  const limited = existing.count > maxRequests;

  return {
    limited,
    remaining: Math.max(0, maxRequests - existing.count),
    retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
  };
}
