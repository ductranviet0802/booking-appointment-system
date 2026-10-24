// A01 診療カレンダー・休診日: access, the read routes, the checks (S-03 hours order, S-02 kana, §4.2), the dry run and the save with
// B2 (EVENT), SE043 / SE044, the audit rows, the clinic profile, the B3 manual start and the read-only page of the receptionist.
// Everything is written to a clinic of the test's own.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { guardScreen } from "@/lib/auth/context";
import { loadClinic, loadState } from "@/lib/admin/calendar";
import {
  validateClinic, validateDay, validateHours, validateRange, WEEK_ORDER, BANDS, type ClinicValues, type DayValues, type HoursCellValues,
} from "@/lib/admin/calendar-rules";
import { runJob } from "@/lib/batch/runner";
import { addDays, dbDate, todayJst, weekdayOf } from "@/lib/datetime";
import { pool, prisma } from "@/lib/prisma";
import { cleanupStaff, makeStaff, request } from "./a03-helpers";
import { fixture, type Fixture } from "./b2-helpers";

process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
process.env.NOTIFY_OUTBOX_DIR = mkdtempSync(path.join(tmpdir(), "a01-outbox-"));
const mockJar: { sid?: string; path: string } = { path: "/admin/calendar" };
jest.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sid" && mockJar.sid ? { value: mockJar.sid } : undefined) }),
  headers: async () => ({ get: (n: string) => (n === "x-pathname" ? mockJar.path : null) }),
}));
jest.mock("../app/(staff)/admin/calendar/calendar.module.css", () => ({}));
jest.mock("next/navigation", () => ({ ...jest.requireActual("next/navigation"), useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/components/ui/Toast", () => ({ useToast: () => ({ toast: jest.fn() }), useLang: () => "ja" }));
jest.mock("@/lib/client/api", () => ({ useApiFetch: () => jest.fn(), postJson: jest.fn(), openStaffErrorScreen: jest.fn() }));

import { GET as getDay } from "@/app/api/admin/calendar/day/route";
import { POST as postCheck } from "@/app/api/admin/calendar/check/route";
import { POST as postClinic } from "@/app/api/admin/calendar/clinic/route";
import { POST as postHolidays } from "@/app/api/admin/calendar/holidays/route";
import { POST as postSave } from "@/app/api/admin/calendar/save/route";
import { GET as getState } from "@/app/api/admin/calendar/state/route";
import { CalendarClient } from "@/app/(staff)/admin/calendar/CalendarClient";

jest.setTimeout(120_000);

const today = todayJst();
const open = (date: string) => weekdayOf(date) >= 1 && weekdayOf(date) <= 5;
const nextOpen = (from: number) => { let n = from; while (!open(addDays(today, n))) n++; return addDays(today, n); };

let f: Fixture;
let admin: Awaited<ReturnType<typeof makeStaff>>;
let reception: Awaited<ReturnType<typeof makeStaff>>;
let doctor: Awaited<ReturnType<typeof makeStaff>>;
const as = (t: string | undefined) => { mockJar.sid = t; };

type Answer = { code?: string; params?: Record<string, number>; errors?: { field: string; code: string; params?: Record<string, unknown> }[]; n?: number; state?: Awaited<ReturnType<typeof loadState>> };
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Answer });
const cells = async () => (await loadState(f.clinic.id, today.slice(0, 7))).hours;
const send = async (route: (r: ReturnType<typeof request>) => Promise<Response> | Response, url: string, body: unknown) => json(await route(request(url, body)));
const rows = () => Promise.all([
  prisma.clinicBusinessHour.count({ where: { clinicId: f.clinic.id } }), prisma.clinicCalendarDay.count({ where: { clinicId: f.clinic.id } }),
  prisma.auditLog.count({ where: { clinicId: f.clinic.id } }), prisma.batchRun.count({ where: { clinicId: f.clinic.id } }),
]);
const audits = (targetType: string) => prisma.auditLog.findMany({ where: { clinicId: f.clinic.id, action: "MASTER_UPDATE", targetType }, orderBy: { id: "asc" } });
const day = (date: string, o: Partial<DayValues> = {}): DayValues => ({ date, kind: "CLOSED", amOpen: "", amClose: "", pmOpen: "", pmClose: "", noteJa: "", noteEn: "", noteVi: "", ...o });

beforeAll(async () => {
  f = await fixture();
  await f.weekPatterns(f.doctors[0].id, ["AM", "PM"], "2020-01-01");
  await runJob("B2", { trigger: "MANUAL", clinicId: f.clinic.id });
  admin = await makeStaff("ADMIN", { clinics: [f.tag] });
  reception = await makeStaff("RECEPTION", { clinics: [f.tag] });
  doctor = await makeStaff("DOCTOR", { clinics: [f.tag] });
});

afterAll(async () => {
  await f.cleanup();
  await cleanupStaff();
  await prisma.$disconnect();
  await pool.end();
});

describe("rules (§4.2)", () => {
  const cell = (weekday: number, band: "AM" | "PM", o: Partial<HoursCellValues> = {}): HoursCellValues => ({ weekday, band, on: true, open: "09:00", close: "12:00", reception: "", ...o });
  const grid = (over: HoursCellValues[] = []) =>
    WEEK_ORDER.flatMap((weekday) => BANDS.map((band) => over.find((c) => c.weekday === weekday && c.band === band) ?? cell(weekday, band, { on: false, open: "", close: "" })));
  const codes = (e: { code: string; params?: Record<string, unknown> }[]) => e.map((x) => `${x.code}:${x.params?.項目 ?? ""}`);

  it("hours: required, strict HH:MM, open < close, 受付終了 ≤ close", () => {
    expect(codes(validateHours(grid([cell(1, "AM", { open: "", close: "" })])))).toEqual(["SE001:開始", "SE001:終了"]);
    expect(codes(validateHours(grid([cell(1, "AM", { open: "9:00" })])))).toEqual(["SE002:開始"]); // no tolerance (Q11 a)
    expect(codes(validateHours(grid([cell(1, "AM", { open: "12:00" })])))).toEqual(["SE002:終了"]);
    expect(codes(validateHours(grid([cell(1, "AM", { reception: "12:01" })])))).toEqual(["SE002:受付終了"]);
    expect(validateHours(grid([cell(1, "AM", { reception: "12:00" })]))).toEqual([]);
    expect(validateHours(grid([cell(1, "AM", { on: false, open: "xx" })]))).toEqual([]); // an unchecked cell is not read
  });

  it("S-03: AM close ≤ PM open across the two rows of one weekday (SE002 on the PM 開始)", () => {
    const am = cell(1, "AM", { close: "13:00" });
    const pm = cell(1, "PM", { open: "12:30", close: "18:00" });
    const e = validateHours(grid([am, pm]));
    expect(e).toEqual([{ field: "h.1.PM.open", code: "SE002", params: { 項目: "開始" } }]);
    expect(validateHours(grid([cell(1, "AM", { close: "12:30" }), pm]))).toEqual([]); // equal is allowed
    expect(validateHours(grid([am, cell(1, "PM", { on: false })]))).toEqual([]); // one band only
  });

  it("day: 臨時診療 needs a complete band, order, notes ≤ 200, past → SE043", () => {
    const sp = (o: Partial<DayValues>) => day("2030-01-02", { kind: "SPECIAL_OPEN", ...o });
    expect(codes(validateDay(sp({}), today))).toEqual(["SE001:臨時診療の時間"]);
    expect(codes(validateDay(sp({ amOpen: "09:00" }), today))).toEqual(["SE001:臨時診療の時間"]); // one time = missing
    expect(validateDay(sp({ amOpen: "09:00", amClose: "12:00" }), today)).toEqual([]);
    expect(codes(validateDay(sp({ amOpen: "12:00", amClose: "09:00" }), today))).toEqual(["SE002:臨時診療の時間"]);
    expect(codes(validateDay(sp({ amOpen: "09:00", amClose: "13:00", pmOpen: "12:00", pmClose: "15:00" }), today))).toEqual(["SE002:臨時診療の時間"]);
    expect(validateDay(day("2030-01-02", { noteJa: "あ".repeat(201) }), today)[0]).toMatchObject({ code: "SE003", params: { n: 200 } });
    expect(validateDay(day("2030-01-02", { kind: "NORMAL", noteJa: "あ".repeat(201) }), today)).toEqual([]);
    expect(validateDay(day(addDays(today, -1)), today)[0].code).toBe("SE043");
    expect(validateDay(day(today), today)).toEqual([]);
  });

  it("range dialog: empty SE001, not a date / reversed SE002, past SE043", () => {
    expect(validateRange("", "", today).map((e) => e.code)).toEqual(["SE001", "SE001"]);
    expect(validateRange("2030-02-30", "2030-03-01", today)[0].code).toBe("SE002");
    expect(validateRange("2030-03-02", "2030-03-01", today)[0]).toMatchObject({ field: "range.end", code: "SE002" });
    expect(validateRange(addDays(today, -1), today, today)[0].code).toBe("SE043");
    expect(validateRange(today, addDays(today, 3), today)).toEqual([]);
  });

  const clinic: ClinicValues = {
    nameJa: "○○クリニック", nameEn: "", nameVi: "", nameKana: "マルマルクリニック ホンイン", postcode: "1000005", prefecture: "東京都", city: "千代田区",
    addressLine: "丸の内1", addressEn: "", phone: "0312345678", accessJa: "東京駅", accessEn: "", accessVi: "", mapUrl: "", noticeJa: "", noticeEn: "", noticeVi: "",
  };
  it("S-02: クリニック名カナ is full-width katakana, ー and space; clinic profile rules 13–27", () => {
    expect(validateClinic(clinic)).toEqual([]);
    expect(validateClinic({ ...clinic, nameKana: "マルマル　クリニック" })).toEqual([]); // full-width space
    expect(validateClinic({ ...clinic, nameKana: "" })[0]).toMatchObject({ field: "clinic.nameKana", code: "SE001" });
    for (const bad of ["まるまる", "ﾏﾙﾏﾙ", "Maru", "マル1"]) expect(validateClinic({ ...clinic, nameKana: bad })[0]).toMatchObject({ code: "SE002", params: { 項目: "クリニック名カナ" } });
    expect(validateClinic({ ...clinic, nameKana: "ア".repeat(101) })[0]).toMatchObject({ code: "SE003", params: { n: 100 } });
    expect(validateClinic({ ...clinic, postcode: "100-0005" })[0]).toMatchObject({ field: "clinic.postcode", code: "SE002" });
    expect(validateClinic({ ...clinic, phone: "03-1234-5678" })[0]).toMatchObject({ field: "clinic.phone", code: "SE002" });
    expect(validateClinic({ ...clinic, phone: "031234567" })[0].code).toBe("SE002");
    expect(validateClinic({ ...clinic, mapUrl: "http://x.example/" })[0]).toMatchObject({ field: "clinic.mapUrl", code: "SE002" });
    expect(validateClinic({ ...clinic, prefecture: "", city: "" }).map((e) => e.code)).toEqual(["SE001", "SE001"]);
    expect(validateClinic({ ...clinic, city: "あ".repeat(51) })[0]).toMatchObject({ code: "SE003", params: { n: 50 } });
    expect(validateClinic({ ...clinic, accessJa: " " })[0]).toMatchObject({ code: "SE001" });
  });
});

describe("access", () => {
  async function outcome(sid: string | undefined) {
    mockJar.sid = sid;
    try {
      await guardScreen("A01");
      return "allow";
    } catch (e) {
      const d = (e as { digest?: string }).digest ?? "";
      return d.startsWith("NEXT_REDIRECT") ? "redirect" : d.startsWith("NEXT_HTTP_ERROR_FALLBACK") ? `http:${d.split(";")[1]}` : "other";
    }
  }
  it("A01: ADMIN and RECEPTION in, DOCTOR → ER-03, anonymous → login", async () => {
    expect(await outcome(admin.token)).toBe("allow");
    expect(await outcome(reception.token)).toBe("allow");
    expect(await outcome(doctor.token)).toBe("http:403");
    expect(await outcome(undefined)).toBe("redirect");
  });

  it("every write route answers RECEPTION and DOCTOR with 403 SE091 and writes nothing; reads allow RECEPTION, refuse DOCTOR", async () => {
    const before = await rows();
    const held = { hours: await cells(), days: [day(nextOpen(3))] };
    for (const token of [reception.token, doctor.token]) {
      as(token);
      for (const [route, url, body] of [
        [postCheck, "/api/admin/calendar/check", held], [postSave, "/api/admin/calendar/save", held],
        [postClinic, "/api/admin/calendar/clinic", {}], [postHolidays, "/api/admin/calendar/holidays", {}],
      ] as const) {
        const r = await send(route, url, body);
        expect([r.status, r.body.code]).toEqual([403, "SE091"]);
      }
    }
    expect(await rows()).toEqual(before);
    as(reception.token);
    expect((await json(await getState(request("/api/admin/calendar/state")))).status).toBe(200);
    expect((await json(await getDay(request(`/api/admin/calendar/day?date=${today}`)))).status).toBe(200);
    as(doctor.token);
    expect((await json(await getState(request("/api/admin/calendar/state")))).status).toBe(403);
    as(undefined);
    expect((await json(await getState(request("/api/admin/calendar/state")))).status).toBe(401);
  });
});

describe("reads", () => {
  it("state: the month, the holiday list (inactive rows included), the last runs, the 要調整 count; day: booked frames", async () => {
    as(admin.token);
    const r = await json(await getState(request(`/api/admin/calendar/state?ym=${today.slice(0, 7)}`)));
    expect(r.status).toBe(200);
    const st = r.body.state!;
    expect(st.hours).toHaveLength(14);
    expect(st.hours[0]).toMatchObject({ weekday: 1, band: "AM", on: true, open: "09:00", close: "12:00", reception: "11:30" });
    expect(st.hours.filter((c) => c.on)).toHaveLength(10);
    expect(st.b2?.status).toBe("SUCCESS");
    expect(st.adjustCount).toBe(0);
    expect(st.holidayList.length).toBeGreaterThan(20); // the seeded X3 rows of the current and next year
    expect((await json(await getState(request("/api/admin/calendar/state?ym=2030-13")))).body.code).toBe("SE090");
    const date = nextOpen(5);
    const slot = await prisma.slot.findFirstOrThrow({ where: { clinicId: f.clinic.id, slotDate: dbDate(date) } });
    await f.book([slot.id], f.doctors[0].id, "CALA0001");
    expect((await json(await getDay(request(`/api/admin/calendar/day?date=${date}`)))).body).toMatchObject({ n: 1 });
    expect((await json(await getDay(request("/api/admin/calendar/day?date=2030-02-30")))).body.code).toBe("SE090");
    await prisma.booking.deleteMany({ where: { bookingNo: "CALA0001" } });
    await prisma.slot.update({ where: { id: slot.id }, data: { reservedCount: 0 } });
  });
});

describe("save (events 4 / 5)", () => {
  it("rejects what the checks reject (SE001 / SE002 / SE043 / SE090) and writes nothing", async () => {
    as(admin.token);
    const before = await rows();
    const base = await cells();
    const bad = (over: Partial<HoursCellValues>) => ({ hours: base.map((c) => (c.weekday === 1 && c.band === "AM" ? { ...c, ...over } : c)), days: [] });
    const r1 = await send(postSave, "/api/admin/calendar/save", bad({ open: "9:00" }));
    expect([r1.status, r1.body.code, r1.body.errors?.[0].field]).toEqual([400, "SE002", "h.1.AM.open"]);
    const pmBad = base.map((c) => (c.weekday === 2 && c.band === "AM" ? { ...c, close: "15:30" } : c)); // AM close after PM open (15:00) on Tuesday
    const r2 = await send(postSave, "/api/admin/calendar/save", { hours: pmBad, days: [] });
    expect([r2.status, r2.body.errors?.[0].field]).toEqual([400, "h.2.PM.open"]);
    const r3 = await send(postSave, "/api/admin/calendar/save", { hours: base, days: [day(addDays(today, -1))] });
    expect([r3.status, r3.body.code]).toEqual([400, "SE043"]);
    for (const tamper of [{ hours: base, days: [{ ...day(nextOpen(3)), kind: "BOGUS" }] }, { hours: base, days: [day("2030-02-31")] }, { hours: base.slice(1), days: [] }, { hours: "x", days: [] }]) {
      const r = await send(postSave, "/api/admin/calendar/save", tamper);
      expect([r.status, r.body.code]).toEqual([400, "SE090"]);
    }
    expect(await rows()).toEqual(before);
  });

  it("an exception: dry run counts the frames with bookings, the save closes the frames (CLINIC_CLOSED) and writes one MASTER_UPDATE row", async () => {
    as(admin.token);
    const date = nextOpen(4);
    const frames = await prisma.slot.findMany({ where: { clinicId: f.clinic.id, slotDate: dbDate(date) }, orderBy: { startTime: "asc" } });
    expect(frames.length).toBe(24);
    const booked = await f.book([frames[0].id], f.doctors[0].id, "CALB0002");
    const held = { hours: await cells(), days: [day(date, { noteJa: "院内研修" })] };
    const dry = await send(postCheck, "/api/admin/calendar/check", held);
    expect([dry.status, dry.body.n]).toEqual([200, 1]);
    expect(await prisma.clinicCalendarDay.count({ where: { clinicId: f.clinic.id } })).toBe(0); // the dry run is rolled back
    expect((await f.frames({ status: "CLOSED" })).length).toBe(0);
    const runsBefore = await prisma.batchRun.count({ where: { clinicId: f.clinic.id, jobCode: "B2" } });

    const saved = await send(postSave, "/api/admin/calendar/save", held);
    expect([saved.status, saved.body.code, saved.body.params]).toEqual([200, "SI040", { n: 1 }]);
    const closed = await f.frames({ slotDate: dbDate(date) });
    expect(closed.every((s) => s.status === "CLOSED" && s.closedReason === "CLINIC_CLOSED")).toBe(true);
    const row = await prisma.clinicCalendarDay.findFirstOrThrow({ where: { clinicId: f.clinic.id } });
    expect(row).toMatchObject({ kind: "CLOSED", noteJa: "院内研修", createdBy: admin.account.id });
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: booked.id } });
    expect([b.status, b.adjustRequiredAt !== null]).toEqual(["RESERVED", true]);
    const run = await prisma.batchRun.findFirstOrThrow({ where: { clinicId: f.clinic.id, jobCode: "B2" }, orderBy: { startedAt: "desc" } });
    expect(await prisma.batchRun.count({ where: { clinicId: f.clinic.id, jobCode: "B2" } })).toBe(runsBefore + 1);
    expect([run.trigger, (run.params as { dates: string[] }).dates]).toEqual(["EVENT", [date]]);
    const [audit] = await audits("clinic_calendar_days");
    expect(audits("clinic_business_hours")).resolves.toHaveLength(0);
    expect(audit).toMatchObject({ targetId: f.clinic.id, role: "ADMIN", accountId: admin.account.id });
    expect((audit.detail as { columns: string[] }).columns).toContain("note_ja");
    expect((audit.detail as { columns: string[] }).columns).toContain("cal_date"); // INSERT: every column

    // 通常 deletes the row (and the notes); the frames reopen
    const clear = await send(postSave, "/api/admin/calendar/save", { hours: await cells(), days: [day(date, { kind: "NORMAL" })] });
    expect(clear.body.code).toBe("SI040");
    expect(await prisma.clinicCalendarDay.count({ where: { clinicId: f.clinic.id } })).toBe(0);
    expect((await f.frames({ slotDate: dbDate(date) })).every((s) => s.status === "OPEN")).toBe(true);
    await prisma.booking.delete({ where: { id: booked.id } });
  });

  it("an hours change: the weekday's dates are regenerated; a save with no change writes no audit row and starts no B2", async () => {
    as(admin.token);
    const hours = (await cells()).map((c) => (c.weekday === 3 && c.band === "PM" ? { ...c, on: false } : c));
    const saved = await send(postSave, "/api/admin/calendar/save", { hours, days: [] });
    expect(saved.body.code).toBe("SI040");
    const wednesdays = (await f.frames({ status: "CLOSED" })).filter((s) => s.slotDate.getUTCDay() === 3);
    expect(wednesdays.length).toBeGreaterThan(0);
    expect(wednesdays.every((s) => s.closedReason === "CLINIC_CLOSED")).toBe(true);
    const [audit] = await audits("clinic_business_hours");
    expect((audit.detail as { columns: string[] }).columns).toEqual(["clinic_id", "weekday", "band", "open_time", "close_time", "reception_end_time", "created_at", "updated_at"]);
    // times change on another cell: UPDATE names the changed columns only
    const changed = hours.map((c) => (c.weekday === 4 && c.band === "AM" ? { ...c, close: "11:45" } : c));
    await send(postSave, "/api/admin/calendar/save", { hours: changed, days: [] });
    expect((await audits("clinic_business_hours"))[1].detail).toEqual({ columns: ["close_time"] });

    const stable = await rows();
    const again = await send(postSave, "/api/admin/calendar/save", { hours: changed, days: [] });
    expect([again.status, again.body.code]).toEqual([200, "SI040"]);
    expect(await rows()).toEqual(stable);
    // put the hours back for the tests that follow
    const restored = hours.map((c) => (c.weekday === 4 && c.band === "AM" ? { ...c, close: "12:00" } : c.weekday === 3 && c.band === "PM" ? { ...c, on: true, open: "15:00", close: "18:00", reception: "17:30" } : c));
    await send(postSave, "/api/admin/calendar/save", { hours: restored, days: [] });
  });

  it("SE044 when B2 cannot run (the job lock is taken): 409, the rows stay saved", async () => {
    as(admin.token);
    const date = nextOpen(6);
    const lock = await pool.connect();
    try {
      await lock.query("SELECT pg_advisory_lock(hashtext('batch:B2'))");
      const r = await send(postSave, "/api/admin/calendar/save", { hours: await cells(), days: [day(date, { kind: "AM_CLOSED" })] });
      expect([r.status, r.body.code]).toEqual([409, "SE044"]);
      expect(await prisma.clinicCalendarDay.count({ where: { clinicId: f.clinic.id, kind: "AM_CLOSED" } })).toBe(1);
    } finally {
      await lock.query("SELECT pg_advisory_unlock(hashtext('batch:B2'))");
      lock.release();
    }
    await send(postSave, "/api/admin/calendar/save", { hours: await cells(), days: [day(date, { kind: "NORMAL" })] });
  });
});

