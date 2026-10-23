// Shared by the A03 / A05 tests: staff accounts with real sessions, requests with a same-origin header, cleanup.
import { NextRequest } from "next/server";
import type { Role } from "@prisma/client";
import { hashPassword, login } from "@/lib/auth/service";
import { prisma } from "@/lib/prisma";

export const MARK = "w1test";
export const PW = "Test5678";
export const TEST_IP = "203.0.113.91";
let seq = 0;
let hash = "";

export async function makeStaff(role: Role, o: { clinics?: string[]; mustChangePassword?: boolean } = {}) {
  hash ||= await hashPassword(PW);
  const account = await prisma.account.create({
    data: {
      email: `s${++seq}.${Date.now()}.${MARK}@example.jp`, passwordHash: hash, role, status: "ACTIVE", displayName: "試験 職員",
      mustChangePassword: o.mustChangePassword ?? false,
    },
  });
  const clinics = await prisma.clinic.findMany({ where: { code: { in: o.clinics ?? ["honin"] } } });
  await prisma.staffClinic.createMany({ data: clinics.map((c) => ({ accountId: account.id, clinicId: c.id })) });
  const r = await login({ email: account.email, password: PW, ip: TEST_IP, userAgent: "jest" });
  if (!r.ok || !r.session) throw new Error(`login failed: ${JSON.stringify(r)}`);
  return { account, token: r.session.token, clinicId: clinics[0].id };
}

export function request(url: string, body?: unknown, init: { method?: string; headers?: Record<string, string>; raw?: BodyInit } = {}) {
  const method = init.method ?? (body === undefined && !init.raw ? "GET" : "POST");
  return new NextRequest(`http://localhost:3000${url}`, {
    method,
    headers: { origin: "http://localhost:3000", host: "localhost:3000", "x-forwarded-for": TEST_IP, "content-type": "application/json", ...init.headers },
    ...(method !== "GET" && { body: init.raw ?? JSON.stringify(body ?? {}) }),
  });
}

export async function cleanupStaff() {
  const ids = (await prisma.account.findMany({ where: { email: { contains: MARK } }, select: { id: true } })).map((a) => a.id);
  await prisma.session.deleteMany({ where: { OR: [{ ip: TEST_IP }, { accountId: { in: ids } }] } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ ip: TEST_IP }, { accountId: { in: ids } }] } });
  await prisma.staffClinic.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.account.deleteMany({ where: { id: { in: ids } } });
}
