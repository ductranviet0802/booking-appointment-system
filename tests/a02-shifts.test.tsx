// A02 医師シフト: access (three roles), the read routes (DOCTOR own only), the checks (§4.2), the dry run and the save with B2 (EVENT),
// SE044, the audit rows, tampering, and the rendered states 基 / ① / ②. Everything is written to a clinic of the test's own.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { guardScreen } from "@/lib/auth/context";
import { listDoctors, loadDetail, loadWeek, mondayOf } from "@/lib/admin/shifts";
import { findOverlap, validateException, validatePattern, type PatternValues } from "@/lib/admin/shifts-rules";
import { addDays, dbDate, todayJst, weekdayOf } from "@/lib/datetime";
import { pool, prisma } from "@/lib/prisma";
import { login } from "@/lib/auth/service";
import { cleanupStaff, makeStaff, PW, request, TEST_IP } from "./a03-helpers";
import { fixture, type Fixture } from "./b2-helpers";
import { runJob } from "@/lib/batch/runner";

process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
process.env.NOTIFY_OUTBOX_DIR = mkdtempSync(path.join(tmpdir(), "a02-outbox-"));
const mockJar: { sid?: string; path: string } = { path: "/admin/shifts" };
jest.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sid" && mockJar.sid ? { value: mockJar.sid } : undefined) }),
  headers: async () => ({ get: (n: string) => (n === "x-pathname" ? mockJar.path : null) }),
}));
jest.mock("../app/(staff)/admin/shifts/shifts.module.css", () => ({}));
jest.mock("@/components/ui/Toast", () => ({ useToast: () => ({ toast: jest.fn() }), useLang: () => "ja" }));
jest.mock("@/lib/client/api", () => ({ useApiFetch: () => jest.fn(), postJson: jest.fn(), openStaffErrorScreen: jest.fn() }));

import { GET as getDetail } from "@/app/api/admin/shifts/detail/route";
import { GET as getHours } from "@/app/api/admin/shifts/hours/route";
import { GET as getWeek } from "@/app/api/admin/shifts/week/route";
import { POST as postCheck } from "@/app/api/admin/shifts/check/route";
import { POST as postSave } from "@/app/api/admin/shifts/save/route";
import ShiftsPage from "@/app/(staff)/admin/shifts/page";
import { ShiftsClient } from "@/app/(staff)/admin/shifts/ShiftsClient";

jest.setTimeout(120_000);

const today = todayJst();
let holidays = new Set<string>(); // seeded national holidays close the clinic (B2 step 1), so tests avoid them
const open = (date: string) => weekdayOf(date) >= 1 && weekdayOf(date) <= 5 && !holidays.has(date);
const nextOpen = (from: number) => { let n = from; while (!open(addDays(today, n))) n++; return addDays(today, n); };

let f: Fixture;
let admin: Awaited<ReturnType<typeof makeStaff>>;
let reception: Awaited<ReturnType<typeof makeStaff>>;
let doctor: Awaited<ReturnType<typeof makeStaff>>;
let lonely: Awaited<ReturnType<typeof makeStaff>>; // DOCTOR account without a doctors row
const as = (t: string | undefined) => { mockJar.sid = t; };

type Answer = { code?: string; params?: Record<string, unknown>; errors?: { field: string; code: string; params?: Record<string, unknown> }[]; n?: number; detail?: Awaited<ReturnType<typeof loadDetail>>; week?: Awaited<ReturnType<typeof loadWeek>>; adjustCount?: number; bands?: unknown[] };
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Answer });
const send = async (route: (r: ReturnType<typeof request>) => Promise<Response> | Response, url: string, body: unknown) => json(await route(request(url, body)));
const rows = () => Promise.all([
  prisma.doctorShiftPattern.count({ where: { clinicId: f.clinic.id } }),
  prisma.doctorShiftException.count({ where: { doctor: { primaryClinicId: f.clinic.id } } }),
  prisma.auditLog.count({ where: { clinicId: f.clinic.id } }), prisma.batchRun.count({ where: { clinicId: f.clinic.id } }),
]);
const audits = (targetType: string) => prisma.auditLog.findMany({ where: { clinicId: f.clinic.id, action: "MASTER_UPDATE", targetType }, orderBy: { id: "asc" } });
const newRow = (key: string, o: Partial<PatternValues> = {}) => ({ key, id: null, delete: false, departmentId: f.dept.id, weekday: "2", band: "AM", start: "09:00", end: "12:00", validFrom: nextOpen(2), validTo: "", ...o });
const exc = (o: Record<string, unknown> = {}) => ({ date: nextOpen(4), kind: "OFF", band: "AM", departmentId: "", start: "", end: "", substituteDoctorId: "", note: "", ...o });
const req = (doctorId: string, o: { patterns?: object[]; add?: object[]; del?: string[] } = {}) => ({ doctorId, patterns: o.patterns ?? [], exceptionsAdd: o.add ?? [], exceptionsDelete: o.del ?? [] });

