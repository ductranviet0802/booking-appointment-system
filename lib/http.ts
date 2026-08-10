import { NextResponse } from "next/server";

type ResponseHeaders = HeadersInit;

function json<T>(payload: T, status = 200, headers?: ResponseHeaders) {
  return NextResponse.json(payload, { status, headers });
}

function getStaleWhileRevalidate(maxAge: number) {
  return Math.max(30, Math.floor(maxAge / 2));
}

export function ok<T>(payload: T, status = 200, headers?: ResponseHeaders) {
  return json(payload, status, headers);
}

export function cachedOk<T>(payload: T, maxAge: number, status = 200) {
  return json(payload, status, {
    "Cache-Control": `public, s-maxage=${maxAge}, stale-while-revalidate=${getStaleWhileRevalidate(maxAge)}`,
  });
}

export function privateOk<T>(payload: T, maxAge: number, status = 200) {
  return json(payload, status, {
    "Cache-Control": `private, max-age=${maxAge}, stale-while-revalidate=${getStaleWhileRevalidate(maxAge)}`,
    Vary: "Cookie",
  });
}

export function fail(status: number, code: string, message: string) {
  return json({ code, message }, status);
}
