import { getAuthTokenFromRequest, verifyAuthToken } from "@/lib/auth";
import { APP_CONFIG } from "@/lib/config";
import { combineDateAndTime, isSameUtcDate, toIsoDate, toIsoTime } from "@/lib/datetime";
import { ApiError } from "@/lib/errors";
import { privateOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withRouteHandler } from "@/lib/route-handler";
import { slotsQuerySchema } from "@/lib/validations/doctor";
import type { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

function toDate(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withRouteHandler(request, async () => {
    const { id } = await params;
    const query = slotsQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()));

    const doctor = await prisma.doctor.findUnique({ where: { id }, select: { id: true } });

    if (!doctor) {
      throw new ApiError(404, "DOCTOR_NOT_FOUND", "Không tìm thấy bác sĩ.");
    }

    const token = getAuthTokenFromRequest(request);
    let isAuthenticated = false;

    if (token) {
      try {
        await verifyAuthToken(token);
        isAuthenticated = true;
      } catch {
        isAuthenticated = false;
      }
    }

    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const maxBookableDateUtc = new Date(todayUtc);
    maxBookableDateUtc.setUTCDate(maxBookableDateUtc.getUTCDate() + APP_CONFIG.booking.windowDays);

    const fromDate = toDate(query.date ?? query.from_date) ?? todayUtc;
    const toDateValue = toDate(query.date ?? query.to_date) ?? fromDate;
    const normalizedFromDate = fromDate.getTime() < todayUtc.getTime() ? todayUtc : fromDate;
    const normalizedToDate = toDateValue.getTime() > maxBookableDateUtc.getTime()
      ? maxBookableDateUtc
      : toDateValue;

    if (normalizedFromDate.getTime() > maxBookableDateUtc.getTime()) {
      return privateOk({ slots: [] }, APP_CONFIG.cacheTtlSeconds.slots);
    }

    if (normalizedToDate.getTime() < normalizedFromDate.getTime()) {
      return privateOk({ slots: [] }, APP_CONFIG.cacheTtlSeconds.slots);
    }

    const where: Prisma.DoctorSlotWhereInput = {
      doctorId: id,
      date: {
        gte: normalizedFromDate,
        lte: normalizedToDate,
      },
      ...(isAuthenticated ? {} : { isBooked: false }),
    };

    const slots = await prisma.doctorSlot.findMany({
      where,
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    });

    const normalized = slots
      .filter((slot) => {
        if (slot.date > todayUtc) {
          return true;
        }

        if (slot.date < todayUtc) {
          return false;
        }

        const slotStart = combineDateAndTime(slot.date, slot.startTime);
        return slotStart.getTime() > now.getTime();
      })
      .map((slot) => ({
        id: slot.id,
        date: toIsoDate(slot.date),
        start_time: toIsoTime(slot.startTime),
        end_time: toIsoTime(slot.endTime),
        is_booked: slot.isBooked,
        is_today: isSameUtcDate(slot.date, now),
      }));

    return privateOk({ slots: normalized }, APP_CONFIG.cacheTtlSeconds.slots);
  });
}
