import { cachedOk } from "@/lib/http";
import { APP_CONFIG } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { withRouteHandler } from "@/lib/route-handler";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  return withRouteHandler(request, async () => {
    const hospitals = await prisma.hospital.findMany({
      orderBy: { name: "asc" },
      include: {
        locations: {
          select: {
            id: true,
            address: true,
            city: true,
          },
          orderBy: [{ city: "asc" }, { address: "asc" }],
        },
      },
    });

    return cachedOk({ hospitals }, APP_CONFIG.cacheTtlSeconds.reference);
  });
}
