import { cachedOk } from "@/lib/http";
import { APP_CONFIG } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { withRouteHandler } from "@/lib/route-handler";
import { doctorsQuerySchema } from "@/lib/validations/doctor";
import type { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

function numberOrUndefined(value: number | undefined) {
  return Number.isFinite(value) ? value : undefined;
}

export async function GET(request: NextRequest) {
  return withRouteHandler(request, async () => {
    const query = doctorsQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    const where: Prisma.DoctorWhereInput = {
      specialtyId: query.specialty_id,
      hospitalId: query.hospital_id,
      fee: {
        gte: numberOrUndefined(query.min_fee),
        lte: numberOrUndefined(query.max_fee),
      },
      hospital: query.city
        ? {
            locations: {
              some: {
                city: {
                  equals: query.city,
                  mode: "insensitive",
                },
              },
            },
          }
        : undefined,
      OR: query.q
        ? [
            { name: { contains: query.q, mode: "insensitive" } },
            { specialty: { name: { contains: query.q, mode: "insensitive" } } },
            { hospital: { name: { contains: query.q, mode: "insensitive" } } },
          ]
        : undefined,
    };

    const [total, doctors] = await prisma.$transaction([
      prisma.doctor.count({ where }),
      prisma.doctor.findMany({
        where,
        include: {
          specialty: true,
          hospital: {
            include: {
              locations: true,
            },
          },
        },
        orderBy: query.sort
          ? query.sort === "rating"
            ? { rating: "desc" }
            : { fee: "asc" }
          : [{ rating: "desc" }, { fee: "asc" }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    const data = doctors.map((doctor) => {
      const matchedLocation = query.city
        ? doctor.hospital.locations.find(
            (location) => location.city.toLowerCase() === query.city?.toLowerCase(),
          )
        : doctor.hospital.locations[0] ?? null;

      return {
        id: doctor.id,
        name: doctor.name,
        experience: doctor.experience,
        rating: Number(doctor.rating),
        fee: doctor.fee,
        description: doctor.description,
        avatar: doctor.avatar,
        specialty: {
          id: doctor.specialty.id,
          name: doctor.specialty.name,
          icon: doctor.specialty.icon,
        },
        hospital: {
          id: doctor.hospital.id,
          name: doctor.hospital.name,
          address: doctor.hospital.address,
          phone: doctor.hospital.phone,
        },
        location: matchedLocation
          ? {
              id: matchedLocation.id,
              address: matchedLocation.address,
              city: matchedLocation.city,
            }
          : null,
      };
    });

    return cachedOk({
      doctors: data,
      total,
      page: query.page,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    }, APP_CONFIG.cacheTtlSeconds.doctors);
  });
}
