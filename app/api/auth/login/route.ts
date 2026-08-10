import { signAuthToken, setAuthCookie } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { enforceSameOriginMutation } from "@/lib/request-security";
import { withRouteHandler } from "@/lib/route-handler";
import { loginSchema } from "@/lib/validations/auth";
import bcrypt from "bcrypt";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  return withRouteHandler(request, async () => {
    enforceSameOriginMutation(request);
    const body = await request.json();
    const payload = loginSchema.parse(body);

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: payload.email.toLowerCase() },
          { email: payload.email },
        ],
      },
    });

    if (!user) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid credentials");
    }

    const valid = await bcrypt.compare(payload.password, user.password);

    if (!valid) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid credentials");
    }

    const token = await signAuthToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });

    const response = ok({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
    setAuthCookie(response, token);
    return response;
  });
}
