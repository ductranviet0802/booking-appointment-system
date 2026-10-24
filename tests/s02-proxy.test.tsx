// S02 代理予約: access, patient search (Q2 rules, 100 rows, merged hidden), selection audit, lists and grid (SE022 / SE023, own frames free),
// confirmation in one transaction (new patient + 診察券 + booking, SW020 / SW021 answered with nothing written, SE020 rolls the patient back,
// SE021, SE030, change mode with version and 要調整 cleared, doctor-only reassignment without NT-03).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { addDays, dbDate, dbTime, todayJst } from "@/lib/datetime";
import { pool, prisma } from "@/lib/prisma";
import { cleanupStaff, makeStaff, request } from "./a03-helpers";
import { fixture, type Fixture } from "./b2-helpers";

process.env.NOTIFY_OUTBOX_DIR = mkdtempSync(path.join(tmpdir(), "s02-outbox-"));
const mockJar: { sid?: string } = {};
jest.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sid" && mockJar.sid ? { value: mockJar.sid } : undefined) }),
  headers: async () => ({ get: () => null }),
}));
jest.mock("../app/(staff)/staff/booking/booking.module.css", () => new Proxy({}, { get: (_t, k) => String(k) }));
jest.mock("@/components/ui/Toast", () => ({ useToast: () => ({ toast: jest.fn() }), useLang: () => "ja" }));
jest.mock("@/lib/client/api", () => ({ useApiFetch: () => jest.fn(), postJson: jest.fn(), openStaffErrorScreen: jest.fn() }));

import { POST } from "@/app/api/staff/booking/[action]/route";
import { ProxyClient } from "@/app/(staff)/staff/booking/ProxyClient";
import { loadPreset, type Preset } from "@/lib/staff/proxy";
import { checkNewPatient, checkSearch } from "@/lib/staff/proxy-rules";

jest.setTimeout(120_000);
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const DAY = addDays(todayJst(), 6);
let f: Fixture;
let foreign: Fixture;
let reception: Awaited<ReturnType<typeof makeStaff>>;
let doctor: Awaited<ReturnType<typeof makeStaff>>;
let runId: string;
const slotIds: Record<string, string> = {};
const extra: string[] = [];

beforeAll(async () => {
  f = await fixture({ doctors: 2 });
  foreign = await fixture({ doctors: 1 });
  reception = await makeStaff("RECEPTION", { clinics: [f.clinic.code] });
  doctor = await makeStaff("DOCTOR", { clinics: [f.clinic.code] });
  runId = (await prisma.batchRun.create({
    data: { jobCode: "B2", trigger: "MANUAL", clinicId: f.clinic.id, startedAt: new Date(), endedAt: new Date(), status: "SUCCESS", readCount: 0, writtenCount: 0, errorCount: 0 },
  })).id;
  for (const [i, d] of f.doctors.entries()) {
    for (const [k, start] of ["09:00", "09:15", "09:30", "09:45", "10:00", "10:15", "10:30"].entries()) {
      const mins = Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + 15;
      const end = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
      const s = await prisma.slot.create({
        data: {
          clinicId: f.clinic.id, departmentId: f.dept.id, doctorId: d.id, slotDate: dbDate(DAY), startTime: dbTime(start), endTime: dbTime(end),
          capacity: 1, status: "OPEN", generatedRunId: runId,
        },
      });
      slotIds[`${i}-${k}`] = s.id;
    }
  }
});

afterAll(async () => {
  await foreign.cleanup().catch(() => undefined);
  await f.cleanup().catch(() => undefined);
  await prisma.patientCard.deleteMany({ where: { patientId: { in: extra } } });
  await prisma.patient.deleteMany({ where: { id: { in: extra } } });
  await prisma.patientCard.deleteMany({ where: { patient: { familyName: "代理試験" } } });
  await prisma.patient.deleteMany({ where: { familyName: "代理試験" } });
  await cleanupStaff();
  await prisma.$disconnect();
  await pool.end();
});

