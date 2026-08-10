import { APP_CONFIG } from "@/lib/config";
import { combineDateAndTime } from "@/lib/datetime";
import { ApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { BookingRepository, type BookingDetails } from "@/lib/repositories/booking.repository";
import { SlotRepository } from "@/lib/repositories/slot.repository";
import { sanitizePatientNotes } from "@/lib/sanitize";
import { BookingStatus, Prisma } from "@prisma/client";

const bookingRepository = new BookingRepository();
const slotRepository = new SlotRepository();

export type CreateBookingInput = {
  userId: string;
  slotId: string;
  notes?: string | null;
};

export type CreateBookingResult = {
  booking: BookingDetails;
  reused: boolean;
};

export class BookingService {
  async getBookingForUser(bookingId: string, userId: string) {
    const booking = await bookingRepository.findBookingForUserById(userId, bookingId);
    if (!booking) {
      throw new ApiError(404, "BOOKING_NOT_FOUND", "Không tìm thấy lịch hẹn.");
    }

    return booking;
  }

  async createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
    const requesterExists = await bookingRepository.ensureUserExists(input.userId);
    if (!requesterExists) {
      throw new ApiError(401, "UNAUTHORIZED", "Phiên đăng nhập không hợp lệ hoặc đã hết hạn.");
    }

    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const maxBookableDateUtc = new Date(todayUtc);
    maxBookableDateUtc.setUTCDate(maxBookableDateUtc.getUTCDate() + APP_CONFIG.booking.windowDays);
    const notes = sanitizePatientNotes(input.notes ?? null);

    return prisma.$transaction(async (tx) => {
      const slot = await slotRepository.findSlotWithDoctor(tx, input.slotId);
      if (!slot) {
        throw new ApiError(404, "SLOT_NOT_FOUND", "Không tìm thấy khung giờ khám.");
      }

      const appointmentStart = combineDateAndTime(slot.date, slot.startTime);
      if (appointmentStart.getTime() <= now.getTime()) {
        throw new ApiError(410, "SLOT_EXPIRED", "Khung giờ đã qua, không thể đặt lịch.");
      }

      if (slot.date.getTime() > maxBookableDateUtc.getTime()) {
        throw new ApiError(
          422,
          "BOOKING_WINDOW_EXCEEDED",
          `Chỉ có thể đặt lịch tối đa ${APP_CONFIG.booking.windowDays} ngày kể từ hôm nay.`,
        );
      }

      const confirmedSameDayCount = await bookingRepository.countConfirmedSameDayBookings(tx, input.userId, slot.date);
      if (confirmedSameDayCount >= 3) {
        throw new ApiError(422, "DAILY_LIMIT_EXCEEDED", "Bạn chỉ có thể đặt tối đa 3 lịch trong một ngày.");
      }

      const markedBooked = await slotRepository.markSlotAsBookedIfAvailable(tx, input.slotId);
      if (!markedBooked) {
        const existing = await bookingRepository.findConfirmedBookingByUserAndSlot(tx, input.userId, input.slotId);
        if (existing) {
          return { booking: existing, reused: true };
        }

        throw new ApiError(409, "SLOT_ALREADY_BOOKED", "Slot này đã được đặt.");
      }

      const booking = await bookingRepository.createConfirmedBooking(tx, {
        userId: input.userId,
        slotId: input.slotId,
        notes,
      });

      return { booking, reused: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async cancelBooking(bookingId: string, userId: string) {
    const booking = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        userId,
      },
      include: {
        slot: true,
      },
    });

    if (!booking) {
      throw new ApiError(404, "BOOKING_NOT_FOUND", "Không tìm thấy lịch hẹn.");
    }

    if (booking.status === BookingStatus.CANCELED) {
      throw new ApiError(410, "BOOKING_ALREADY_CANCELED", "Lịch hẹn đã được hủy trước đó.");
    }

    const appointmentStart = combineDateAndTime(booking.slot.date, booking.slot.startTime);
    const now = new Date();
    if (appointmentStart.getTime() - now.getTime() < 60 * 60 * 1000) {
      throw new ApiError(
        410,
        "BOOKING_TOO_LATE_TO_CANCEL",
        "Chỉ có thể hủy lịch trước giờ hẹn ít nhất 1 giờ.",
      );
    }

    return prisma.$transaction(async (tx) => {
      const updatedBooking = await bookingRepository.updateBookingToCanceled(tx, booking.id);
      const hasAnotherConfirmedBooking = await bookingRepository.hasOtherConfirmedBookingForSlot(
        tx,
        booking.slotId,
        booking.id,
      );

      if (!hasAnotherConfirmedBooking) {
        await slotRepository.markSlotAsUnbooked(tx, booking.slotId);
      }

      return updatedBooking;
    });
  }
}
