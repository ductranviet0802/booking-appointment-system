import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(8, "Mật khẩu phải có ít nhất 8 ký tự")
  .regex(/[A-Z]/, "Mật khẩu phải chứa ít nhất 1 chữ in hoa")
  .regex(/[0-9]/, "Mật khẩu phải chứa ít nhất 1 chữ số");

export const registerSchema = z.object({
  email: z.string().email("Email không hợp lệ").max(255),
  password: passwordSchema,
  name: z.string().min(2, "Tên quá ngắn").max(255),
  phone: z
    .string()
    .min(9, "Số điện thoại không hợp lệ")
    .max(20, "Số điện thoại không hợp lệ")
    .regex(/^[0-9+\-\s().]+$/, "Số điện thoại không hợp lệ")
    .optional(),
});

export const loginSchema = z.object({
  email: z.string().min(3, "Email hoặc username không hợp lệ"),
  password: z.string().min(8, "Mật khẩu phải có ít nhất 8 ký tự"),
});
