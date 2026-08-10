import { ApiError } from "@/lib/errors";
import { getAuthTokenFromRequest, verifyAuthToken } from "@/lib/auth";
import type { NextRequest } from "next/server";

export async function requireAuth(request: NextRequest) {
  const token = getAuthTokenFromRequest(request);

  if (!token) {
    throw new ApiError(401, "UNAUTHORIZED", "Bạn cần đăng nhập để tiếp tục.");
  }

  try {
    return await verifyAuthToken(token);
  } catch {
    throw new ApiError(401, "UNAUTHORIZED", "Phiên đăng nhập không hợp lệ hoặc đã hết hạn.");
  }
}
