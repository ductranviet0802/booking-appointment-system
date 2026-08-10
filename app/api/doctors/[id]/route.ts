import { ApiError } from "@/lib/errors";
import { ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withRouteHandler } from "@/lib/route-handler";
import type { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withRouteHandler(request, async () => {
    const { id } = await params;

    const doctor = await prisma.doctor.findUnique({
      where: { id },
      include: {
        specialty: true,
        hospital: {
          include: {
            locations: true,
          },
        },
      },
    });

    if (!doctor) {
      throw new ApiError(404, "DOCTOR_NOT_FOUND", "Không tìm thấy bác sĩ.");
    }

    return ok({
      doctor: {
        id: doctor.id,
        name: doctor.name,
        specialty: {
          id: doctor.specialty.id,
          name: doctor.specialty.name,
          icon: doctor.specialty.icon,
          description: doctor.specialty.description,
        },
        experience: doctor.experience,
        rating: Number(doctor.rating),
        fee: doctor.fee,
        description: doctor.description,
        avatar: doctor.avatar,
        hospital: {
          id: doctor.hospital.id,
          name: doctor.hospital.name,
          address: doctor.hospital.address,
          phone: doctor.hospital.phone,
          locations: doctor.hospital.locations,
        },
        location: doctor.hospital.locations[0] ?? null,
      },
    });
  });
}
