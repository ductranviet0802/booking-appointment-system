import type { Prisma } from "@prisma/client";

export class SlotRepository {
  async findSlotWithDoctor(tx: Prisma.TransactionClient, slotId: string) {
    return tx.doctorSlot.findUnique({
      where: { id: slotId },
      include: {
        doctor: {
          include: {
            specialty: true,
            hospital: true,
          },
        },
      },
    });
  }

  async markSlotAsBookedIfAvailable(tx: Prisma.TransactionClient, slotId: string) {
    const updatedRows = await tx.doctorSlot.updateMany({
      where: {
        id: slotId,
        isBooked: false,
      },
      data: {
        isBooked: true,
      },
    });

    return updatedRows.count > 0;
  }

  async markSlotAsUnbooked(tx: Prisma.TransactionClient, slotId: string) {
    await tx.doctorSlot.update({
      where: { id: slotId },
      data: {
        isBooked: false,
      },
    });
  }
}
