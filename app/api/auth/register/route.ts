import { signAuthToken, setAuthCookie } from "@/lib/auth";
import { APP_CONFIG } from "@/lib/config";
import { ApiError } from "@/lib/errors";
import { ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { enforceSameOriginMutation } from "@/lib/request-security";
import { withRouteHandler } from "@/lib/route-handler";
import { registerSchema } from "@/lib/validations/auth";
import bcrypt from "bcrypt";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  return withRouteHandler(request, async () => {
    enforceSameOriginMutation(request);
    const body = await request.json();
    const payload = registerSchema.parse(body);
    const normalizedEmail = payload.email.toLowerCase();

    const existed = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (existed) {
      throw new ApiError(409, "EMAIL_EXISTS", "Email đã tồn tại.");
    }

    const hashedPassword = await bcrypt.hash(payload.password, APP_CONFIG.auth.bcryptRounds);

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hashedPassword,
        name: payload.name,
        phone: payload.phone,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    });

    const token = await signAuthToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });

    const response = ok({ user }, 201);
    setAuthCookie(response, token);
    return response;
  });
}
