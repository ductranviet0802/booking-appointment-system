import { ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withRouteHandler } from "@/lib/route-handler";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  return withRouteHandler(request, async () => {
    let database: "up" | "down" = "up";
    let status: "ok" | "degraded" = "ok";

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = "down";
      status = "degraded";
    }

    return ok({
      status,
      database,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? "unknown",
    });
  });
}
