import { requireAuth } from "@/lib/auth-guard";
import { toIsoDate, toIsoTime } from "@/lib/datetime";
import { ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withRouteHandler } from "@/lib/route-handler";
import { myBookingsQuerySchema } from "@/lib/validations/booking";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  return withRouteHandler(request, async () => {
    const auth = await requireAuth(request);
    const query = myBookingsQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()));

    const bookings = await prisma.booking.findMany({
      where: {
        userId: auth.userId,
        status: query.status,
      },
      include: {
        slot: {
          include: {
            doctor: {
              include: {
                specialty: true,
                hospital: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return ok({
      bookings: bookings.map((booking) => ({
        id: booking.id,
        status: booking.status,
        created_at: booking.createdAt,
        notes: booking.notes,
        slot: {
          id: booking.slot.id,
          date: toIsoDate(booking.slot.date),
          start_time: toIsoTime(booking.slot.startTime),
          end_time: toIsoTime(booking.slot.endTime),
        },
        doctor: {
          id: booking.slot.doctor.id,
          name: booking.slot.doctor.name,
          specialty: booking.slot.doctor.specialty.name,
          hospital: booking.slot.doctor.hospital.name,
          fee: booking.slot.doctor.fee,
        },
      })),
    });
  });
}
