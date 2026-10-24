// spec-screen: P11
// P11 events 2–7 (read only, anonymous allowed, OD-3): ?step=departments | types | doctors | calendar. The calendar
// answer covers the whole booking window (markers, free start times, holidays, notes), so month switch, date choice,
// 次の空き and the PI030 link need no further request. `change` (change mode) needs the session's own booking.
import type { NextRequest } from "next/server";
import { calendarOf, departmentsOf, doctorsOf, ownBooking, ownPerson, preselectOf, UUID, visitTypesOf } from "@/lib/entry/data";
import { entryRoute, json, notOwn, tampered } from "@/lib/entry/route";
import { resolveLanguage } from "@/lib/frame/data";
import { LANG_COOKIE } from "@/lib/i18n";

export function GET(req: NextRequest) {
  return entryRoute(req, { login: false }, async ({ session }) => {
    const p = req.nextUrl.searchParams;
    const lang = resolveLanguage(session, req.cookies.get(LANG_COOKIE)?.value);
    const id = (k: string) => p.get(k) ?? "";
    const ids = (...ks: string[]) => ks.every((k) => UUID.test(id(k)));
    const step = p.get("step");
    if (!ids("clinic")) return tampered();
    if (step === "departments") return json(200, { departments: await departmentsOf(id("clinic"), lang) });
    if (!ids("department")) return tampered();

    let changeBookingId: string | null = null;
    let onlyType: string | undefined;
    if (p.get("change")) {
      const b = session ? await ownBooking(id("change"), session.account.id) : null;
      if (!b) return notOwn();
      changeBookingId = b.id;
      onlyType = b.visitTypeId;
    }
    if (step === "types") {
      const types = await visitTypesOf(id("clinic"), id("department"), lang, onlyType);
      const patient = p.get("patient");
      // 抽出5: logged in only, for a person of the account (3-2: anonymous has no pre-selection)
      if (patient && !(session && (await ownPerson(session.account.id, patient)))) return notOwn();
      return json(200, { types, preselect: session && patient && !onlyType ? await preselectOf(patient, id("clinic"), types) : null });
    }
    if (!ids("visitType")) return tampered();
    const ctx = { clinicId: id("clinic"), departmentId: id("department"), visitTypeId: id("visitType"), changeBookingId, now: new Date() };
    if (step === "doctors") return json(200, { doctors: await doctorsOf(ctx, lang) });
    if (step === "calendar") {
      const doctor = p.get("doctor") || null;
      if (doctor && !UUID.test(doctor)) return tampered();
      return json(200, await calendarOf({ ...ctx, doctorId: doctor }, lang));
    }
    return tampered();
  });
}
