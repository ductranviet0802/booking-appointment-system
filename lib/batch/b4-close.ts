// B4 夜間締め (06 §B4, F8-03): RESERVED bookings of the previous day without a flag become no-show candidates
// (no_show_candidate_at = now, booking_events NO_SHOW_CANDIDATE); the status stays RESERVED for S01 to decide.
// One transaction per clinic, every booking locked lockPerson → lockBooking (lib/booking/core) and re-checked under the
// lock, so a check-in on S01 at the same moment wins or loses cleanly. Re-run: only rows with a null flag are touched.
import type { Prisma } from "@prisma/client";
import { lockBooking, lockPerson } from "@/lib/booking/core";
import { addDays, dbDate, todayJst, toIsoDate } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import type { Job, JobResult } from "@/lib/batch/runner";

type Tx = Prisma.TransactionClient;

// cap: B4 per-clinic volume per run (質疑 pending) — over it the clinic is refused whole (no partial flagging, 06 B4 Failure)
export const B4_MAX_PER_CLINIC = 5_000;

const candidatesWhere = (clinicId: string, date: string) =>
  ({ clinicId, slotDate: dbDate(date), status: "RESERVED", noShowCandidateAt: null }) satisfies Prisma.BookingWhereInput;

/** flags the candidates of one clinic inside `tx`; returns the number flagged */
export async function closeClinic(tx: Tx, clinicId: string, date: string, now: Date): Promise<number> {
  // patients in id order: the same order S03 uses for two patients, so two multi-person writers cannot deadlock
  const rows = await tx.booking.findMany({ where: candidatesWhere(clinicId, date), select: { id: true, patientId: true }, orderBy: [{ patientId: "asc" }, { id: "asc" }] });
  if (rows.length > B4_MAX_PER_CLINIC) throw new Error(`${rows.length} candidates over the cap ${B4_MAX_PER_CLINIC}`);
  let flagged = 0;
  for (const b of rows) {
    try {
      await lockPerson(tx, b.patientId);
    } catch {
      continue; // merged or anonymised meanwhile: its bookings are not this job's to flag
    }
    await lockBooking(tx, b.id);
    const set = await tx.booking.updateMany({ where: { id: b.id, status: "RESERVED", noShowCandidateAt: null }, data: { noShowCandidateAt: now } });
    if (set.count !== 1) continue; // checked in / cancelled / flagged by another run while we waited
    await tx.bookingEvent.create({ data: { bookingId: b.id, event: "NO_SHOW_CANDIDATE", actorKind: "SYSTEM", after: { noShowCandidateAt: now.toISOString() }, at: now } });
    flagged++;
  }
  return flagged;
}

/** params: `date` (ISO, a past day; default yesterday JST) — the operator's run for a given past date (06 B4 Rerun) */
export const b4Job: Job = async (ctx) => {
  const now = new Date();
  const today = todayJst(now);
  const date = ctx.params.date === undefined ? addDays(today, -1) : String(ctx.params.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || toIsoDate(dbDate(date)) !== date || date >= today) throw new Error(`bad parameter date: ${date} (a past day)`);

  const clinics = await prisma.clinic.findMany({ where: ctx.clinicId ? { id: ctx.clinicId } : {}, orderBy: { displayOrder: "asc" }, select: { id: true, code: true } });
  let read = 0;
  let written = 0;
  const per: string[] = [];
  const failed: string[] = [];
  for (const c of clinics) {
    try {
      const found = await prisma.booking.count({ where: candidatesWhere(c.id, date) });
      read += found;
      if (found === 0) continue;
      const n = ctx.dryRun ? found : await prisma.$transaction((tx) => closeClinic(tx, c.id, date, now), { timeout: 120_000, maxWait: 20_000 });
      written += ctx.dryRun ? 0 : n;
      per.push(`${c.code} ${n}`);
    } catch (e) {
      failed.push(`${c.code}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const message = `${date} 候補${ctx.dryRun ? "（試行）" : ""} ${per.join("・") || "0"}${failed.length ? `／失敗 ${failed.join("; ")}` : ""}`.slice(0, 500);
  const status: JobResult["status"] = failed.length ? "FAILED" : "SUCCESS";
  return { status, read, written, errors: failed.length, message };
};
