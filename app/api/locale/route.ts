// _common event 2 / 更新1: POST { language: "ja" | "en" | "vi" }.
// Sets the 1-year cookie; a logged-in patient also gets accounts.language. Any other value is refused: nothing written, no message (N-SEC-08, 2-2).
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/context";
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE, LANGS } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";
import { prisma } from "@/lib/prisma";
import { enforceSameOriginMutation } from "@/lib/request-security";
import { withRouteHandler } from "@/lib/route-handler";

export async function POST(request: NextRequest) {
  return withRouteHandler(request, async () => {
    enforceSameOriginMutation(request);
    const body = await request.json().catch(() => null);
    const language = body && typeof body === "object" ? (body as { language?: unknown }).language : undefined;
    if (typeof language !== "string" || !LANGS.includes(language as Lang)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const session = await getSession();
    // staff UI is always ja (F13-01): their request changes nothing
    if (session && session.account.role !== "PATIENT") return NextResponse.json({ ok: true, language: "ja" });
    if (session) {
      await prisma.account.update({ where: { id: session.account.id }, data: { language: language.toUpperCase() as "JA" | "EN" | "VI" } });
    }

    const res = NextResponse.json({ ok: true, language });
    res.cookies.set(LANG_COOKIE, language, {
      maxAge: LANG_COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    return res;
  });
}
