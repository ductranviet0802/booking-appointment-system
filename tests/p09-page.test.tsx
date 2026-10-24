// spec-screen: P09 — ER-01, buttons from OPEN slots in the booking window, schedule from patterns valid today, back link, ja / en / vi.
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("@/lib/auth/context", () => ({ guardScreen: jest.fn(async () => null) }));
jest.mock("@/lib/frame/data", () => ({ getLanguage: jest.fn(async () => "ja") }));
jest.mock("next/link", () => ({ __esModule: true, default: (p: { href: string; children: React.ReactNode; className?: string }) => <a href={p.href} className={p.className}>{p.children}</a> }));

import { guardScreen } from "@/lib/auth/context";
import { prisma, pool } from "@/lib/prisma";
import { addDays, dbDate, dbTime, todayJst } from "@/lib/datetime";
import DoctorPage from "@/app/(patient)/doctors/[doctorId]/page";
import { DoctorDetail } from "@/components/public/DoctorDetail";
import { backHref, bookablePairs, loadDoctorPage } from "@/lib/public/doctor";

jest.setTimeout(60_000);
afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

async function outcome(fn: () => Promise<unknown>) {
  try {
    await fn();
    return "ok";
  } catch (e) {
    const d = (e as { digest?: string }).digest ?? "";
    if (d.startsWith("NEXT_HTTP_ERROR_FALLBACK")) return `http:${d.split(";")[1]}`;
    throw e;
  }
}
const page = (doctorId: string, from?: string) => DoctorPage({ params: Promise.resolve({ doctorId }), searchParams: Promise.resolve({ from }) });

describe("ER-01", () => {
  it.each(["abc", "123", "D001", "3f2b8d3e-0000-4000-8000-00000000000", "3f2b8d3e-0000-4000-8000-000000000000"])("%p → ER-01", async (id) => {
    expect(await outcome(() => page(id))).toBe("http:404");
  });
  it("an inactive doctor → ER-01; an active one opens, the guard runs first", async () => {
    const d = await prisma.doctor.findUniqueOrThrow({ where: { code: "D002" } });
    await prisma.doctor.update({ where: { id: d.id }, data: { isActive: false } });
    try {
      expect(await outcome(() => page(d.id))).toBe("http:404");
    } finally {
      await prisma.doctor.update({ where: { id: d.id }, data: { isActive: true } });
    }
    expect(await outcome(() => page(d.id))).toBe("ok");
    expect(guardScreen).toHaveBeenCalledWith("P09");
  });
});

describe("back link (item 13)", () => {
  it("keeps only P08's own parameters, in order; none → /doctors", () => {
    expect(backHref("keyword=%E7%94%B0%E4%B8%AD&page=2")).toBe("/doctors?keyword=%E7%94%B0%E4%B8%AD&page=2");
    expect(backHref("page=2&evil=1&clinic=honin&keyword=a")).toBe("/doctors?keyword=a&clinic=honin&page=2");
    expect(backHref("evil=1")).toBe("/doctors");
    expect(backHref("")).toBe("/doctors");
    expect(backHref(undefined)).toBe("/doctors");
    expect(backHref(["a", "b"])).toBe("/doctors");
  });
});

