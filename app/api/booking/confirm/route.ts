// spec-screen: P13
// P13 event 2 (予約を確定する) / event 4 (PW002 はい, change mode): the booking core in one transaction with the draft id as
// the idempotency key (Q14 A: a double press or a retry after a timeout lands on P14 with the same booking); the
// consumed draft keeps the booking id, so a repeat after the commit is answered from it without touching the core.
// Failures: PE030 → P11 time step (T054), PE031 / PE032 / PE035 / PE033 / PE034 → P11 (T055), PE036 → P11 (T056),
// version / status changed → P16 PE045, deadline passed → P16 PE041 (T103, event 10).
import type { NextRequest } from "next/server";
import { setFlash } from "@/lib/auth/route";
import { changeBooking, createBooking, PATIENT_CODE, type Actor, type BookingInput } from "@/lib/booking/core";
import { dropDraft, getDraft, patchDraft } from "@/lib/booking/draft";
import { ownBooking } from "@/lib/entry/data";
import { EXPIRED } from "@/lib/entry/pages";
import { FORM_VERSION } from "@/lib/entry/questionnaire";
import { entryRoute, go, notOwn, withDraftCookie } from "@/lib/entry/route";
import { prisma } from "@/lib/prisma";

export function POST(req: NextRequest) {
  return entryRoute(req, { login: true }, async (v) => {
    const d = getDraft(v.draftId, v.owner);
    if (!d || d.kind !== "DRAFT") return go(EXPIRED, 410);
    if (d.bookingId) return go(`/bookings/${d.bookingId}/done`);
    const accountId = v.owner!.accountId;
    // 2-4 / 1-6: the draft's person (and the booking of change mode) must be the account's own → ER-01, nothing written
    if (!(await prisma.patient.count({ where: { id: d.sel.patientId!, accountId } }))) return notOwn();
    if (d.change && !(await ownBooking(d.change.bookingId, accountId))) return notOwn();
    const vt = await prisma.visitType.findUniqueOrThrow({ where: { id: d.sel.visitTypeId! }, select: { category: true } });
    const firstNew = !d.change && vt.category === "FIRST";
    if (firstNew && !d.questionnaire?.complete) return go("/booking/questionnaire", 409);

    const input: BookingInput = {
      clinicId: d.sel.clinicId!, departmentId: d.sel.departmentId!, visitTypeId: d.sel.visitTypeId!, patientId: d.sel.patientId!,
      doctorId: d.sel.doctorId, doctorRequested: !!d.sel.doctorId, slotDate: d.sel.date!, startTime: d.sel.start!,
      notes: d.sel.notes || null, // Q16 b A: empty notes stored as null
      questionnaire: firstNew ? { formVersion: FORM_VERSION, language: d.questionnaire!.language, answers: d.questionnaire!.answers } : null,
    };
    const actor: Actor = { kind: "PATIENT", accountId, channel: "WEB" };
    const opts = { idempotencyKey: d.id, bookedByAccountId: accountId };
    const r = d.change ? await changeBooking(d.change.bookingId, d.change.version, input, actor, opts) : await createBooking(input, actor, opts);

    if (r.ok) {
      patchDraft(d.id, { bookingId: r.bookingId }); // discarded for every other use; a reload of P13 → P14
      return go(`/bookings/${r.bookingId}/done`);
    }
    if (r.rule === "STALE" || r.rule === "NOT_RESERVED" || r.rule === "DEADLINE") {
      dropDraft(d.id); // 10-1: rollback, the draft discarded
      return withDraftCookie(setFlash(go(`/bookings/${d.change!.bookingId}`, 409), r.rule === "DEADLINE" ? "PE041" : "PE045"), null);
    }
    const back = d.change ? `/bookings/${d.change.bookingId}/change` : "/booking/new";
    return go(`${back}?resume=1&e=${PATIENT_CODE[r.rule]}`, 409);
  });
}
