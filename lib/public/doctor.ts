// spec-screen: P09
// Data of the doctor profile (抽出1–4) and the way back to P08, assembled for the page.
import { prisma } from "@/lib/prisma";
import { addDays, dbDate, todayJst, toHhmm } from "@/lib/datetime";
import type { Lang } from "@/lib/i18n";
import { formatTimeRange } from "@/lib/i18n/format";
import { label } from "@/lib/i18n/labels";
import { doctorName, languageName, nameOf, pick, titleLabel, type DoctorTitleCode } from "./text";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** item 13 (Q10 / Q14 = A): `from` holds the P08 query string; only P08's own parameters are passed back, in this order; none → `/doctors` */
export function backHref(from: string | string[] | undefined) {
  if (typeof from !== "string") return "/doctors";
  const src = new URLSearchParams(from);
  const out = new URLSearchParams();
  for (const k of ["keyword", "clinic", "department", "language", "page"]) {
    const v = src.get(k);
    if (v !== null) out.set(k, v);
  }
  return out.size ? `/doctors?${out.toString()}` : "/doctors";
}

/** 抽出4: the clinic × department pairs with an OPEN slot that still has room, from today to today + booking_window_days, same-day cut-off applied (F4-05) */
export async function bookablePairs(doctorId: string, now: Date) {
  const today = todayJst(now);
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  const nowMin = jst.getUTCHours() * 60 + jst.getUTCMinutes();
  const clinics = await prisma.clinic.findMany({
    where: { isActive: true },
    include: { bookingPolicy: true },
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
  });
  const policy = new Map(clinics.map((c) => [c.id, c.bookingPolicy]));
  const maxWindow = Math.max(0, ...clinics.map((c) => c.bookingPolicy?.bookingWindowDays ?? 0));
  const slots = await prisma.slot.findMany({
    where: {
      doctorId, status: "OPEN", clinic: { isActive: true }, department: { isActive: true },
      slotDate: { gte: dbDate(today), lte: dbDate(addDays(today, maxWindow)) },
    },
    include: { clinic: true, department: true },
  });
  const seen = new Map<string, (typeof slots)[number]>();
  for (const s of slots) {
    const p = policy.get(s.clinicId);
    if (!p || s.reservedCount >= s.capacity) continue;
    const date = s.slotDate.toISOString().slice(0, 10);
    if (date > addDays(today, p.bookingWindowDays)) continue;
    const [h, m] = toHhmm(s.startTime).split(":").map(Number);
    if (date === today && h * 60 + m <= nowMin + p.sameDayCutoffMinutes) continue;
    seen.set(`${s.clinicId}/${s.departmentId}`, s);
  }
  return [...seen.values()].sort(
    (a, b) => a.clinic.displayOrder - b.clinic.displayOrder || (a.clinic.code < b.clinic.code ? -1 : 1) || a.department.displayOrder - b.department.displayOrder || (a.department.code < b.department.code ? -1 : 1),
  );
}

type Cell = string[]; // one range per line, by start_time
export type ScheduleBlock = { clinicCode: string; clinicName: string; sunday: boolean; cell: (weekday: number, band: "AM" | "PM") => Cell };

/** null → ER-01 (malformed, unknown or inactive id) */
export async function loadDoctorPage(id: string, lang: Lang, now = new Date()) {
  if (!UUID.test(id)) return null;
  const doctor = await prisma.doctor.findUnique({ where: { id }, include: { departments: { include: { department: true } } } });
  if (!doctor?.isActive) return null;
  const today = dbDate(todayJst(now));
  const [pairs, patterns] = await Promise.all([
    bookablePairs(id, now),
    prisma.doctorShiftPattern.findMany({
      where: { doctorId: id, clinic: { isActive: true }, validFrom: { lte: today }, OR: [{ validTo: null }, { validTo: { gte: today } }] },
      include: { clinic: true },
      orderBy: [{ startTime: "asc" }],
    }),
  ]);
  const byClinic = new Map<string, typeof patterns>();
  for (const p of patterns) byClinic.set(p.clinicId, [...(byClinic.get(p.clinicId) ?? []), p]);
  const schedule: ScheduleBlock[] = [...byClinic.values()]
    .sort((a, b) => a[0].clinic.displayOrder - b[0].clinic.displayOrder || (a[0].clinic.code < b[0].clinic.code ? -1 : 1))
    .map((rows) => ({
      clinicCode: rows[0].clinic.code,
      clinicName: nameOf(rows[0].clinic, lang),
      sunday: rows.some((r) => r.weekday === 0),
      cell: (weekday, band) =>
        rows.filter((r) => r.weekday === weekday && r.band === band).map((r) => formatTimeRange(toHhmm(r.startTime), toHhmm(r.endTime), lang)),
    }));
  const qualifications = pick(lang, doctor.qualificationsJa ?? "", doctor.qualificationsEn, doctor.qualificationsVi).trim();
  return {
    id: doctor.id,
    name: doctorName(doctor, lang),
    kana: lang === "ja" ? `${doctor.familyNameKana} ${doctor.givenNameKana}` : null,
    title: titleLabel(doctor.title as DoctorTitleCode, lang),
    photoUrl: doctor.photoUrl,
    departments: doctor.departments
      .map((d) => d.department)
      .filter((d) => d.isActive)
      .sort((a, b) => a.displayOrder - b.displayOrder || (a.code < b.code ? -1 : 1))
      .map((d) => nameOf(d, lang)),
    languages: doctor.languages.map(languageName).join("・"),
    buttons: pairs.map((s) => ({
      text: label("bookPair", lang, { clinic: nameOf(s.clinic, lang), department: nameOf(s.department, lang) }),
      href: `/booking/new?${new URLSearchParams({ clinic: s.clinic.code, department: s.department.code, doctor: doctor.id }).toString()}`,
    })),
    // state ①: no pair → no schedule either
    schedule: pairs.length ? schedule : [],
    profile: pick(lang, doctor.profileJa, doctor.profileEn, doctor.profileVi),
    qualifications: qualifications ? qualifications.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [],
  };
}