const as = (token?: string) => { mockJar.sid = token; };
async function call(action: string, body: unknown) {
  const res = await POST(request(`/api/staff/booking/${action}`, body), { params: Promise.resolve({ action }) } as never);
  return { status: res.status, body: (await res.json()) as Json };
}
let seq = 0;
async function person(o: { kana?: string; phone?: string; merged?: boolean; anon?: boolean; card?: string; clinic?: Fixture } = {}) {
  const p = await prisma.patient.create({
    data: {
      nameType: "JP", familyName: "代理試験", givenName: `太郎${++seq}`, familyNameKana: o.kana ?? "ダイリシケン", givenNameKana: "タロウ", birthDate: dbDate("1980-02-03"),
      sex: "MALE", postcode: "1000001", prefecture: "東京都", city: "千代田区", addressLine: "1-1", phone: o.phone ?? "09011112222", createdByKind: "STAFF",
      ...(o.anon && { anonymizedAt: new Date() }),
    },
  });
  extra.push(p.id);
  if (o.merged) await prisma.patient.update({ where: { id: p.id }, data: { mergedIntoId: (await person()).id } });
  if (o.card) await prisma.patientCard.create({ data: { patientId: p.id, clinicId: (o.clinic ?? f).clinic.id, cardNo: o.card, enteredByKind: "STAFF", confirmedAt: new Date() } });
  return p;
}
const book = (patientId: string, o: Json = {}) => ({
  patientId, departmentId: f.dept.id, visitTypeId: f.visitType.id, date: DAY, startTime: "09:00", doctorId: f.doctors[0].id, doctorSel: "", channel: "PHONE", notes: "",
  ...o,
});
const NEW = {
  nameType: "JP", familyName: "代理試験", givenName: "新患", familyNameKana: "ダイリシケン", givenNameKana: "シンカン", birthDate: "1950/05/08", sex: "2",
  postcode: "1000005", prefecture: "東京都", city: "千代田区", town: "丸の内", addressLine: "3-4-5", building: "", phone: "03-5555-0101", smsOptIn: false, cardNo: "",
};

describe("rules (4.2)", () => {
  it("search: nothing filled SE001 検索条件; hiragana is normalised; format errors; booking number via F7-02", () => {
    expect(checkSearch({ kana: "  ", phone: "" }).errors).toEqual([{ field: "search", code: "SE001", params: { 項目: "検索条件" } }]);
    expect(checkSearch({ kana: "やまだ たろう" }).input.kana).toEqual(["ヤマダ", "タロウ"]);
    expect(checkSearch({ kana: "yamada" }).errors[0]).toMatchObject({ code: "SE002" });
    expect(checkSearch({ phone: "０９０-1234-5678" }).input.phone).toBe("09012345678");
    expect(checkSearch({ phone: "09a" }).errors[0].code).toBe("SE002");
    expect(checkSearch({ card: "a".repeat(21) }).errors[0]).toMatchObject({ code: "SE003", params: { n: 20 } });
    expect(checkSearch({ bookingNo: "ｋｘｙｚ－１２３４" }).input.bookingNo).toBe("KXYZ1234");
    expect(checkSearch({ bookingNo: "IOIO1234" }).errors[0].code).toBe("SE002");
  });
  it("new patient: required / format / length per item; ROMAJI rules; tampering", () => {
    const ok = checkNewPatient(NEW);
    expect(ok.tampered === false && ok.errors).toEqual([]);
    const bad = checkNewPatient({ ...NEW, familyName: "", givenName: "x".repeat(51), familyNameKana: "ひらがな", birthDate: "2999/01/01", sex: "", postcode: "123", phone: "1", cardNo: "あ" });
    expect(bad.tampered === false && bad.errors.map((e) => `${e.field}:${e.code}`)).toEqual([
      "familyName:SE001", "givenName:SE003", "familyNameKana:SE002", "birthDate:SE002", "sex:SE001", "postcode:SE002", "phone:SE002", "cardNo:SE002",
    ]);
    const rom = checkNewPatient({ ...NEW, nameType: "ROMAJI", familyName: "Suzuki", givenName: "鈴", familyNameKana: "free text" });
    expect(rom.tampered === false && rom.errors.map((e) => e.field)).toEqual(["givenName"]);
    expect(checkNewPatient({ ...NEW, sex: "9" }).tampered).toBe(true);
    expect(checkNewPatient({ ...NEW, prefecture: "火星" }).tampered).toBe(true);
  });
});

