import { z } from "zod";

export const doctorsQuerySchema = z.object({
  specialty_id: z.string().uuid().optional(),
  hospital_id: z.string().uuid().optional(),
  city: z.string().min(1).optional(),
  min_fee: z.coerce.number().int().nonnegative().optional(),
  max_fee: z.coerce.number().int().nonnegative().optional(),
  sort: z.enum(["rating", "fee"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(12),
  q: z.string().optional(),
});

export const slotsQuerySchema = z
  .object({
    date: z.string().optional(),
    from_date: z.string().optional(),
    to_date: z.string().optional(),
  })
  .refine((data) => Boolean(data.date || data.from_date || data.to_date), {
    message: "Cần truyền date hoặc from_date/to_date",
    path: ["date"],
  });