beforeAll(async () => {
  holidays = new Set((await prisma.holiday.findMany({ where: { isActive: true } })).map((h) => h.holidayDate.toISOString().slice(0, 10)));
  f = await fixture();
  await f.weekPatterns(f.doctors[0].id, ["AM", "PM"], "2020-01-01");
  await runJob("B2", { trigger: "MANUAL", clinicId: f.clinic.id });
  admin = await makeStaff("ADMIN", { clinics: [f.tag] });
  reception = await makeStaff("RECEPTION", { clinics: [f.tag] });
  doctor = await makeStaff("DOCTOR", { clinics: [f.tag] });
  lonely = await makeStaff("DOCTOR", { clinics: [f.tag] });
  await prisma.doctor.update({ where: { id: f.doctors[0].id }, data: { accountId: doctor.account.id } });
  // a DOCTOR session takes its clinics from the doctor's shifts: log in again now that the doctors row is linked
  const again = await login({ email: doctor.account.email, password: PW, ip: TEST_IP, userAgent: "jest" });
  if (!again.ok || !again.session) throw new Error("doctor login failed");
  doctor.token = again.session.token;
});

afterAll(async () => {
  await f.cleanup();
  await cleanupStaff();
  await prisma.$disconnect();
  await pool.end();
});

describe("rules (§4.2)", () => {
  const hours = (wd: number, band: "AM" | "PM") => (wd >= 1 && wd <= 5 ? (band === "AM" ? { open: "09:00", close: "12:00" } : { open: "15:00", close: "18:00" }) : null);
  const base: PatternValues = { id: null, departmentId: "d", weekday: "1", band: "AM", start: "09:00", end: "12:00", validFrom: addDays(today, 1), validTo: "" };
  const codes = (v: PatternValues) => validatePattern(v, "k", { today, hours }).map((e) => `${e.code}:${e.field.split(".").pop()}`);

  it("pattern row: required, strict HH:MM, order, hours of the band (SE042 with 休診), dates, SE043", () => {
    expect(codes(base)).toEqual([]);
    expect(codes({ ...base, departmentId: "", weekday: "", band: "" })).toEqual(["SE001:departmentId", "SE001:weekday", "SE001:band"]);
    expect(codes({ ...base, start: "", end: "" })).toEqual(["SE001:start", "SE001:end"]);
    expect(codes({ ...base, start: "9:00" })).toEqual(["SE002:start"]); // no tolerance (Q12 a)
    expect(codes({ ...base, start: "11:00", end: "10:00" })).toEqual(["SE002:end"]);
    expect(codes({ ...base, start: "08:00" })).toEqual(["SE042:start"]);
    expect(validatePattern({ ...base, weekday: "6" }, "k", { today, hours })[0]).toMatchObject({ code: "SE042", params: { 診療時間: "休診" } });
    expect(validatePattern({ ...base, end: "13:00" }, "k", { today, hours })[0].params).toEqual({ 時間帯: "午前", 診療時間: "9:00〜12:00" });
    expect(codes({ ...base, validFrom: "" })).toEqual(["SE001:validFrom"]);
    expect(codes({ ...base, validFrom: "2030-02-30" })).toEqual(["SE002:validFrom"]);
    expect(codes({ ...base, validFrom: addDays(today, -1) })).toEqual(["SE043:validFrom"]);
    expect(codes({ ...base, validFrom: today })).toEqual([]); // today allowed (Q4 c)
    expect(codes({ ...base, validTo: addDays(today, 3) })).toEqual([]);
    expect(codes({ ...base, validFrom: addDays(today, 5), validTo: addDays(today, 3) })).toEqual(["SE002:validTo"]);
    expect(codes({ ...base, validTo: addDays(today, -1) })).toEqual(["SE002:validTo"]); // before 8-1 first
  });

  it("row in effect: only 終了日 is read; overlap ignores touching ranges", () => {
    const v = { ...base, id: "x", validFrom: addDays(today, -30), validTo: addDays(today, -2) };
    expect(validatePattern(v, "k", { today, hours, only: "validTo" }).map((e) => e.code)).toEqual(["SE043"]);
    const other = { weekday: 1, start: "09:00", end: "12:00", validFrom: "2020-01-01", validTo: null, clinicName: "本院" };
    expect(findOverlap(base, [other])).toBe(other);
    expect(findOverlap({ ...base, start: "12:00", end: "13:00" }, [other])).toBeNull(); // touching (Q11 a)
    expect(findOverlap({ ...base, weekday: "2" }, [other])).toBeNull();
    expect(findOverlap(base, [{ ...other, validFrom: "2020-01-01", validTo: addDays(today, 0) }])).toBeNull();
  });

  it("exception form: kind decides the required boxes; SE042 for EXTRA outside the hours; note ≤ 200", () => {
    const h = (_d: string, band: "AM" | "PM") => (band === "AM" ? { open: "09:00", close: "12:00" } : null);
    const ok = { date: addDays(today, 1), kind: "OFF" as const, band: "ALL" as const, departmentId: "", start: "", end: "", substituteDoctorId: "", note: "" };
    expect(validateException(ok, { today, hours: h })).toEqual([]);
    expect(validateException({ ...ok, date: "", kind: "" }, { today, hours: h }).map((e) => e.code)).toEqual(["SE001", "SE001"]);
    expect(validateException({ ...ok, date: addDays(today, -1) }, { today, hours: h })[0].code).toBe("SE043");
    expect(validateException({ ...ok, kind: "SUBSTITUTE", band: "AM" }, { today, hours: h }).map((e) => e.field)).toEqual(["x.departmentId", "x.substituteDoctorId"]);
    const extra = { ...ok, kind: "EXTRA" as const, band: "PM" as const, departmentId: "d", start: "15:00", end: "17:00" };
    expect(validateException(extra, { today, hours: h })[0]).toMatchObject({ code: "SE042", params: { 時間帯: "午後", 診療時間: "休診" } });
    expect(validateException({ ...extra, band: "AM", start: "08:00", end: "10:00" }, { today, hours: h })[0].code).toBe("SE042");
    expect(validateException({ ...extra, band: "AM", start: "09:00", end: "10:00" }, { today, hours: h })).toEqual([]);
    expect(validateException({ ...ok, note: "あ".repeat(201) }, { today, hours: h })[0]).toMatchObject({ code: "SE003", params: { n: 200 } });
  });
});