describe("access", () => {
  it("a DOCTOR gets 403 SE091 on every action and nothing is written; no session 401", async () => {
    as(doctor.token);
    const before = await prisma.booking.count();
    for (const a of ["search", "select", "options", "confirm"]) expect(await call(a, {})).toEqual({ status: 403, body: { code: "SE091", params: {} } });
    expect(await prisma.booking.count()).toBe(before);
    as(undefined);
    expect((await call("search", { kana: "あ" })).status).toBe(401);
    as(reception.token);
    expect((await call("nope", {})).status).toBe(404);
  });
});

describe("search and selection", () => {
  it("AND of the conditions, group-wide patients, 診察券 of this clinic only, merged and anonymised hidden, selection audited", async () => {
    as(reception.token);
    const a = await person({ kana: "ケンサクイチ", phone: "09033334444", card: "S02-A1" });
    await person({ kana: "ケンサクイチ", phone: "09033334444", merged: true });
    await person({ kana: "ケンサクイチ", anon: true });
    const other = await person({ kana: "ケンサクニ", card: "S02-A1", clinic: foreign });
    const r = await call("search", { kana: "けんさくいち", phone: "090-3333-4444" });
    expect(r.body.rows.map((x: Json) => x.id)).toEqual([a.id]);
    expect(r.body.rows[0]).toMatchObject({ phone: "090-3333-4444", card: "S02-A1", web: false, birth: "1980/02/03" });
    expect((await call("search", { card: "S02-A1" })).body.rows.map((x: Json) => x.id)).toEqual([a.id]); // other.card is of another clinic
    expect((await call("search", { kana: "ケンサクニ" })).body.rows[0]).toMatchObject({ id: other.id, card: "" }); // card of another clinic not shown
    expect((await call("search", { kana: "ケンサク", phone: "00000000000" })).body.rows).toEqual([]); // AND
    expect((await call("search", {})).body).toMatchObject({ code: "SE001" });
    const sel = await call("select", { patientId: a.id });
    expect(sel.body.patient).toMatchObject({ name: "代理試験 太郎" + sel.body.patient.name.slice(-1), card: "S02-A1", age: expect.any(Number), target: "なし" }); // no account, sms_opt_in off (Q9)
    expect(await prisma.auditLog.count({ where: { action: "PATIENT_VIEW", targetId: a.id, targetType: "patient" } })).toBe(1);
    expect((await call("select", { patientId: "11111111-1111-4111-8111-111111111111" })).body.code).toBe("SE090");
  });

  it("more than 100 rows: the first 100 and more = true (SI034)", async () => {
    await prisma.patient.createMany({
      data: Array.from({ length: 101 }, (_, i) => ({
        nameType: "JP" as const, familyName: "代理試験", givenName: `多${i}`, familyNameKana: "タスウケンサク", givenNameKana: "タロウ", birthDate: dbDate("1990-01-01"),
        sex: "MALE" as const, postcode: "1000001", prefecture: "東京都", city: "千代田区", addressLine: "1-1", phone: "09000000001", createdByKind: "STAFF" as const,
      })),
    });
    as(reception.token);
    const r = await call("search", { kana: "タスウケンサク" });
    expect(r.body.rows).toHaveLength(100);
    expect(r.body.more).toBe(true);
  });
});

describe("options", () => {
  it("SE022 outside the window (past too), SE023 for a day without frames, the grid marks full cells", async () => {
    as(reception.token);
    const opt = (o: Json) => call("options", { departmentId: f.dept.id, date: DAY, ...o });
    expect((await opt({ date: addDays(todayJst(), -1) })).body.options.notice).toEqual({ code: "SE022", params: { n: 30 } });
    expect((await opt({ date: addDays(todayJst(), 31) })).body.options.notice.code).toBe("SE022");
    expect((await opt({ date: addDays(todayJst(), 7) })).body.options.notice).toEqual({ code: "SE023" });
    expect((await opt({ date: "x" })).body.code).toBe("SE002");
    expect((await opt({ departmentId: foreign.dept.id })).status).toBe(400); // not a department of the clinic
    const r = (await opt({})).body.options;
    expect(r.visitTypes).toEqual([{ id: f.visitType.id, name: "再診", frames: 1, minutes: 15 }]);
    expect(r.doctors.map((d: Json) => d.id)).toEqual(f.doctors.map((d) => d.id));
    expect(r.grid.times).toHaveLength(7);
    expect(r.grid.columns[0].cells.every((c: Json) => c.state === "free")).toBe(true);
    expect((await opt({ doctorId: f.doctors[1].id })).body.options.grid.columns).toHaveLength(1);
    expect((await opt({ doctorId: foreign.doctors[0].id })).body.options.doctorId).toBe(""); // Q4 d
  });
});