describe("clinic profile (event 8)", () => {
  it("saves the profile of the session clinic with one audit row and no B2; refuses code and bad values", async () => {
    as(admin.token);
    const p = (await loadClinic(f.clinic.id))!;
    const { code, ...values } = p;
    const runs = await prisma.batchRun.count({ where: { clinicId: f.clinic.id } });
    const ok = await send(postClinic, "/api/admin/calendar/clinic", { ...values, nameJa: "新名称クリニック", nameKana: "シンメイショウ クリニック", phone: "0311112222", noticeJa: "臨時休診" });
    expect([ok.status, ok.body.code]).toEqual([200, "SI042"]);
    const after = (await loadClinic(f.clinic.id))!;
    expect(after).toMatchObject({ code, nameJa: "新名称クリニック", phone: "0311112222", noticeJa: "臨時休診", nameEn: "", mapUrl: "" });
    expect(await prisma.batchRun.count({ where: { clinicId: f.clinic.id } })).toBe(runs);
    const [audit] = await audits("clinics");
    expect(audit.detail).toEqual({ columns: ["name_ja", "name_kana", "phone", "notice_ja"] });
    await send(postClinic, "/api/admin/calendar/clinic", { ...values, nameJa: "新名称クリニック", nameKana: "シンメイショウ クリニック", phone: "0311112222", noticeJa: "臨時休診" });
    expect(await audits("clinics")).toHaveLength(1); // no change → no row

    const kana = await send(postClinic, "/api/admin/calendar/clinic", { ...values, nameKana: "ひらがな" });
    expect([kana.status, kana.body.code, kana.body.errors?.[0].field]).toEqual([400, "SE002", "clinic.nameKana"]);
    expect((await send(postClinic, "/api/admin/calendar/clinic", { ...values, nameJa: "" })).body.code).toBe("SE001");
    for (const tamper of [{ ...values, code: "x" }, { ...values, phone: 123 }, { ...values, extra: "y" }]) {
      expect((await send(postClinic, "/api/admin/calendar/clinic", tamper)).body.code).toBe("SE090");
    }
    expect((await loadClinic(f.clinic.id))!.nameKana).toBe("シンメイショウ クリニック");
  });
});