describe("access", () => {
  async function outcome(sid: string | undefined) {
    mockJar.sid = sid;
    try {
      await guardScreen("A02");
      return "allow";
    } catch (e) {
      const d = (e as { digest?: string }).digest ?? "";
      return d.startsWith("NEXT_REDIRECT") ? "redirect" : d.startsWith("NEXT_HTTP_ERROR_FALLBACK") ? `http:${d.split(";")[1]}` : "other";
    }
  }
  it("A02: ADMIN, RECEPTION and DOCTOR in, anonymous → login", async () => {
    expect(await outcome(admin.token)).toBe("allow");
    expect(await outcome(reception.token)).toBe("allow");
    expect(await outcome(doctor.token)).toBe("allow");
    expect(await outcome(undefined)).toBe("redirect");
  });

  it("a DOCTOR account without a doctors row → ER-03 (Q5)", async () => {
    as(lonely.token);
    await expect(ShiftsPage()).rejects.toMatchObject({ digest: expect.stringContaining("403") });
    as(doctor.token);
    expect(renderToStaticMarkup(await ShiftsPage())).toContain("医師シフト");
  });

  it("every write route answers RECEPTION and DOCTOR with 403 SE091 and writes nothing", async () => {
    const before = await rows();
    const held = req(f.doctors[1].id, { patterns: [newRow("n1")], add: [exc()] });
    for (const token of [reception.token, doctor.token]) {
      as(token);
      for (const [route, url] of [[postCheck, "/api/admin/shifts/check"], [postSave, "/api/admin/shifts/save"]] as const) {
        const r = await send(route, url, held);
        expect([r.status, r.body.code]).toEqual([403, "SE091"]);
      }
      const h = await json(await getHours(request(`/api/admin/shifts/hours?date=${nextOpen(3)}`)));
      expect(h.status).toBe(403);
    }
    expect(await rows()).toEqual(before);
    as(undefined);
    expect((await send(postSave, "/api/admin/shifts/save", held)).status).toBe(401);
  });

  it("reads: ADMIN and RECEPTION any listed doctor; DOCTOR own only (another doctor → 403, unknown id → 400)", async () => {
    for (const token of [admin.token, reception.token]) {
      as(token);
      expect((await json(await getDetail(request(`/api/admin/shifts/detail?doctorId=${f.doctors[1].id}`)))).status).toBe(200);
    }
    as(doctor.token);
    const own = await json(await getDetail(request(`/api/admin/shifts/detail?doctorId=${f.doctors[0].id}`)));
    expect([own.status, own.body.detail?.patterns.length]).toEqual([200, 10]);
    const other = await json(await getDetail(request(`/api/admin/shifts/detail?doctorId=${f.doctors[1].id}`)));
    expect([other.status, other.body.code]).toEqual([403, "SE091"]);
    expect((await json(await getDetail(request("/api/admin/shifts/detail?doctorId=00000000-0000-4000-8000-000000000000")))).body.code).toBe("SE090");
    expect((await json(await getDetail(request("/api/admin/shifts/detail?doctorId=x")))).body.code).toBe("SE090");
    const week = await json(await getWeek(request(`/api/admin/shifts/week?start=${today}`)));
    expect(week.body.week?.rows.map((r) => r.doctorId)).toEqual([f.doctors[0].id]); // own row only (Q8)
    expect(week.body.adjustCount).toBe(0);
  });
});

