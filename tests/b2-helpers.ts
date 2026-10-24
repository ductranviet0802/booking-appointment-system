// Shared by the B2 / B3 / A01 / A02 tests: a clinic of the test's own (code `${tag}`) with a department, hours Mon–Fri
// 09:00–12:00 / 15:00–18:00, a booking policy, doctors and a patient, and the cleanup that removes all of it. Dates are in 2030
// so no other suite's rows are touched. The seeded clinics are never run through B2 here.
import type { Band } from "@prisma/client";
import { dbDate, dbTime } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";

let seq = 0;
export const MON = "2030-03-04"; // a Monday

export async function fixture(opts: { doctors?: number } = {}) {
  const tag = `b2t${Date.now().toString(36).slice(-6)}${++seq}`;
  const admin = await prisma.account.create({
    data: { email: `${tag}.admin.w1test@example.jp`, passwordHash: "x", role: "ADMIN", status: "ACTIVE", displayName: "試験" },
  });
  const clinic = await prisma.clinic.create({
    data: {
      code: tag, nameJa: `試験クリニック${tag}`, nameKana: "シケン", postcode: "1000001", prefecture: "東京都", city: "千代田区", addressLine: "1-1",
      phone: "0300000000", accessJa: "駅前", displayOrder: 90 + seq,
    },
  });
  await prisma.clinicBusinessHour.createMany({
    data: [1, 2, 3, 4, 5].flatMap((weekday) => [
      { clinicId: clinic.id, weekday, band: "AM" as Band, openTime: dbTime("09:00"), closeTime: dbTime("12:00"), receptionEndTime: dbTime("11:30") },
      { clinicId: clinic.id, weekday, band: "PM" as Band, openTime: dbTime("15:00"), closeTime: dbTime("18:00"), receptionEndTime: dbTime("17:30") },
    ]),
  });
  await prisma.bookingPolicy.create({ data: { clinicId: clinic.id, updatedBy: admin.id, phoneMessageJa: "電話で" } });
  const dept = await prisma.department.create({ data: { code: tag, nameJa: "試験科", nameKana: "シケンカ", displayOrder: 90 + seq } });
  await prisma.clinicDepartment.create({ data: { clinicId: clinic.id, departmentId: dept.id, displayOrder: 1 } });
  const doctors = [];
  for (let i = 0; i < (opts.doctors ?? 2); i++) {
    const d = await prisma.doctor.create({
      data: {
        code: `${tag}d${i}`, familyName: `医${i}`, givenName: "試験", familyNameKana: "イ", givenNameKana: "シケン", nameRomaji: "I Shiken", title: "DOCTOR",
        profileJa: "x", primaryClinicId: clinic.id, displayOrder: 90 + i,
      },
    });
    await prisma.doctorDepartment.create({ data: { doctorId: d.id, departmentId: dept.id } });
    doctors.push(d);
  }
  const visitType = await prisma.visitType.create({
    data: { clinicId: clinic.id, departmentId: dept.id, code: "T", category: "REPEAT", nameJa: "再診", durationFrames: 1, questionnaireRequired: false, displayOrder: 1 },
  });
  const account = await prisma.account.create({
    data: { email: `${tag}.patient.w1test@example.jp`, passwordHash: "x", role: "PATIENT", status: "ACTIVE", language: "JA", notifyChannel: "MAIL" },
  });
  const patient = await prisma.patient.create({
    data: {
      accountId: account.id, relation: "SELF", nameType: "JP", familyName: "試験", givenName: "患者", familyNameKana: "シケン", givenNameKana: "カンジャ",
      birthDate: dbDate("1990-01-01"), sex: "MALE", postcode: "1000001", prefecture: "東京都", city: "千代田区", addressLine: "1-1", createdByKind: "PATIENT",
      phone: "09000000000",
    },
  });

  const pattern = (doctorId: string, weekday: number, band: Band, o: { start?: string; end?: string; from?: string; to?: string | null } = {}) =>
    prisma.doctorShiftPattern.create({
      data: {
        doctorId, clinicId: clinic.id, departmentId: dept.id, weekday, band,
        startTime: dbTime(o.start ?? (band === "AM" ? "09:00" : "15:00")), endTime: dbTime(o.end ?? (band === "AM" ? "12:00" : "18:00")),
        validFrom: dbDate(o.from ?? "2030-01-01"), validTo: o.to ? dbDate(o.to) : null,
      },
    });
  const weekPatterns = async (doctorId: string, bands: Band[] = ["AM", "PM"], from?: string) => {
    for (const wd of [1, 2, 3, 4, 5]) for (const b of bands) await pattern(doctorId, wd, b, { from });
  };
  const frames = (where: Record<string, unknown> = {}) =>
    prisma.slot.findMany({ where: { clinicId: clinic.id, ...where }, orderBy: [{ slotDate: "asc" }, { startTime: "asc" }] });
  /** a booking on the frames `slotIds` (one booking = one or more frames of one doctor) */
  async function book(slotIds: string[], doctorId: string, no: string) {
    const first = await prisma.slot.findUniqueOrThrow({ where: { id: slotIds[0] } });
    const b = await prisma.booking.create({
      data: {
        bookingNo: no, clinicId: clinic.id, departmentId: dept.id, visitTypeId: visitType.id, doctorId, doctorRequested: true, patientId: patient.id,
        channel: "WEB", slotDate: first.slotDate, startTime: first.startTime, endTime: first.endTime,
      },
    });
    await prisma.bookingSlot.createMany({ data: slotIds.map((slotId) => ({ bookingId: b.id, slotId })) });
    await prisma.slot.updateMany({ where: { id: { in: slotIds } }, data: { reservedCount: { increment: 1 } } });
    return b;
  }
  const exception = (data: { doctorId: string; date: string; kind: "OFF" | "EXTRA" | "SUBSTITUTE"; band?: Band | null; start?: string; end?: string; substituteDoctorId?: string }) =>
    prisma.doctorShiftException.create({
      data: {
        doctorId: data.doctorId, shiftDate: dbDate(data.date), kind: data.kind, band: data.band ?? null,
        clinicId: data.kind === "OFF" ? null : clinic.id, departmentId: data.kind === "OFF" ? null : dept.id,
        startTime: data.start ? dbTime(data.start) : null, endTime: data.end ? dbTime(data.end) : null,
        substituteDoctorId: data.substituteDoctorId ?? null, createdBy: admin.id,
      },
    });
  const calendar = (date: string, kind: "CLOSED" | "AM_CLOSED" | "PM_CLOSED" | "SPECIAL_OPEN", o: { am?: [string, string]; pm?: [string, string] } = {}) =>
    prisma.clinicCalendarDay.create({
      data: {
        clinicId: clinic.id, calDate: dbDate(date), kind, createdBy: admin.id,
        amOpen: o.am ? dbTime(o.am[0]) : null, amClose: o.am ? dbTime(o.am[1]) : null, pmOpen: o.pm ? dbTime(o.pm[0]) : null, pmClose: o.pm ? dbTime(o.pm[1]) : null,
      },
    });
  const holiday = async (date: string, name = "試験の日") => {
    const run = await prisma.batchRun.create({
      data: { jobCode: "B6", trigger: "MANUAL", startedAt: new Date(), endedAt: new Date(), status: "SUCCESS", readCount: 0, writtenCount: 0, errorCount: 0, message: tag },
    });
    return prisma.holiday.create({ data: { holidayDate: dbDate(date), nameJa: name, lastRunId: run.id } });
  };

  async function cleanup() {
    const bookings = (await prisma.booking.findMany({ where: { clinicId: clinic.id }, select: { id: true } })).map((b) => b.id);
    await prisma.notification.deleteMany({ where: { bookingId: { in: bookings } } });
    await prisma.booking.deleteMany({ where: { clinicId: clinic.id } });
    await prisma.slot.deleteMany({ where: { clinicId: clinic.id } });
    await prisma.holiday.deleteMany({ where: { lastRun: { message: tag } } });
    await prisma.batchRun.deleteMany({ where: { OR: [{ clinicId: clinic.id }, { message: tag }] } });
    await prisma.doctorShiftException.deleteMany({ where: { doctor: { primaryClinicId: clinic.id } } });
    await prisma.doctorShiftPattern.deleteMany({ where: { clinicId: clinic.id } });
    await prisma.clinicCalendarDay.deleteMany({ where: { clinicId: clinic.id } });
    await prisma.clinicBusinessHour.deleteMany({ where: { clinicId: clinic.id } });
    await prisma.visitType.deleteMany({ where: { clinicId: clinic.id } });
    await prisma.patient.deleteMany({ where: { accountId: account.id } });
    await prisma.auditLog.deleteMany({ where: { clinicId: clinic.id } });
    await prisma.session.deleteMany({ where: { clinicId: clinic.id } });
    await prisma.staffClinic.deleteMany({ where: { clinicId: clinic.id } });
    await prisma.doctor.deleteMany({ where: { primaryClinicId: clinic.id } });
    await prisma.clinicDepartment.deleteMany({ where: { clinicId: clinic.id } });
    await prisma.bookingPolicy.deleteMany({ where: { clinicId: clinic.id } });
    await prisma.department.delete({ where: { id: dept.id } });
    await prisma.clinic.delete({ where: { id: clinic.id } });
    await prisma.account.deleteMany({ where: { id: { in: [admin.id, account.id] } } });
  }
  return { tag, admin, clinic, dept, doctors, patient, visitType, pattern, weekPatterns, frames, book, exception, calendar, holiday, cleanup };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;
