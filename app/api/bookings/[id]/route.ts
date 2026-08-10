import { requireAuth } from "@/lib/auth-guard";
import { toIsoDate, toIsoTime } from "@/lib/datetime";
import { ok } from "@/lib/http";
import { enforceSameOriginMutation } from "@/lib/request-security";
import { withRouteHandler } from "@/lib/route-handler";
import { BookingService } from "@/lib/services/booking.service";
import type { NextRequest } from "next/server";

const bookingService = new BookingService();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withRouteHandler(request, async () => {
    const auth = await requireAuth(request);
    const { id } = await params;
    const booking = await bookingService.getBookingForUser(id, auth.userId);

    return ok({
      booking: {
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
      },
    });
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withRouteHandler(request, async () => {
    enforceSameOriginMutation(request);
    const auth = await requireAuth(request);
    const { id } = await params;
    const canceled = await bookingService.cancelBooking(id, auth.userId);

    return ok({
      booking: {
        id: canceled.id,
        status: canceled.status,
      },
    });
  });
}