describe("reads", () => {
  it("detail: patterns at every clinic, choices of the session clinic; week: 午前・午後 per day, — where nothing", async () => {
    as(admin.token);
    const d = (await json(await getDetail(request(`/api/admin/shifts/detail?doctorId=${f.doctors[0].id}`)))).body.detail!;
    expect(d.choices).toMatchObject({ clinicId: f.clinic.id, departments: [{ id: f.dept.id }], substitutes: [{ id: f.doctors[1].id }] });
    expect(d.patterns[0]).toMatchObject({ weekday: 1, band: "AM", start: "09:00", end: "12:00", validFrom: "2020-01-01", validTo: null });
    const monday = mondayOf(nextOpen(1));
    const w = (await json(await getWeek(request(`/api/admin/shifts/week?start=${monday}`)))).body.week!;
    expect(w.days).toHaveLength(7);
    expect(w.start).toBe(monday);
    const mine = w.rows.find((r) => r.doctorId === f.doctors[0].id)!;
    expect(mine.cells.some((c) => c === "午前・午後")).toBe(true);
    expect(mine.cells.at(-1)).toBe("—");
    expect(w.rows.find((r) => r.doctorId === f.doctors[1].id)!.cells.every((c) => c === "—")).toBe(true);
    expect((await json(await getWeek(request("/api/admin/shifts/week?start=2030-02-30")))).body.code).toBe("SE090");
    const hours = await json(await getHours(request(`/api/admin/shifts/hours?date=${nextOpen(3)}`)));
    expect(hours.body.bands).toHaveLength(2);
  });
});

