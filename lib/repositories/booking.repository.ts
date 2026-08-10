import { BookingStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const bookingDetailsInclude = {
  user: true,
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
} satisfies Prisma.BookingInclude;

export type BookingDetails = Prisma.BookingGetPayload<{
  include: typeof bookingDetailsInclude;
}>;

export class BookingRepository {
  async ensureUserExists(userId: string) {
    return prismaUserExists(userId);
  }

  async findBookingForUserById(userId: string, bookingId: string) {
    return prismaFindBookingForUserById(userId, bookingId);
  }

  async countConfirmedSameDayBookings(tx: Prisma.TransactionClient, userId: string, date: Date) {
    return tx.booking.count({
      where: {
        userId,
        status: BookingStatus.CONFIRMED,
        slot: {
          date,
        },
      },
    });
  }

  async findConfirmedBookingByUserAndSlot(tx: Prisma.TransactionClient, userId: string, slotId: string) {
    return tx.booking.findFirst({
      where: {
        userId,
        slotId,
        status: BookingStatus.CONFIRMED,
      },
      include: bookingDetailsInclude,
    });
  }

  async createConfirmedBooking(
    tx: Prisma.TransactionClient,
    input: { userId: string; slotId: string; notes: string | null },
  ) {
    return tx.booking.create({
      data: {
        userId: input.userId,
        slotId: input.slotId,
        status: BookingStatus.CONFIRMED,
        notes: input.notes,
      },
      include: bookingDetailsInclude,
    });
  }

  async updateBookingToCanceled(tx: Prisma.TransactionClient, bookingId: string) {
    return tx.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.CANCELED,
      },
    });
  }

  async hasOtherConfirmedBookingForSlot(
    tx: Prisma.TransactionClient,
    slotId: string,
    excludedBookingId: string,
  ) {
    const count = await tx.booking.count({
      where: {
        slotId,
        status: BookingStatus.CONFIRMED,
        id: {
          not: excludedBookingId,
        },
      },
    });

    return count > 0;
  }
}

async function prismaUserExists(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  return Boolean(user);
}

async function prismaFindBookingForUserById(userId: string, bookingId: string) {
  return prisma.booking.findFirst({
    where: { id: bookingId, userId },
    include: bookingDetailsInclude,
  });
}
