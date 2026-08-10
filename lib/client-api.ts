export type ApiErrorPayload = {
  code: string;
  message: string;
};

export class ClientApiError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);
    this.status = status;
    this.code = payload.code;
  }
}

type CacheEntry = {
  data: unknown;
  expiresAt: number;
};

const responseCache = new Map<string, CacheEntry>();
const inflightRequests = new Map<string, Promise<unknown>>();
const IS_DEV = process.env.NODE_ENV !== "production";

function normalizePath(path: string) {
  if (!path.includes("?")) {
    return path;
  }

  const [basePath, rawQuery = ""] = path.split("?");
  const sourceParams = new URLSearchParams(rawQuery);
  const normalized = new URLSearchParams();
  const keys = Array.from(new Set(sourceParams.keys())).sort();

  for (const key of keys) {
    const values = sourceParams.getAll(key);
    values.sort();
    for (const value of values) {
      normalized.append(key, value);
    }
  }

  const normalizedQuery = normalized.toString();
  return normalizedQuery ? `${basePath}?${normalizedQuery}` : basePath;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new ClientApiError(response.status, {
      code: data.code ?? "UNKNOWN_ERROR",
      message: data.message ?? "Đã xảy ra lỗi không xác định.",
    });
  }

  return data as T;
}

function getTtlFromCacheControl(cacheControl: string | null) {
  if (!cacheControl || /no-store|no-cache/i.test(cacheControl)) {
    return 0;
  }

  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  if (maxAgeMatch) {
    return Number.parseInt(maxAgeMatch[1] ?? "0", 10);
  }

  const sharedMaxAgeMatch = cacheControl.match(/s-maxage=(\d+)/i);
  if (sharedMaxAgeMatch) {
    return Number.parseInt(sharedMaxAgeMatch[1] ?? "0", 10);
  }

  return 0;
}

function getCachedValue<T>(path: string) {
  const entry = responseCache.get(path);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    responseCache.delete(path);
    return null;
  }

  return entry.data as T;
}

function setCachedValue(path: string, data: unknown, ttlSeconds: number) {
  if (ttlSeconds <= 0) {
    responseCache.delete(path);
    return;
  }

  responseCache.set(path, {
    data,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

export function clearApiCache(prefix?: string) {
  if (!prefix) {
    responseCache.clear();
    inflightRequests.clear();
    return;
  }

  for (const key of responseCache.keys()) {
    if (key.startsWith(prefix)) {
      responseCache.delete(key);
    }
  }

  for (const key of inflightRequests.keys()) {
    if (key.startsWith(prefix)) {
      inflightRequests.delete(key);
    }
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const cacheKey = normalizePath(path);
  const cached = getCachedValue<T>(cacheKey);

  if (cached !== null) {
    if (IS_DEV) {
      console.info("[client-api] cache-hit", { path, cacheKey });
    }
    return cached;
  }

  const inflight = inflightRequests.get(cacheKey);

  if (inflight) {
    if (IS_DEV) {
      console.info("[client-api] inflight-hit", { path, cacheKey });
    }
    return inflight as Promise<T>;
  }

  if (IS_DEV) {
    console.info("[client-api] fetch-get", { path, cacheKey });
  }

  const requestPromise = fetch(path, {
    method: "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  })
    .then(async (response) => {
      const data = await parseResponse<T>(response);
      const ttlSeconds = getTtlFromCacheControl(response.headers.get("cache-control"));
      setCachedValue(cacheKey, data, ttlSeconds);
      return data;
    })
    .finally(() => {
      inflightRequests.delete(cacheKey);
    });

  inflightRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  return parseResponse<T>(response);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: "DELETE",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  });

  return parseResponse<T>(response);
}
