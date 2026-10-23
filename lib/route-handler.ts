import { ApiError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { fail } from "@/lib/http";
import { maintenanceEnd } from "@/lib/frame/settings";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";

function getRequestId(request: NextRequest) {
  return request.headers.get("x-request-id") ?? crypto.randomUUID();
}

function getMetricKey(path: string) {
  if (path.startsWith("/api/auth/")) {
    return "auth";
  }

  if (path.startsWith("/api/bookings")) {
    return "booking";
  }

  if (path === "/api/health") {
    return "health";
  }

  return "other";
}

/** _common event 14 / N-OPS-02 (judge F-05): an API request during maintenance → 503 PI092; health and the X1 webhook stay open */
async function maintenanceAnswer(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/api/health" || path.startsWith("/api/webhooks/")) return null;
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: ["maintenance_from", "maintenance_to"] } } });
  const end = maintenanceEnd(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  return end ? NextResponse.json({ code: "PI092", params: { end: end.toISOString() } }, { status: 503 }) : null;
}

export async function withRouteHandler(
  request: NextRequest,
  handler: () => Promise<Response>,
): Promise<Response> {
  const start = Date.now();
  const requestId = getRequestId(request);
  let response: Response | null = null;
  let status = 500;

  try {
    response = (await maintenanceAnswer(request)) ?? (await handler());
    status = response.status;
    return response;
  } catch (error) {
    if (error instanceof ApiError) {
      response = fail(error.status, error.code, error.message);
      status = error.status;
      return response;
    }

    if (error instanceof ZodError) {
      response = fail(400, "VALIDATION_ERROR", error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
      status = 400;
      return response;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      log("warn", "Prisma known request error", {
        request_id: requestId,
        path: request.nextUrl.pathname,
        method: request.method,
        prisma_code: error.code,
        prisma_message: error.message,
      });

      if (error.code === "P2002") {
        response = fail(409, "CONFLICT", "Dữ liệu bị trùng.");
        status = 409;
        return response;
      }

      if (error.code === "P2003") {
        response = fail(422, "INVALID_REFERENCE", "Dữ liệu tham chiếu không hợp lệ.");
        status = 422;
        return response;
      }

      if (error.code === "P2025") {
        response = fail(404, "NOT_FOUND", "Không tìm thấy dữ liệu.");
        status = 404;
        return response;
      }

      response = fail(400, "DB_ERROR", "Có lỗi dữ liệu xảy ra.");
      status = 400;
      return response;
    }

    log("error", "Unhandled API error", {
      request_id: requestId,
      path: request.nextUrl.pathname,
      method: request.method,
      error: error instanceof Error ? error.message : String(error),
    });

    response = fail(500, "INTERNAL_SERVER_ERROR", "Đã có lỗi hệ thống.");
    status = 500;
    return response;
  } finally {
    const duration = Date.now() - start;
    const statusClass = `${Math.floor(status / 100)}xx`;
    const metricKey = getMetricKey(request.nextUrl.pathname);

    log("info", "api_request", {
      request_id: requestId,
      method: request.method,
      path: request.nextUrl.pathname,
      duration,
      status,
      status_class: statusClass,
      metric_key: metricKey,
    });

    log("info", "api_red_metrics", {
      request_id: requestId,
      metric_key: metricKey,
      request_rate: 1,
      error_rate: status >= 400 ? 1 : 0,
      duration_ms: duration,
      status_class: statusClass,
      method: request.method,
      path: request.nextUrl.pathname,
    });

    response?.headers.set("x-request-id", requestId);
  }
}