describe("save (events 4 / 5 / 6)", () => {
  it("rejects what the checks reject (SE001 / SE042 / SE043 / SE040 / SE090) and writes nothing", async () => {
    as(admin.token);
    const before = await rows();
    const d1 = f.doctors[1].id;
    const attempts: Array<[object, number, string]> = [
      [req(d1, { patterns: [newRow("a", { departmentId: "" })] }), 400, "SE001"],
      [req(d1, { patterns: [newRow("a", { start: "08:00" })] }), 400, "SE042"],
      [req(d1, { patterns: [newRow("a", { validFrom: addDays(today, -1) })] }), 400, "SE043"],
      [req(d1, { add: [exc({ date: addDays(today, -1) })] }), 400, "SE043"],
      [req(d1, { add: [exc({ kind: "EXTRA", band: "PM", departmentId: f.dept.id, start: "12:00", end: "13:00" })] }), 400, "SE042"],
      [req(d1, { add: [exc({ note: "あ".repeat(201) })] }), 400, "SE003"],
      // overlap with the stored pattern of doctor 0 is not an overlap (other doctor); two held rows of the same doctor are
      [req(d1, { patterns: [newRow("a"), newRow("b", { start: "10:00", end: "11:00" })] }), 400, "SE040"],
      // tampering → SE090
      [req(d1, { add: [exc({ kind: "BOGUS" })] }), 400, "SE090"],
      [req(d1, { add: [exc({ band: "ALL", kind: "SUBSTITUTE", departmentId: f.dept.id, substituteDoctorId: f.doctors[0].id })] }), 400, "SE090"],
      [req(d1, { add: [exc({ kind: "SUBSTITUTE", departmentId: f.dept.id, substituteDoctorId: d1 })] }), 400, "SE090"],
      [req(d1, { add: [exc({ kind: "EXTRA", band: "AM", departmentId: "00000000-0000-4000-8000-000000000000", start: "09:00", end: "10:00" })] }), 400, "SE090"],
      [req(d1, { add: [exc({ date: "2030-02-30" })] }), 400, "SE090"],
      [req(d1, { del: ["00000000-0000-4000-8000-000000000000"] }), 400, "SE090"],
      [req(d1, { patterns: [{ ...newRow("a"), delete: true }] }), 400, "SE090"],
      [{ doctorId: d1, patterns: "x", exceptionsAdd: [], exceptionsDelete: [] }, 400, "SE090"],
      [req("00000000-0000-4000-8000-000000000000"), 400, "SE090"],
    ];
    for (const [body, status, code] of attempts) {
      for (const route of [postCheck, postSave] as const) {
        const r = await send(route, "/api/admin/shifts/x", body);
        expect([r.status, r.body.code, JSON.stringify(body).slice(0, 80)]).toEqual([status, code, JSON.stringify(body).slice(0, 80)]);
      }
    }
    expect(await rows()).toEqual(before);
  });

  it("a new pattern row: dry run counts 0, the save inserts it, writes one MASTER_UPDATE row and B2 (EVENT) makes the frames", async () => {
    as(admin.token);
    const d1 = f.doctors[1];
    const date = nextOpen(2);
    const body = req(d1.id, { patterns: [newRow("a", { weekday: String(weekdayOf(date)), validFrom: date })] });
    const dry = await send(postCheck, "/api/admin/shifts/check", body);
    expect([dry.status, dry.body.n]).toEqual([200, 0]);
    expect(await prisma.doctorShiftPattern.count({ where: { doctorId: d1.id } })).toBe(0); // rolled back
    expect(await f.frames({ doctorId: d1.id })).toHaveLength(0);
    const runs = await prisma.batchRun.count({ where: { clinicId: f.clinic.id, jobCode: "B2" } });

    const saved = await send(postSave, "/api/admin/shifts/save", body);
    expect([saved.status, saved.body.code, saved.body.params]).toEqual([200, "SI040", { n: 0 }]);
    const stored = await prisma.doctorShiftPattern.findMany({ where: { doctorId: d1.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ clinicId: f.clinic.id, departmentId: f.dept.id, band: "AM", weekday: weekdayOf(date) });
    expect((await f.frames({ doctorId: d1.id, slotDate: dbDate(date) })).length).toBe(12);
    const run = await prisma.batchRun.findFirstOrThrow({ where: { clinicId: f.clinic.id, jobCode: "B2" }, orderBy: { startedAt: "desc" } });
    expect(await prisma.batchRun.count({ where: { clinicId: f.clinic.id, jobCode: "B2" } })).toBe(runs + 1);
    expect(run.trigger).toBe("EVENT");
    expect((run.params as { dates: string[] }).dates).toContain(date);
    const [a] = await audits("doctor_shift_patterns");
    expect(a).toMatchObject({ targetId: d1.id, role: "ADMIN", accountId: admin.account.id });
    expect((a.detail as { columns: string[] }).columns).toEqual(expect.arrayContaining(["weekday", "band", "valid_from", "valid_to"]));
    expect(await audits("doctor_shift_exceptions")).toHaveLength(0);

    // another held row overlapping the stored one (same doctor, same weekday, same time, validity intersects) → SE040 at the row
    const overlap = await send(postSave, "/api/admin/shifts/save", req(d1.id, { patterns: [newRow("z", { weekday: String(weekdayOf(date)), validFrom: date, start: "10:00", end: "11:00" })] }));
    expect([overlap.status, overlap.body.errors?.[0].field, overlap.body.errors?.[0].params?.クリニック名]).toEqual([400, "p.z.row", f.clinic.nameJa]);
    expect(await prisma.doctorShiftPattern.count({ where: { doctorId: d1.id } })).toBe(1);

    // the stored row starts in the future: it may be changed (Q4 a) and deleted
    const id = stored[0].id;
    const edit = await send(postSave, "/api/admin/shifts/save", req(d1.id, { patterns: [{ ...newRow(id, { weekday: String(weekdayOf(date)), validFrom: date, end: "11:00" }), id }] }));
    expect(edit.body.code).toBe("SI040");
    expect(((await audits("doctor_shift_patterns"))[1].detail as { columns: string[] }).columns).toEqual(["end_time"]);
    const gone = await send(postSave, "/api/admin/shifts/save", req(d1.id, { patterns: [{ ...newRow(id, { validFrom: date }), id, delete: true }] }));
    expect(gone.body.code).toBe("SI040");
    expect(await prisma.doctorShiftPattern.count({ where: { doctorId: d1.id } })).toBe(0);
    expect((await f.frames({ doctorId: d1.id, status: "OPEN" })).length).toBe(0);
  });

  it("a row in effect accepts only 終了日; an ended date is refused; a save with no change writes nothing", async () => {
    as(admin.token);
    const d0 = f.doctors[0].id;
    const row = await prisma.doctorShiftPattern.findFirstOrThrow({ where: { doctorId: d0, weekday: 1, band: "AM" } });
    const same = { key: row.id, id: row.id, delete: false, departmentId: f.dept.id, weekday: "1", band: "AM", start: "09:00", end: "12:00", validFrom: "2020-01-01", validTo: "" };
    const before = await rows();
    for (const tamper of [{ ...same, start: "09:15" }, { ...same, weekday: "2" }, { ...same, validFrom: "2020-01-02" }, { ...same, delete: true }]) {
      const r = await send(postSave, "/api/admin/shifts/save", req(d0, { patterns: [tamper] }));
      expect([r.status, r.body.code]).toEqual([400, "SE090"]);
    }
    expect((await send(postSave, "/api/admin/shifts/save", req(d0, { patterns: [{ ...same, validTo: addDays(today, -1) }] }))).body.code).toBe("SE043");
    expect(await rows()).toEqual(before);
    const unchanged = await send(postSave, "/api/admin/shifts/save", req(d0, { patterns: [same] }));
    expect([unchanged.status, unchanged.body.code]).toEqual([200, "SI040"]);
    expect(await rows()).toEqual(before);

    // end it on a date; the frames after it close, and clearing the date reopens them
    const end = nextOpen(6);
    const ended = await send(postSave, "/api/admin/shifts/save", req(d0, { patterns: [{ ...same, validTo: end }] }));
    expect(ended.body.code).toBe("SI040");
    expect((await audits("doctor_shift_patterns")).at(-1)!.detail).toEqual({ columns: ["valid_to"] });
    const after = (await f.frames({ doctorId: d0 })).filter((s) => s.slotDate.getUTCDay() === 1 && s.startTime.getUTCHours() < 12 && s.slotDate > dbDate(end));
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((s) => s.status === "CLOSED" && s.closedReason === "DOCTOR_OFF")).toBe(true);
    await send(postSave, "/api/admin/shifts/save", req(d0, { patterns: [same] }));
    expect((await f.frames({ doctorId: d0, status: "CLOSED" })).length).toBe(0);
  });

  it("休み over a booked frame: dry run n = 1, the save closes the frames, the booking becomes 要調整 (not cancelled); deleting the 休み reopens them", async () => {
    as(admin.token);
    const d0 = f.doctors[0].id;
    const date = nextOpen(8);
    const frames = await f.frames({ doctorId: d0, slotDate: dbDate(date) });
    const booked = await f.book([frames[0].id], d0, "SHFA0001");
    const body = req(d0, { add: [exc({ date, note: "学会" })] });
    const dry = await send(postCheck, "/api/admin/shifts/check", body);
    expect([dry.status, dry.body.n]).toEqual([200, 1]);
    expect(await prisma.doctorShiftException.count({ where: { doctorId: d0 } })).toBe(0);

    const saved = await send(postSave, "/api/admin/shifts/save", body);
    expect([saved.status, saved.body.code, saved.body.params]).toEqual([200, "SI040", { n: 1 }]);
    const x = await prisma.doctorShiftException.findFirstOrThrow({ where: { doctorId: d0 } });
    expect(x).toMatchObject({ kind: "OFF", band: "AM", note: "学会", clinicId: null, createdBy: admin.account.id });
    const day = await f.frames({ doctorId: d0, slotDate: dbDate(date) });
    expect(day.filter((s) => s.status === "CLOSED")).toHaveLength(12);
    expect(day.filter((s) => s.status === "OPEN")).toHaveLength(12);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: booked.id }, include: { events: true } });
    expect([b.status, b.adjustRequiredAt !== null, b.events.map((e) => e.event).includes("ADJUST_REQUIRED")]).toEqual(["RESERVED", true, true]);
    const [a] = await audits("doctor_shift_exceptions");
    expect(a).toMatchObject({ targetId: d0 });
    expect((a.detail as { columns: string[] }).columns).toEqual(expect.arrayContaining(["shift_date", "kind", "note", "created_by"]));

    // week overview: the AM cell of that day is gone, PM stays
    const w = (await json(await getWeek(request(`/api/admin/shifts/week?start=${date}`)))).body.week!;
    expect(w.rows.find((r) => r.doctorId === d0)!.cells[(weekdayOf(date) + 6) % 7]).toBe("午後");

    const del = await send(postSave, "/api/admin/shifts/save", req(d0, { del: [x.id] }));
    expect([del.status, del.body.code]).toEqual([200, "SI040"]);
    expect(await prisma.doctorShiftException.count({ where: { doctorId: d0 } })).toBe(0);
    expect((await f.frames({ doctorId: d0, slotDate: dbDate(date) })).every((s) => s.status === "OPEN")).toBe(true);
    await prisma.booking.delete({ where: { id: booked.id } });
  });

  it("追加勤務 and 代診 are stored with the clinic of the session; a past exception cannot be deleted", async () => {
    as(admin.token);
    const [d0, d1] = f.doctors.map((d) => d.id);
    const date = nextOpen(10);
    const frames = await f.frames({ doctorId: d0, slotDate: dbDate(date) });
    const booked = await f.book([frames[0].id], d0, "SHFB0002");
    const sub = exc({ date, kind: "SUBSTITUTE", band: "AM", departmentId: f.dept.id, substituteDoctorId: d1 });
    const saved = await send(postSave, "/api/admin/shifts/save", req(d0, { add: [sub] }));
    expect([saved.status, saved.body.code]).toEqual([200, "SI040"]);
    const x = await prisma.doctorShiftException.findFirstOrThrow({ where: { doctorId: d0, kind: "SUBSTITUTE" } });
    expect(x).toMatchObject({ clinicId: f.clinic.id, departmentId: f.dept.id, substituteDoctorId: d1, band: "AM" });
    const moved = await prisma.booking.findUniqueOrThrow({ where: { id: booked.id }, include: { events: true } });
    expect([moved.doctorId, moved.adjustRequiredAt, moved.events.map((e) => e.event).includes("DOCTOR_SUBSTITUTED")]).toEqual([d1, null, true]);
    const w = (await json(await getWeek(request(`/api/admin/shifts/week?start=${date}`)))).body.week!;
    const col = (weekdayOf(date) + 6) % 7;
    expect(w.rows.find((r) => r.doctorId === d0)!.cells[col]).toContain(`代診→医1 試験・午前`);
    expect(w.rows.find((r) => r.doctorId === d1)!.cells[col]).toBe("午前(代診)");

    const extra = exc({ date: addDays(date, 7), kind: "EXTRA", band: "AM", departmentId: f.dept.id, start: "09:00", end: "10:00" });
    expect((await send(postSave, "/api/admin/shifts/save", req(d1, { add: [extra] }))).body.code).toBe("SI040");
    const e = await prisma.doctorShiftException.findFirstOrThrow({ where: { doctorId: d1, kind: "EXTRA" } });
    expect([e.clinicId, e.startTime?.getUTCHours(), e.endTime?.getUTCHours()]).toEqual([f.clinic.id, 9, 10]);
    expect((await f.frames({ doctorId: d1, slotDate: dbDate(extra.date as string), status: "OPEN" })).length).toBe(4);

    const old = await prisma.doctorShiftException.create({ data: { doctorId: d1, shiftDate: dbDate(addDays(today, -3)), kind: "OFF", band: null, createdBy: admin.account.id } });
    const before = await rows();
    expect((await send(postSave, "/api/admin/shifts/save", req(d1, { del: [old.id] }))).body.code).toBe("SE090");
    expect(await rows()).toEqual(before);
    await prisma.doctorShiftException.deleteMany({ where: { id: old.id } });
    await send(postSave, "/api/admin/shifts/save", req(d1, { del: [e.id] }));
    await send(postSave, "/api/admin/shifts/save", req(d0, { del: [x.id] }));
  });

  it("SE044 when B2 cannot run (the job lock is taken): 409, the rows stay saved", async () => {
    as(admin.token);
    const d1 = f.doctors[1].id;
    const lock = await pool.connect();
    try {
      await lock.query("SELECT pg_advisory_lock(hashtext('batch:B2'))");
      const r = await send(postSave, "/api/admin/shifts/save", req(d1, { add: [exc({ date: nextOpen(14), band: "PM" })] }));
      expect([r.status, r.body.code]).toEqual([409, "SE044"]);
      expect(await prisma.doctorShiftException.count({ where: { doctorId: d1 } })).toBe(1);
    } finally {
      await lock.query("SELECT pg_advisory_unlock(hashtext('batch:B2'))");
      lock.release();
    }
  });
});