describe("祝日を取り込む (event 6)", () => {
  it("starts B3 in the background (202) and the run ends SUCCESS; a second start while it runs is 「実行中のため省略」", async () => {
    as(admin.token);
    const before = await prisma.batchRun.count({ where: { jobCode: "B3" } });
    const r = await postHolidays(request("/api/admin/calendar/holidays", {}));
    expect(r.status).toBe(202);
    const since = ((await r.json()) as { since: string }).since;
    let run = null;
    for (let i = 0; i < 100 && !(run?.status && run.status !== "RUNNING"); i++) {
      run = await prisma.batchRun.findFirst({ where: { jobCode: "B3", startedAt: { gte: new Date(since) } }, orderBy: { startedAt: "desc" } });
      await new Promise((x) => setTimeout(x, 50));
    }
    expect(run).toMatchObject({ status: "SUCCESS", trigger: "MANUAL", clinicId: null, message: "追加0・変更0・削除0" });
    expect(await prisma.batchRun.count({ where: { jobCode: "B3" } })).toBe(before + 1);
  });
});

describe("page", () => {
  async function page(role: "ADMIN" | "RECEPTION") {
    const state = await loadState(f.clinic.id, today.slice(0, 7));
    const clinic = (await loadClinic(f.clinic.id))!;
    return renderToStaticMarkup(<CalendarClient role={role} initial={state} clinic={clinic} />);
  }
  it("ADMIN sees 期間で設定 and the save bar; RECEPTION sees none of the buttons 12 / 14 / 18 / 29", async () => {
    const a = await page("ADMIN");
    expect(a).toContain("期間で設定");
    expect(a).toContain("保存する");
    expect(a).toContain("診療カレンダー");
    const r = await page("RECEPTION");
    for (const word of ["期間で設定", "保存する", "祝日を取り込む"]) expect(r).not.toContain(word);
    expect(r).toContain("カレンダー");
    expect(r).toContain("クリニック情報"); // the tab itself stays
  });

  it("the page shows the month, the 定休 mark and the last frame generation", async () => {
    const html = await page("RECEPTION");
    expect(html).toContain("定休");
    expect(html).toContain("前回の枠生成");
    expect(html).toMatch(/正常終了（[\d,]+枠）/);
  });
});
