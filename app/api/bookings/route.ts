import { requireAuth } from "@/lib/auth-guard";
import { toIsoDate, toIsoTime } from "@/lib/datetime";
import { ok } from "@/lib/http";
import { enforceSameOriginMutation } from "@/lib/request-security";
import { withRouteHandler } from "@/lib/route-handler";
import { BookingService } from "@/lib/services/booking.service";
import { createBookingSchema } from "@/lib/validations/booking";
import type { NextRequest } from "next/server";

const bookingService = new BookingService();

export async function POST(request: NextRequest) {
  return withRouteHandler(request, async () => {
    enforceSameOriginMutation(request);
    const auth = await requireAuth(request);
    const body = await request.json();
    const payload = createBookingSchema.parse(body);
    const result = await bookingService.createBooking({
      userId: auth.userId,
      slotId: payload.slot_id,
      notes: payload.notes,
    });
    const booking = result.booking;

    return ok({
      booking: {
        id: booking.id,
        status: booking.status,
        created_at: booking.createdAt,
        notes: booking.notes,
        patient: {
          id: booking.user.id,
          email: booking.user.email,
          name: booking.user.name,
        },
        slot: {
          id: booking.slot.id,
          date: toIsoDate(booking.slot.date),
          start_time: toIsoTime(booking.slot.startTime),
          end_time: toIsoTime(booking.slot.endTime),
        },
        doctor: {
          id: booking.slot.doctor.id,
          name: booking.slot.doctor.name,
          fee: booking.slot.doctor.fee,
          specialty: booking.slot.doctor.specialty.name,
          hospital: booking.slot.doctor.hospital.name,
        },
      },
      reused: result.reused,
    }, result.reused ? 200 : 201);
  });
}