describe("page", () => {
  async function page(role: "ADMIN" | "RECEPTION" | "DOCTOR", adjustCount = 2) {
    const ctx = { clinicId: f.clinic.id, now: new Date() };
    const doctors = await listDoctors(f.clinic.id, role, role === "DOCTOR" ? doctor.account.id : admin.account.id);
    return renderToStaticMarkup(
      <ShiftsClient role={role} today={today} doctors={doctors} detail={await loadDetail(ctx, doctors[0])} week={await loadWeek(ctx, doctors, mondayOf(today))} adjustCount={adjustCount} />,
    );
  }
  it("ADMIN sees 行追加, 追加, 保存する and the 要調整 link", async () => {
    const a = await page("ADMIN");
    for (const word of ["医師シフト", "＋ 行追加", "保存する", "要調整の予約 2件 →", "定型シフト — 医0 試験", "例外（休み・追加勤務・代診）", "閲覧のみ", "保存すると対象日の枠を再生成します。"]) expect(a).toContain(word);
    expect(a).toContain(">追加<");
    expect(a).toContain('href="/staff/ledger?filter=adjust"');
  });

  it("RECEPTION (①) has the values as text and none of 保存する / 行追加 / 追加 / 削除; the 要調整 link stays", async () => {
    const r = await page("RECEPTION");
    for (const word of ["保存する", "＋ 行追加", ">追加<", ">削除<", "<select", "type=\"radio\""]) expect(r).not.toContain(word);
    expect(r).toContain("要調整の予約 2件 →");
    expect(r).toContain("医0 試験");
    expect(r).toContain("午前"); // values as text
  });

  it("DOCTOR (②) sees only the own doctor and week row, and no 要調整 link", async () => {
    const d = await page("DOCTOR");
    for (const word of ["保存する", "＋ 行追加", ">追加<", ">削除<", "要調整の予約"]) expect(d).not.toContain(word);
    expect(d).toContain("医0 試験");
    expect(d).not.toContain("医1 試験");
  });
});