describe("seeded doctor", () => {
  it("D001: buttons carry clinic / department / doctor, schedule per clinic, profile, PI033", async () => {
    const d = await prisma.doctor.findUniqueOrThrow({ where: { code: "D001" } });
    const data = await loadDoctorPage(d.id, "ja");
    expect(data).not.toBeNull();
    expect(data!.buttons[0]).toEqual({
      text: "たなか内科クリニック 本院 内科で予約",
      href: `/booking/new?clinic=honin&department=naika&doctor=${d.id}`,
    });
    expect(data!.schedule.map((b) => b.clinicCode)).toEqual(["honin"]);
    expect(data!.schedule[0].cell(1, "AM")).toEqual(["9:00〜12:00"]);
    expect(data!.schedule[0].cell(3, "AM")).toEqual([]);
    expect(data!.schedule[0].sunday).toBe(false);
    const html = renderToStaticMarkup(<DoctorDetail data={data!} backHref="/doctors?page=2" lang="ja" />);
    expect(html).toContain("田中 誠");
    expect(html).toContain("タナカ マコト");
    expect(html).toContain("院長");
    expect(html).toContain("日本語・English");
    expect(html).toContain("診療スケジュール");
    expect(html).toContain("休診日・代診により変わることがあります");
    expect(html).toContain("保険診療の自己負担額は、診療内容と保険の種類により異なります。");
    expect(html).toContain('href="/doctors?page=2"');
    expect(html).toContain('href="/clinics/honin"');
    expect(html).toContain("資格・所属学会");
    expect(html).toContain("<li>日本内科学会 総合内科専門医</li>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("p09-unavailable");
  });

  it("state ①: no OPEN slot in the window → PI036, no buttons, no schedule; profile and PI033 stay", async () => {
    const d = await prisma.doctor.findUniqueOrThrow({ where: { code: "D003" } });
    const open = await prisma.slot.findMany({ where: { doctorId: d.id, status: "OPEN" }, select: { id: true } });
    await prisma.slot.updateMany({ where: { doctorId: d.id }, data: { status: "CLOSED" } });
    try {
      const data = await loadDoctorPage(d.id, "ja");
      expect(data!.buttons).toEqual([]);
      expect(data!.schedule).toEqual([]);
      const html = renderToStaticMarkup(<DoctorDetail data={data!} backHref="/doctors" lang="ja" />);
      expect(html).toContain("現在、この医師のWeb予約可能な日はありません。");
      expect(html).toContain("保険診療の自己負担額");
      expect(html).toContain("佐藤 健一");
      expect(html).not.toContain("診療スケジュール");
      expect(html).not.toContain("で予約</a>");
    } finally {
      await prisma.slot.updateMany({ where: { id: { in: open.map((s) => s.id) } }, data: { status: "OPEN" } });
    }
  });

  it("en: romaji name without kana, English texts; vi: Vietnamese, empty vi master falls back to ja (state ②)", async () => {
    const d = await prisma.doctor.findUniqueOrThrow({ where: { code: "D001" } });
    // the seed fills en / vi; blank two of them to see the fallback
    await prisma.doctor.update({ where: { id: d.id }, data: { qualificationsEn: null, profileVi: null } });
    const en = await loadDoctorPage(d.id, "en");
    const vi = await loadDoctorPage(d.id, "vi");
    await prisma.doctor.update({ where: { id: d.id }, data: { qualificationsEn: d.qualificationsEn, profileVi: d.profileVi } });
    expect(en!.name).toBe("Makoto Tanaka");
    expect(en!.kana).toBeNull();
    expect(en!.profile).toContain("Director since 2018");
    expect(en!.qualifications).toEqual(["日本内科学会 総合内科専門医"]); // qualifications_en empty → ja
    const enHtml = renderToStaticMarkup(<DoctorDetail data={en!} backHref="/doctors" lang="en" />);
    expect(enHtml).toContain("Book: Tanaka Clinic Main – Internal Medicine");
    expect(enHtml).toContain("Back to the doctor list");
    expect(enHtml).toContain("The co-payment for insured care");
    expect(vi!.profile).toBe(d.profileJa); // profile_vi empty → ja
    expect(renderToStaticMarkup(<DoctorDetail data={vi!} backHref="/doctors" lang="vi" />)).toContain("Lịch khám");
  });
});

describe("buttons and schedule rules (抽出3, 抽出4)", () => {
  const prefix = "T98";
  let doctorId = "";
  const ids: Record<string, string> = {};
  let runId = "";
  let ekimaeWindow = 0;
  beforeAll(async () => {
    for (const c of await prisma.clinic.findMany()) ids[c.code] = c.id;
    for (const d of await prisma.department.findMany()) ids[d.code] = d.id;
    runId = (await prisma.slot.findFirstOrThrow()).generatedRunId;
    ekimaeWindow = (await prisma.bookingPolicy.findUniqueOrThrow({ where: { clinicId: ids.ekimae } })).bookingWindowDays;
    const doc = await prisma.doctor.create({
      data: {
        code: `${prefix}1`, familyName: "試験", givenName: "医", familyNameKana: "シケン", givenNameKana: "イ", nameRomaji: "Shiken I",
        title: "DOCTOR", profileJa: "x", primaryClinicId: ids.honin, displayOrder: 300, languages: ["ja", "zh"],
        qualificationsJa: "資格1\n\n資格2\n",
      },
    });
    doctorId = doc.id;
    const tomorrow = dbDate(addDays(todayJst(), 1));
    const slot = (clinic: string, dept: string, hhmm: string, extra: object = {}) => ({
      clinicId: ids[clinic], departmentId: ids[dept], doctorId, slotDate: tomorrow, startTime: dbTime(hhmm), endTime: dbTime("23:00"),
      capacity: 1, reservedCount: 0, status: "OPEN" as const, generatedRunId: runId, ...extra,
    });
    await prisma.slot.createMany({
      data: [
        slot("honin", "naika", "10:00"),
        slot("honin", "shonika", "10:15"),
        slot("ekimae", "naika", "11:00", { reservedCount: 1 }), // full
        slot("nishiguchi", "naika", "12:00", { status: "CLOSED" }),
        slot("ekimae", "hifuka", "13:00", { slotDate: dbDate(addDays(todayJst(), ekimaeWindow + 1)) }), // beyond the window
      ],
    });
    const pattern = (clinic: string, weekday: number, band: "AM" | "PM", s: string, e: string, extra: object = {}) => ({
      doctorId, clinicId: ids[clinic], departmentId: ids.naika, weekday, band, startTime: dbTime(s), endTime: dbTime(e),
      validFrom: dbDate(addDays(todayJst(), -10)), ...extra,
    });
    await prisma.doctorShiftPattern.createMany({
      data: [
        pattern("honin", 1, "AM", "09:00", "10:00"),
        pattern("honin", 1, "AM", "10:30", "12:00"), // two ranges in one cell, by start_time
        pattern("honin", 0, "PM", "15:00", "17:00"), // a 日 column appears
        pattern("ekimae", 2, "PM", "15:00", "18:00"),
        pattern("nishiguchi", 3, "AM", "09:00", "12:00", { validFrom: dbDate(addDays(todayJst(), 5)) }), // future only: no table
        pattern("nishiguchi", 4, "AM", "09:00", "12:00", { validTo: dbDate(addDays(todayJst(), -1)) }), // ended
      ],
    });
  });
  afterAll(async () => {
    await prisma.slot.deleteMany({ where: { doctor: { code: { startsWith: prefix } } } });
    await prisma.doctorShiftPattern.deleteMany({ where: { doctor: { code: { startsWith: prefix } } } });
    await prisma.doctor.deleteMany({ where: { code: { startsWith: prefix } } });
  });

  it("a pair counts only with an OPEN slot that has room inside the window; clinic then department order", async () => {
    const pairs = await bookablePairs(doctorId, new Date());
    expect(pairs.map((s) => `${s.clinic.code}/${s.department.code}`)).toEqual(["honin/naika", "honin/shonika"]);
  });
  it("same-day cut-off: a slot today needs start_time later than now + same_day_cutoff_minutes", async () => {
    await prisma.slot.updateMany({ where: { doctorId, clinicId: ids.honin, departmentId: ids.naika }, data: { slotDate: dbDate(todayJst()) } });
    try {
      // 10:00 slot today: bookable at 09:00 when the cut-off (30 min) leaves room, not at 09:45
      expect((await bookablePairs(doctorId, new Date(`${todayJst()}T09:00:00+09:00`))).map((s) => s.department.code)).toContain("naika");
      expect((await bookablePairs(doctorId, new Date(`${todayJst()}T09:45:00+09:00`))).map((s) => s.department.code)).not.toContain("naika");
    } finally {
      await prisma.slot.updateMany({ where: { doctorId, clinicId: ids.honin, departmentId: ids.naika }, data: { slotDate: dbDate(addDays(todayJst(), 1)) } });
    }
  });
  it("schedule: tables for clinics with a pattern valid today only, cells by start_time, 日 only with a Sunday pattern", async () => {
    const data = await loadDoctorPage(doctorId, "ja", new Date());
    expect(data!.schedule.map((b) => b.clinicCode)).toEqual(["honin", "ekimae"]); // nishiguchi: future / ended only
    const honin = data!.schedule[0];
    expect(honin.cell(1, "AM")).toEqual(["9:00〜10:00", "10:30〜12:00"]);
    expect(honin.cell(1, "PM")).toEqual([]);
    expect(honin.sunday).toBe(true);
    expect(data!.schedule[1].sunday).toBe(false);
    const html = renderToStaticMarkup(<DoctorDetail data={data!} backHref="/doctors" lang="ja" />);
    expect(html).toContain(">日</th>");
    expect(html).toContain("<div>10:30〜12:00</div>"); // cells wrap, no h-scroll (F13-07)
  });
  it("languages in own names, other codes upper-case; qualifications one bullet per non-empty line; a single button gets the sticky bar", async () => {
    await prisma.slot.deleteMany({ where: { doctorId, departmentId: ids.shonika } });
    const data = await loadDoctorPage(doctorId, "ja");
    expect(data!.languages).toBe("日本語・ZH");
    expect(data!.qualifications).toEqual(["資格1", "資格2"]);
    expect(data!.buttons).toHaveLength(1);
    expect(renderToStaticMarkup(<DoctorDetail data={data!} backHref="/doctors" lang="ja" />)).toContain("p09-sticky");
  });
});
