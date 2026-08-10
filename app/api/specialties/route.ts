import { cachedOk } from "@/lib/http";
import { APP_CONFIG } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { withRouteHandler } from "@/lib/route-handler";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  return withRouteHandler(request, async () => {
    const specialties = await prisma.specialty.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        icon: true,
      },
    });

    return cachedOk({ specialties }, APP_CONFIG.cacheTtlSeconds.reference);
  });
}
