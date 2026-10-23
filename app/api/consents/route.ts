// _common event 7 / 更新2: POST { consents: { TERMS?: { version, agreed }, PRIVACY?: { version, agreed } } } — the kinds and versions CF-04 showed.
// The server re-checks every kind in session.reconsent: not agreed → 400 PE008 { kinds } and nothing is written (7-2).
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/context";
import { prisma } from "@/lib/prisma";
import { enforceSameOriginMutation } from "@/lib/request-security";
import { withRouteHandler } from "@/lib/route-handler";

const apiError = (status: number, code: string, params: Record<string, unknown> = {}) => NextResponse.json({ code, params }, { status });

type Shown = { version?: unknown; agreed?: unknown };

export async function POST(request: NextRequest) {
  return withRouteHandler(request, async () => {
    enforceSameOriginMutation(request);
    const session = await getSession();
    if (!session) return apiError(401, "PI013");
    if (session.account.role !== "PATIENT") return apiError(403, "SE091");

    const body = await request.json().catch(() => null);
    const shown = (body && typeof body === "object" ? (body as { consents?: Record<string, Shown> }).consents : null) ?? {};
    const kinds = session.reconsent;
    if (kinds.length === 0) return NextResponse.json({ ok: true }); // already agreed (double submit)

    const missing = kinds.filter((k) => shown[k]?.agreed !== true);
    if (missing.length > 0) return apiError(400, "PE008", { kinds: missing });

    // the version written is the one the screen showed; it must be a real, already effective document (N-SEC-08)
    const versions = kinds.map((k) => shown[k]?.version);
    if (versions.some((v) => typeof v !== "string" || v === "")) return apiError(400, "PE090");
    const docs = await prisma.consentDocument.findMany({
      where: { kind: { in: kinds }, language: session.account.language, effectiveFrom: { lte: new Date() } },
      select: { kind: true, version: true },
    });
    const known = new Set(docs.map((d) => `${d.kind}:${d.version}`));
    if (kinds.some((k) => !known.has(`${k}:${shown[k]?.version}`))) return apiError(400, "PE090");

    const now = new Date();
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
    await prisma.consent.createMany({
      data: kinds.map((kind) => ({ accountId: session.account.id, kind, version: shown[kind]!.version as string, agreedAt: now, ip })),
    });
    return NextResponse.json({ ok: true });
  });
}
