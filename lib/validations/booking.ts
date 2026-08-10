import { z } from "zod";

export const createBookingSchema = z.object({
  slot_id: z.string().uuid("slot_id không hợp lệ"),
  notes: z.string().max(1000, "Ghi chú quá dài").optional(),
});

export const myBookingsQuerySchema = z.object({
  status: z.enum(["CONFIRMED", "CANCELED"]).optional(),
});
