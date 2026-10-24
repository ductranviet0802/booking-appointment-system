// Shared by the P11 / P12 / P13 tests: an own clinic (b2-helpers) with frames inside the booking window, patient accounts
// with a real login session (the session cookie is served by the next/headers mock of each test file through `jar`),
// requests carrying the draft cookie, and the cleanup of everything made here.
import { AsyncLocalStorage } from "node:async_hooks";
import bcrypt from "bcrypt";
import { NextRequest } from "next/server";
import { resolveSession } from "@/lib/auth/context";
import { login } from "@/lib/auth/service";
import { addDays, dbDate, dbTime, todayJst } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { fixture, type Fixture } from "./b2-helpers";

/**
 * the session cookie the next/headers mock serves (a mock factory cannot import, so both live on globalThis): the
 * AsyncLocalStorage value of `run` (parallel requests of different users), else the last `req` caller (`jar`)
 */
export type W1 = { w1jar: { sid?: string }; w1als: AsyncLocalStorage<string | undefined> };
const g = globalThis as unknown as W1;
export const jar = (g.w1jar ??= {});
const als = (g.w1als ??= new AsyncLocalStorage<string | undefined>());
export const run = <T>(as: { sid: string } | null, fn: () => Promise<T>) => als.run(as?.sid, fn);
export const DAY = addDays(todayJst(), 5);
const MARK = "w1slot";
const PW = "Test1234";
let seq = 0;
let hash = "";

export async function setup() {
  hash = await bcrypt.hash(PW, 4);
  const f = await fixture({ doctors: 2 });
  const runId = (await prisma.batchRun.create({
    data: { jobCode: "B2", trigger: "MANUAL", clinicId: f.clinic.id, startedAt: new Date(), endedAt: new Date(), status: "SUCCESS", readCount: 0, writtenCount: 0, errorCount: 0 },
  })).id;
  const first = await prisma.visitType.create({
    data: { clinicId: f.clinic.id, departmentId: f.dept.id, code: "F", category: "FIRST", nameJa: "初診", durationFrames: 2, questionnaireRequired: true, displayOrder: 0, noticeJa: "保険証" },
  });
  const selfPay = await prisma.visitType.create({
    data: { clinicId: f.clinic.id, departmentId: f.dept.id, code: "S", category: "SELF_PAY", nameJa: "健診", durationFrames: 1, priceYen: 4000, questionnaireRequired: false, displayOrder: 2 },
  });
  /** frames of one doctor (15 min each) */
  async function frames(doctorIdx: number, starts: string[], o: { capacity?: number; status?: "OPEN" | "CLOSED"; date?: string; reserved?: number } = {}) {
    const out = [];
    for (const st of starts) {
      const [h, m] = st.split(":").map(Number);
      const end = `${String(h + Math.floor((m + 15) / 60)).padStart(2, "0")}:${String((m + 15) % 60).padStart(2, "0")}`;
      out.push(await prisma.slot.create({
        data: {
          clinicId: f.clinic.id, departmentId: f.dept.id, doctorId: f.doctors[doctorIdx].id, slotDate: dbDate(o.date ?? DAY), startTime: dbTime(st),
          endTime: dbTime(end), capacity: o.capacity ?? 1, reservedCount: o.reserved ?? 0, status: o.status ?? "OPEN",
          closedReason: o.status === "CLOSED" ? "DOCTOR_OFF" : null, generatedRunId: runId,
        },
      }));
    }
    return out;
  }
  return { f, first, selfPay, frames };
}
export type Setup = Awaited<ReturnType<typeof setup>>;

/** a patient account with its SELF patient and a live session */
export async function holder(o: { sex?: "MALE" | "FEMALE"; birth?: string } = {}) {
  const acc = await prisma.account.create({
    data: { email: `h${++seq}.${Date.now()}.${MARK}@example.jp`, passwordHash: hash, role: "PATIENT", status: "ACTIVE", notifyChannel: "MAIL" },
  });
  const self = await prisma.patient.create({
    data: {
      accountId: acc.id, relation: "SELF", nameType: "JP", familyName: "予約", givenName: `太郎${seq}`, familyNameKana: "ヨヤク", givenNameKana: "タロウ",
      birthDate: dbDate(o.birth ?? "1990-04-01"), sex: o.sex ?? "MALE", postcode: "1000001", prefecture: "東京都", city: "千代田区", addressLine: "1-1",
      phone: "0312345678", createdByKind: "PATIENT",
    },
  });
  const r = await login({ ip: "203.0.113.11", userAgent: "jest", email: acc.email, password: PW });
  if (!r.ok || !r.session) throw new Error("login");
  const s = await resolveSession(r.session.token);
  if (s.state !== "valid") throw new Error("session");
  return { acc, self, sid: r.session.token, ctx: s.ctx };
}
export type Holder = Awaited<ReturnType<typeof holder>>;

export const member = (h: Holder, given = `子${++seq}`, birth = "2015-06-01") =>
  prisma.patient.create({
    data: {
      accountId: h.acc.id, relation: "CHILD", nameType: "JP", familyName: "予約", givenName: given, familyNameKana: "ヨヤク", givenNameKana: "コ",
      birthDate: dbDate(birth), sex: "FEMALE", postcode: "1000001", prefecture: "東京都", city: "千代田区", addressLine: "1-1", createdByKind: "PATIENT",
    },
  });

const ORIGIN = "http://localhost:3001";
export function req(path: string, o: { body?: unknown; draft?: string | null; as?: Holder | null } = {}) {
  jar.sid = o.as ? o.as.sid : undefined;
  const headers: Record<string, string> = { origin: ORIGIN };
  if (o.draft) headers.cookie = `bdraft=${o.draft}`;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`${ORIGIN}${path}`, { method: o.body === undefined ? "GET" : "POST", headers, ...(o.body !== undefined && { body: JSON.stringify(o.body) }) });
}
export const draftOf = (res: Response) => (res as unknown as { cookies: { get(n: string): { value: string } | undefined } }).cookies.get("bdraft")?.value;

export async function cleanup(f: Fixture) {
  const ids = (await prisma.account.findMany({ where: { email: { contains: MARK } }, select: { id: true } })).map((a) => a.id);
  await f.cleanup();
  await prisma.notification.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.patient.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.session.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.account.deleteMany({ where: { id: { in: ids } } });
}
