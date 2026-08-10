import { requireAuth } from "@/lib/auth-guard";
import { APP_CONFIG } from "@/lib/config";
import { combineDateAndTime } from "@/lib/datetime";
import { privateOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withRouteHandler } from "@/lib/route-handler";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  return withRouteHandler(request, async () => {
    const auth = await requireAuth(request);
    const now = new Date();

    const bookings = await prisma.booking.findMany({
      where: {
        userId: auth.userId,
        status: "CONFIRMED",
      },
      select: {
        slot: {
          select: {
            date: true,
            startTime: true,
          },
        },
      },
    });

    const bookingCount = bookings.filter((booking) => {
      const appointmentStart = combineDateAndTime(booking.slot.date, booking.slot.startTime);
      return appointmentStart.getTime() > now.getTime();
    }).length;

    return privateOk({
      user: {
        id: auth.userId,
        email: auth.email,
        name: auth.name,
        role: auth.role,
      },
      bookingCount,
    }, APP_CONFIG.cacheTtlSeconds.authMe);
  });
}
