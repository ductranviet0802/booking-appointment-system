// Booking policy of a clinic (03 §3.12, A04) and the web change / cancel deadline (F5-03).
import type { BookingPolicy, Prisma } from "@prisma/client";
import { addDays, jstInstant, toHhmm } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

/** the clinic's row; a clinic without one uses the 03 defaults (A04 has not saved yet) */
export async function policyOf(clinicId: string, db: Db = prisma): Promise<Policy> {
  const row = await db.bookingPolicy.findUnique({ where: { clinicId } });
  return row ? fromRow(row) : { ...DEFAULT_POLICY };
}

export type Policy = {
  frameMinutes: number;
  frameCapacity: number;
  bookingWindowDays: number;
  sameDayCutoffMinutes: number;
  cancelDeadlineType: "PREV_DAY_TIME" | "HOURS_BEFORE";
  /** "HH:MM", PREV_DAY_TIME */
  cancelDeadlineTime: string | null;
  /** HOURS_BEFORE */
  cancelDeadlineHours: number | null;
  perPersonDailyLimit: number;
};

export const DEFAULT_POLICY: Policy = {
  frameMinutes: 15, frameCapacity: 1, bookingWindowDays: 30, sameDayCutoffMinutes: 30,
  cancelDeadlineType: "PREV_DAY_TIME", cancelDeadlineTime: "23:59", cancelDeadlineHours: null, perPersonDailyLimit: 1,
};

function fromRow(r: BookingPolicy): Policy {
  return {
    frameMinutes: r.frameMinutes, frameCapacity: r.frameCapacity, bookingWindowDays: r.bookingWindowDays,
    sameDayCutoffMinutes: r.sameDayCutoffMinutes,
    cancelDeadlineType: r.cancelDeadlineType === "HOURS_BEFORE" ? "HOURS_BEFORE" : "PREV_DAY_TIME",
    cancelDeadlineTime: r.cancelDeadlineTime ? toHhmm(r.cancelDeadlineTime) : null,
    cancelDeadlineHours: r.cancelDeadlineHours, perPersonDailyLimit: r.perPersonDailyLimit,
  };
}

/** the minute shown as the deadline (PI056 「…まで」): PREV_DAY_TIME the day before at the time, HOURS_BEFORE start − hours */
export function deadlineOf(p: Policy, slotDate: string, startHhmm: string): Date {
  if (p.cancelDeadlineType === "HOURS_BEFORE") return new Date(jstInstant(slotDate, startHhmm).getTime() - (p.cancelDeadlineHours ?? 0) * 3_600_000);
  return jstInstant(addDays(slotDate, -1), p.cancelDeadlineTime ?? "23:59");
}

/** F5-03: inside while now < the shown minute + 1 minute (「23:59まで」 holds until 23:59:59) */
export const beforeDeadline = (p: Policy, slotDate: string, startHhmm: string, now = new Date()) =>
  now.getTime() < deadlineOf(p, slotDate, startHhmm).getTime() + 60_000;
