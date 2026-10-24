// Demo seed texts: no mock placeholder ○○, and every patient-facing text that has a ja value has en and vi too.
import { prisma, pool } from "@/lib/prisma";

afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

type Row = Record<string, unknown>;
const missing = (rows: Row[], key: string, bases: string[]) =>
  rows.flatMap((r) => bases.filter((b) => r[`${b}Ja`] && (!r[`${b}En`] || !r[`${b}Vi`])).map((b) => `${r[key]}.${b}`));

it("seed: no ○○ and ja / en / vi on every text", async () => {
  const clinics = await prisma.clinic.findMany();
  const settings = await prisma.systemSetting.findMany({ where: { key: { startsWith: "group_name" } } });
  expect(JSON.stringify([clinics, settings])).not.toContain("○○");
  expect(clinics.every((c) => c.addressEn)).toBe(true);
  expect(missing(clinics, "code", ["name", "access", "notice"])).toEqual([]);
  expect(missing(await prisma.doctor.findMany(), "code", ["profile", "qualifications"])).toEqual([]);
  expect(missing(await prisma.clinicCalendarDay.findMany(), "calDate", ["note"])).toEqual([]);
  expect(missing(await prisma.visitType.findMany(), "code", ["name", "notice"])).toEqual([]);
  expect(missing(await prisma.department.findMany(), "code", ["name"])).toEqual([]);
  expect(settings.map((s) => s.value).sort()).toEqual(["Pháp nhân Y tế Seiwa", "Seiwa Medical Corporation", "医療法人社団 誠和会"]);
});