describe("confirm", () => {
  it("existing patient under 指名なし: the doctor of the column is assigned, doctor_requested false, channel PHONE, staff recorded, NT-01", async () => {
    as(reception.token);
    const r = await call("confirm", book(f.patient.id, { notes: "付き添いあり" }));
    expect(r.status).toBe(200);
    const b = await prisma.booking.findFirstOrThrow({ where: { bookingNo: r.body.bookingNo }, include: { events: true } });
    expect(b).toMatchObject({ doctorId: f.doctors[0].id, doctorRequested: false, channel: "PHONE", bookedByAccountId: reception.account.id, status: "RESERVED", version: 0 });
    expect(b.events.map((e) => [e.event, e.actorKind, e.channel])).toEqual([["CREATED", "STAFF", "PHONE"]]);
    expect(await prisma.auditLog.count({ where: { action: "BOOKING_UPDATE", targetId: b.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { bookingId: b.id, event: "NT01_BOOKED" } })).toBe(1);
    expect((await prisma.slot.findUniqueOrThrow({ where: { id: slotIds["0-0"] } })).reservedCount).toBe(1);
    expect(r.body).toMatchObject({ date: DAY, changed: false });
  });

  it("SE020 for a taken frame rolls back the new patient; SE021 overlap; SW020 dialog then override; SE022 / SE023 from the core", async () => {
    as(reception.token);
    const patients = await prisma.patient.count();
    const taken = await call("confirm", { ...book("", { patientId: undefined }), newPatient: NEW, ackNoTarget: true });
    expect(taken.body.code).toBe("SE020"); // 09:00 of doctor 0 is held by the previous test
    expect(await prisma.patient.count()).toBe(patients);
    const p = await person();
    const first = await call("confirm", book(p.id, { startTime: "09:15", doctorId: f.doctors[1].id, ackNoTarget: true, doctorSel: f.doctors[1].id }));
    expect(first.status).toBe(200);
    expect((await prisma.booking.findFirstOrThrow({ where: { bookingNo: first.body.bookingNo } })).doctorRequested).toBe(true); // a named doctor
    const overlap = await call("confirm", book(p.id, { startTime: "09:15", doctorId: f.doctors[0].id, overrideLimit: true, ackNoTarget: true }));
    expect(overlap.body.code).toBe("SE021"); // never overridable
    const dlg = await call("confirm", book(p.id, { startTime: "09:45", ackNoTarget: true }));
    expect(dlg.body).toMatchObject({ dialog: "SW020", nos: [first.body.bookingNo] });
    expect(await prisma.booking.count({ where: { patientId: p.id } })).toBe(1);
    const yes = await call("confirm", book(p.id, { startTime: "09:45", ackNoTarget: true, overrideLimit: true }));
    expect(yes.status).toBe(200);
    expect(await prisma.booking.count({ where: { patientId: p.id } })).toBe(2);
    expect((await call("confirm", book(p.id, { date: addDays(todayJst(), 40) }))).body.code).toBe("SE022");
    expect((await call("confirm", book(p.id, { date: addDays(todayJst(), 7), ackNoTarget: true }))).body.code).toBe("SE020"); // no frames: nothing to hold
  });

  it("new patient: SW021 first (nothing written), then registered with 診察券 and booked in one transaction; SMS target with consent", async () => {
    as(reception.token);
    const patients = await prisma.patient.count();
    const dialog = await call("confirm", { ...book("", { patientId: undefined, startTime: "10:00" }), newPatient: { ...NEW, cardNo: "S02-NEW1" } });
    expect(dialog.body).toMatchObject({ ok: true, dialog: "SW021" });
    expect(await prisma.patient.count()).toBe(patients);
    expect(await prisma.patientCard.count({ where: { cardNo: "S02-NEW1" } })).toBe(0);
    const ok = await call("confirm", { ...book("", { patientId: undefined, startTime: "10:00" }), newPatient: { ...NEW, cardNo: "S02-NEW1" }, ackNoTarget: true });
    expect(ok.status).toBe(200);
    const b = await prisma.booking.findFirstOrThrow({ where: { bookingNo: ok.body.bookingNo }, include: { patient: { include: { cards: true } } } });
    expect(b.patient).toMatchObject({ accountId: null, relation: null, createdByKind: "STAFF", phone: "0355550101", smsOptIn: false, sex: "FEMALE", postcode: "1000005" });
    expect(b.patient.cards[0]).toMatchObject({ clinicId: f.clinic.id, cardNo: "S02-NEW1", enteredByKind: "STAFF" });
    expect(b.patient.cards[0].confirmedAt).not.toBeNull();
    expect(await prisma.notification.count({ where: { bookingId: b.id } })).toBe(0); // no target (Q9)
    // duplicate 診察券 at this clinic → SE030, patient not inserted
    const n = await prisma.patient.count();
    expect((await call("confirm", { ...book("", { patientId: undefined, startTime: "09:30" }), newPatient: { ...NEW, cardNo: "S02-NEW1" }, ackNoTarget: true })).body.code).toBe("SE030");
    expect(await prisma.patient.count()).toBe(n);
    // oral SMS consent → NT-01 by SMS, no dialog; the doctor name placeholder is 指名なし
    const sms = await call("confirm", { ...book("", { patientId: undefined, startTime: "09:30" }), newPatient: { ...NEW, smsOptIn: true } });
    expect(sms.status).toBe(200);
    const nt = await prisma.notification.findFirstOrThrow({ where: { booking: { bookingNo: sms.body.bookingNo } } });
    expect(nt).toMatchObject({ event: "NT01_BOOKED", channel: "SMS", toAddress: "+81355550101", language: "JA", accountId: null });
    // field errors, tampering
    const fe = await call("confirm", { ...book("", { patientId: undefined }), newPatient: { ...NEW, familyName: "" } });
    expect(fe.body.errors).toEqual([{ field: "familyName", code: "SE001", params: { 項目: "姓" } }]);
    expect((await call("confirm", { ...book("", { patientId: undefined }), newPatient: { ...NEW, sex: "7" } })).body.code).toBe("SE090");
    expect((await call("confirm", book(f.patient.id, { channel: "WEB" }))).body.code).toBe("SE090");
    expect((await call("confirm", book(f.patient.id, { channel: "", notes: "x".repeat(201) }))).body.errors.map((e: Json) => e.field)).toEqual(["channel", "notes"]);
    expect((await call("confirm", book(f.patient.id, { visitTypeId: foreign.visitType.id }))).body.code).toBe("SE090");
  });
});

describe("change mode", () => {
  it("opens RESERVED bookings of the clinic only; confirm moves the frames, clears 要調整, SE010 on a stale version, doctor-only reassignment sends no NT-03", async () => {
    as(reception.token);
    const p = await person({ phone: "09055556666" });
    const created = await call("confirm", book(p.id, { date: DAY, startTime: "10:00", doctorId: f.doctors[1].id, ackNoTarget: true, channel: "COUNTER" }));
    const b = await prisma.booking.findFirstOrThrow({ where: { bookingNo: created.body.bookingNo } });
    await prisma.booking.update({ where: { id: b.id }, data: { adjustRequiredAt: new Date() } });
    const session = await prisma.session.findFirstOrThrow({ where: { accountId: reception.account.id } });
    const actor = { accountId: reception.account.id, role: "RECEPTION" as const, clinicId: f.clinic.id, allClinics: false, sessionId: session.id, ip: null, now: new Date() };
    const preset = (await loadPreset(actor, { bookingId: b.id })) as Preset;
    expect(preset.change).toMatchObject({ bookingNo: b.bookingNo, version: 0, start: "10:00", doctorId: "", channel: "COUNTER", departmentId: f.dept.id });
    expect(await loadPreset(actor, { bookingId: (await prisma.booking.create({ data: { bookingNo: "ZZZZ0001", clinicId: foreign.clinic.id, departmentId: foreign.dept.id, visitTypeId: foreign.visitType.id, doctorId: foreign.doctors[0].id, doctorRequested: true, patientId: p.id, channel: "PHONE", slotDate: dbDate(DAY), startTime: dbTime("09:00"), endTime: dbTime("09:15") } })).id })).toBe("ER03");
    expect(await loadPreset(actor, { bookingId: "nope" })).toBe("ER02");
    expect(await loadPreset(actor, { patientId: "11111111-1111-4111-8111-111111111111" })).toBe("ER02");
    // own frames show free in change mode
    const grid = (await call("options", { departmentId: f.dept.id, date: DAY, bookingId: b.id })).body.options.grid;
    expect(grid.columns[1].cells.find((c: Json) => c.start === "10:00").state).toBe("free");
    expect((await call("options", { departmentId: f.dept.id, date: DAY })).body.options.grid.columns[1].cells.find((c: Json) => c.start === "10:00").state).toBe("full");

    const change = (o: Json) => call("confirm", { bookingId: b.id, version: 0, departmentId: f.dept.id, visitTypeId: f.visitType.id, date: DAY, startTime: "10:00", doctorId: f.doctors[1].id, doctorSel: "", channel: "COUNTER", notes: "", ackNoTarget: true, ...o });
    expect((await change({ version: 7 })).body.code).toBe("SE010");
    const moved = await change({ startTime: "10:15" });
    expect(moved.body).toMatchObject({ ok: true, changed: true, bookingNo: b.bookingNo });
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: b.id }, include: { events: { orderBy: { id: "asc" } } } });
    expect(after).toMatchObject({ doctorId: f.doctors[1].id, version: 1, changeCount: 1, adjustRequiredAt: null, channel: "COUNTER", doctorRequested: false });
    expect(after.events.map((e) => e.event)).toEqual(["CREATED", "CHANGED", "ADJUST_CLEARED"]);
    expect((await prisma.slot.findUniqueOrThrow({ where: { id: slotIds["1-4"] } })).reservedCount).toBe(0);
    expect((await prisma.slot.findUniqueOrThrow({ where: { id: slotIds["1-5"] } })).reservedCount).toBe(1);
    // doctor-only reassignment of a 指名なし booking (same day and time): no NT-03
    const nt = () => prisma.notification.count({ where: { bookingId: b.id, event: "NT03_CHANGED" } });
    const before = await nt();
    const swap = await change({ version: 1, startTime: "10:15", doctorId: f.doctors[0].id });
    expect(swap.status).toBe(200);
    expect(await nt()).toBe(before);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).doctorId).toBe(f.doctors[0].id);
    // a booking that is no longer RESERVED → SE010
    await prisma.booking.update({ where: { id: b.id }, data: { status: "CHECKED_IN" } });
    expect((await change({ version: 2 })).body.code).toBe("SE010");
    await prisma.booking.deleteMany({ where: { bookingNo: "ZZZZ0001" } });
  });

  it("the screen renders the change target, the fixed read-only selects and 「変更を確定する」", async () => {
    const preset: Preset = {
      clinicName: "x", today: todayJst(), windowDays: 30, date: DAY, departments: [{ id: f.dept.id, name: "試験科" }],
      patient: { id: "p", name: "代理試験 太郎", kana: "ダイリシケン タロウ", birth: "1980/02/03", age: 46, card: "A1", target: "SMS" },
      change: { bookingId: "b", bookingNo: "ABCD1234", version: 0, date: DAY, start: "09:30", end: "09:45", departmentId: f.dept.id, visitTypeId: f.visitType.id, doctorId: "", channel: "PHONE", notes: "" },
    };
    const html = renderToStaticMarkup(<ProxyClient preset={preset} />);
    expect(html).toContain("変更を確定する");
    expect(html).toContain("変更対象: ABCD-1234");
    expect(html).toContain("診察券 A1");
    expect(html).toContain("<h1>代理予約</h1><span>変更</span>");
    const fresh = renderToStaticMarkup(<ProxyClient preset={{ ...preset, patient: null, change: null }} />);
    expect(fresh).toContain("既存患者を検索");
    expect(fresh).toContain("<fieldset disabled=\"\"");
    expect(fresh).toContain("予約を確定する");
  });
});
