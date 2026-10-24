// Shared by the P14 / P15 / P16 tests (slot w2): an own clinic (b2-helpers), frames inside the booking window, logged-in
// patient accounts with a SELF row (and family), bookings made through the core, the page interrupt of notFound().
import bcrypt from "bcrypt";
import { createBooking, newBookingNo, type Actor } from "@/lib/booking/core";
import { login } from "@/lib/auth/service";
import { addDays, dbDate, dbTime, todayJst } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { fixture, type Fixture } from "./b2-helpers";

export const MARK = "w2test";
export const IP = "203.0.113.92";
const PW = "Test1234";
let seq = 0;
let hash = "";

export type World = Fixture & { runId: string };

export async function world(): Promise<World> {
  hash ||= await bcrypt.hash(PW, 4);
  const f = await fixture({ doctors: 2 });
  const runId = (await prisma.batchRun.create({
    data: { jobCode: "B2", trigger: "MANUAL", clinicId: f.clinic.id, startedAt: new Date(), endedAt: new Date(), status: "SUCCESS", readCount: 0, writtenCount: 0, errorCount: 0 },
  })).id;
  return { ...f, runId };
}

const plus15 = (start: string) => {
  const [h, m] = start.split(":").map(Number);
  const t = h * 60 + m + 15;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

/** one frame (15 min) of doctor `doctorIdx` at date / start */
export function frame(w: World, date: string, start: string, doctorIdx = 0) {
  return prisma.slot.create({
    data: {
      clinicId: w.clinic.id, departmentId: w.dept.id, doctorId: w.doctors[doctorIdx].id, slotDate: dbDate(date),
      startTime: dbTime(start), endTime: dbTime(plus15(start)), capacity: 1, status: "OPEN", generatedRunId: w.runId,
    },
  });
}

const person = {
  nameType: "JP" as const, familyName: "山田", givenName: "花子", familyNameKana: "ヤマダ", givenNameKana: "ハナコ",
  birthDate: new Date("1985-05-05T00:00:00Z"), sex: "FEMALE" as const, postcode: "1000005", prefecture: "東京都", city: "千代田区",
  addressLine: "1-1", phone: "09012345678",
};

/** a patient account with its SELF row, logged in (session token for the cookie mock) */
export async function holder(o: { email?: string; notifyChannel?: "MAIL" | "SMS" | "LINE" } = {}) {
  hash ||= await bcrypt.hash(PW, 4);
  const acc = await prisma.account.create({
    data: { email: o.email ?? `h${++seq}.${Date.now()}.${MARK}@example.jp`, passwordHash: hash, role: "PATIENT", status: "ACTIVE", notifyChannel: o.notifyChannel ?? "MAIL" },
  });
  const self = await prisma.patient.create({ data: { ...person, accountId: acc.id, relation: "SELF", createdByKind: "PATIENT" } });
  const r = await login({ ip: IP, userAgent: "jest", email: acc.email, password: PW });
  if (!r.ok || !r.session) throw new Error("login");
  const actor: Actor = { kind: "PATIENT", accountId: acc.id, channel: "WEB" };
  return { acc, self, sid: r.session.token, actor };
}
export type Holder = Awaited<ReturnType<typeof holder>>;

export const familyMember = (h: Holder, given = `子${++seq}`) =>
  prisma.patient.create({ data: { ...person, givenName: given, phone: null, accountId: h.acc.id, relation: "CHILD", createdByKind: "PATIENT" } });

/** a booking of `patientId` through the core on a new frame (days from today, start) */
export async function book(w: World, h: Holder, patientId: string, days: number, start: string, o: { doctorRequested?: boolean; notes?: string | null; doctorIdx?: number } = {}) {
  const date = addDays(todayJst(), days);
  await frame(w, date, start, o.doctorIdx ?? 0);
  const r = await createBooking(
    {
      clinicId: w.clinic.id, departmentId: w.dept.id, visitTypeId: w.visitType.id, patientId,
      doctorId: o.doctorRequested === false ? null : w.doctors[o.doctorIdx ?? 0].id, doctorRequested: o.doctorRequested ?? true,
      slotDate: date, startTime: start, notes: o.notes ?? null,
    },
    h.actor, { overrideLimit: true },
  );
  if (!r.ok) throw new Error(`book: ${r.rule}`);
  return prisma.booking.findUniqueOrThrow({ where: { id: r.bookingId } });
}

/** a booking row written directly (past dates or statuses the core cannot make) */
export async function rawBooking(w: World, patientId: string, date: string, start: string, data: Record<string, unknown> = {}) {
  return prisma.booking.create({
    data: {
      bookingNo: await newBookingNo(prisma as never), clinicId: w.clinic.id, departmentId: w.dept.id, visitTypeId: w.visitType.id, doctorId: w.doctors[0].id,
      doctorRequested: true, patientId, channel: "WEB", slotDate: dbDate(date), startTime: dbTime(start),
      endTime: dbTime(plus15(start)), ...data,
    },
  });
}

/** the interrupt a page throws: "404" for notFound(), "401" for unauthorized(), "redirect" for redirect() */
export async function interrupt(fn: () => Promise<unknown>) {
  try {
    await fn();
    return "rendered";
  } catch (e) {
    const d = String((e as { digest?: string }).digest ?? "");
    if (d.startsWith("NEXT_HTTP_ERROR_FALLBACK")) return d.split(";")[1];
    if (d.startsWith("NEXT_REDIRECT")) return "redirect";
    throw e;
  }
}

/** after the fixture's cleanup (its clinic's bookings are gone): the w2 accounts and their rows */
export async function cleanupAccounts() {
  const ids = (await prisma.account.findMany({ where: { email: { contains: MARK } }, select: { id: true } })).map((a) => a.id);
  await prisma.notification.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.patient.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.session.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.account.deleteMany({ where: { id: { in: ids } } });
}
