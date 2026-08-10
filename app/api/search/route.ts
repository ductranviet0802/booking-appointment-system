import { cachedOk } from "@/lib/http";
import { APP_CONFIG } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { withRouteHandler } from "@/lib/route-handler";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  return withRouteHandler(request, async () => {
    const q = request.nextUrl.searchParams.get("q")?.trim();

    if (!q) {
      return cachedOk({ doctors: [] }, APP_CONFIG.cacheTtlSeconds.search);
    }

    const doctors = await prisma.doctor.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { specialty: { name: { contains: q, mode: "insensitive" } } },
          { hospital: { name: { contains: q, mode: "insensitive" } } },
        ],
      },
      include: {
        specialty: true,
        hospital: true,
      },
      orderBy: [{ rating: "desc" }, { fee: "asc" }],
      take: 30,
    });

    return cachedOk({
      doctors: doctors.map((doctor) => ({
        id: doctor.id,
        name: doctor.name,
        specialty: doctor.specialty.name,
        hospital: doctor.hospital.name,
        rating: Number(doctor.rating),
        fee: doctor.fee,
      })),
    }, APP_CONFIG.cacheTtlSeconds.search);
  });
}
