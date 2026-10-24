// Reads of the clinic masters for P01 and P10 (all server-side; nothing is written).
import { prisma } from "@/lib/prisma";
import { dbDate, toHhmm, toIsoDate, weekdayOf } from "@/lib/datetime";
import { openBandsOfDay, type CalendarRow, type HourRow, type OpenBand } from "./hours";
import { closureRange, type ClosureCalendar, type ClosureHoliday } from "./closures";

const hhmm = (d: Date | null) => (d ? toHhmm(d) : null);

/** P10 抽出2 / P01 抽出1: active clinics in display order (tie: code, P01 Q14 / P10 Q10) */
export function activeClinics() {
  return prisma.clinic.findMany({ where: { isActive: true }, orderBy: [{ displayOrder: "asc" }, { code: "asc" }] });
}

/** demo add-on: map, not in ver1 spec — the pin of a clinic, null without coordinates (no map, the map link stays) */
export const pinOf = (c: { latitude: number | null; longitude: number | null }) =>
  c.latitude != null && c.longitude != null ? { lat: c.latitude, lng: c.longitude } : null;

/** P10 抽出1; null for an unknown, inactive or malformed code (event 1-4) */
export async function activeClinicByCode(code: string) {
  if (!/^[a-z0-9-]+$/.test(code)) return null;
  const clinic = await prisma.clinic.findUnique({ where: { code } });
  return clinic?.isActive ? clinic : null;
}

export async function hourRowsOf(clinicIds: string[]): Promise<Map<string, HourRow[]>> {
  const rows = await prisma.clinicBusinessHour.findMany({ where: { clinicId: { in: clinicIds } } });
  const byClinic = new Map<string, HourRow[]>(clinicIds.map((id) => [id, []]));
  for (const r of rows) {
    byClinic.get(r.clinicId)?.push({
      weekday: r.weekday, band: r.band, open: toHhmm(r.openTime), close: toHhmm(r.closeTime), reception: hhmm(r.receptionEndTime),
    });
  }
  return byClinic;
}

const calendarOf = (r: { calDate: Date; kind: ClosureCalendar["kind"]; amOpen: Date | null; amClose: Date | null; pmOpen: Date | null; pmClose: Date | null; noteJa: string | null; noteEn: string | null; noteVi: string | null }): ClosureCalendar => ({
  date: toIsoDate(r.calDate), kind: r.kind, amOpen: hhmm(r.amOpen), amClose: hhmm(r.amClose), pmOpen: hhmm(r.pmOpen), pmClose: hhmm(r.pmClose),
  noteJa: r.noteJa, noteEn: r.noteEn, noteVi: r.noteVi,
});

/** P01 抽出2 / P10 8-4, 8-5: the open bands today of each clinic ([] = 本日は休診日です) */
export async function todayBands(clinicIds: string[], today: string): Promise<Map<string, OpenBand[]>> {
  const [hours, cal, holiday] = await Promise.all([
    hourRowsOf(clinicIds),
    prisma.clinicCalendarDay.findMany({ where: { clinicId: { in: clinicIds }, calDate: dbDate(today) } }),
    prisma.holiday.findFirst({ where: { holidayDate: dbDate(today), isActive: true } }),
  ]);
  return new Map(
    clinicIds.map((id) => {
      const row = cal.find((c) => c.clinicId === id);
      const calendar: CalendarRow | null = row ? { kind: row.kind, amOpen: hhmm(row.amOpen), amClose: hhmm(row.amClose), pmOpen: hhmm(row.pmOpen), pmClose: hhmm(row.pmClose) } : null;
      return [id, openBandsOfDay({ weekday: weekdayOf(today), hours: hours.get(id) ?? [], calendar, isHoliday: !!holiday })];
    }),
  );
}

/** P10 抽出4: calendar rows and active holidays from today to the same day two months later */
export async function closureSources(clinicId: string, today: string): Promise<{ calendar: ClosureCalendar[]; holidays: ClosureHoliday[] }> {
  const { from, to } = closureRange(today);
  const [calendar, holidays] = await Promise.all([
    prisma.clinicCalendarDay.findMany({ where: { clinicId, calDate: { gte: dbDate(from), lte: dbDate(to) } } }),
    prisma.holiday.findMany({ where: { holidayDate: { gte: dbDate(from), lte: dbDate(to) }, isActive: true } }),
  ]);
  return {
    calendar: calendar.map(calendarOf),
    holidays: holidays.map((h) => ({ date: toIsoDate(h.holidayDate), nameJa: h.nameJa, nameEn: h.nameEn, nameVi: h.nameVi })),
  };
}

/** P10 抽出5 / P01 抽出1: the active departments of clinics, by clinic_departments.display_order (Q9 / Q10 c) */
export async function departmentsByClinic(clinicIds: string[]) {
  const rows = await prisma.clinicDepartment.findMany({
    where: { clinicId: { in: clinicIds }, department: { isActive: true } },
    include: { department: true },
    orderBy: [{ displayOrder: "asc" }, { department: { code: "asc" } }],
  });
  const byClinic = new Map(clinicIds.map((id) => [id, [] as Array<(typeof rows)[number]["department"]>]));
  for (const r of rows) byClinic.get(r.clinicId)?.push(r.department);
  return byClinic;
}

/** P10 抽出6: active doctors with a shift pattern of the clinic valid today, in doctors.display_order (tie: code) */
export async function clinicDoctors(clinicId: string, today: string) {
  const day = dbDate(today);
  return prisma.doctor.findMany({
    where: {
      isActive: true,
      shiftPatterns: { some: { clinicId, validFrom: { lte: day }, OR: [{ validTo: null }, { validTo: { gte: day } }] } },
    },
    include: { departments: { include: { department: true } } },
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
  });
}
