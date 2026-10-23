import { z } from "zod";

const envSchema = z.object({
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  BOOKING_WINDOW_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(300_000).default(60_000),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(5).max(500).default(25),
  RATE_LIMIT_BOOKING_MAX: z.coerce.number().int().min(5).max(500).default(50),
  RATE_LIMIT_PUBLIC_MAX: z.coerce.number().int().min(10).max(2_000).default(120),
  RATE_LIMIT_HEALTH_MAX: z.coerce.number().int().min(10).max(5_000).default(600),
  CACHE_TTL_AUTH_ME_SECONDS: z.coerce.number().int().min(1).max(3_600).default(60),
  CACHE_TTL_DOCTORS_SECONDS: z.coerce.number().int().min(1).max(3_600).default(300),
  CACHE_TTL_SEARCH_SECONDS: z.coerce.number().int().min(1).max(3_600).default(300),
  CACHE_TTL_SLOTS_SECONDS: z.coerce.number().int().min(1).max(3_600).default(30),
  CACHE_TTL_REFERENCE_SECONDS: z.coerce.number().int().min(1).max(86_400).default(3_600),
});

const env = envSchema.parse({
  APP_BASE_URL: process.env.APP_BASE_URL,
  BCRYPT_ROUNDS: process.env.BCRYPT_ROUNDS,
  BOOKING_WINDOW_DAYS: process.env.BOOKING_WINDOW_DAYS,
  RATE_LIMIT_WINDOW_MS: process.env.RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_AUTH_MAX: process.env.RATE_LIMIT_AUTH_MAX,
  RATE_LIMIT_BOOKING_MAX: process.env.RATE_LIMIT_BOOKING_MAX,
  RATE_LIMIT_PUBLIC_MAX: process.env.RATE_LIMIT_PUBLIC_MAX,
  RATE_LIMIT_HEALTH_MAX: process.env.RATE_LIMIT_HEALTH_MAX,
  CACHE_TTL_AUTH_ME_SECONDS: process.env.CACHE_TTL_AUTH_ME_SECONDS,
  CACHE_TTL_DOCTORS_SECONDS: process.env.CACHE_TTL_DOCTORS_SECONDS,
  CACHE_TTL_SEARCH_SECONDS: process.env.CACHE_TTL_SEARCH_SECONDS,
  CACHE_TTL_SLOTS_SECONDS: process.env.CACHE_TTL_SLOTS_SECONDS,
  CACHE_TTL_REFERENCE_SECONDS: process.env.CACHE_TTL_REFERENCE_SECONDS,
});

export const APP_CONFIG = {
  /** public origin used in mail links (NT-05 / NT-06) */
  baseUrl: env.APP_BASE_URL.replace(/\/$/, ""),
  auth: {
    bcryptRounds: env.BCRYPT_ROUNDS,
  },
  booking: {
    windowDays: env.BOOKING_WINDOW_DAYS,
  },
  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    maxRequestsByGroup: {
      auth: env.RATE_LIMIT_AUTH_MAX,
      booking: env.RATE_LIMIT_BOOKING_MAX,
      public: env.RATE_LIMIT_PUBLIC_MAX,
      health: env.RATE_LIMIT_HEALTH_MAX,
    },
  },
  cacheTtlSeconds: {
    authMe: env.CACHE_TTL_AUTH_ME_SECONDS,
    doctors: env.CACHE_TTL_DOCTORS_SECONDS,
    search: env.CACHE_TTL_SEARCH_SECONDS,
    slots: env.CACHE_TTL_SLOTS_SECONDS,
    reference: env.CACHE_TTL_REFERENCE_SECONDS,
  },
} as const;

export type RateLimitGroup = keyof typeof APP_CONFIG.rateLimit.maxRequestsByGroup;
