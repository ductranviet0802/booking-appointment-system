// spec-screen: P11 — availability (markers, consecutive frames, 指名なし union, cut-off, change mode own frames), the
// read-only rule check of event 11 and its order, event 10 (anonymous selections kept, T010 restore), event 11 (§4.2
// server re-check, tampered person → ER-01, the draft and the next screen), initial display (T036 tampered, change mode
// of another account's booking → ER-01, a cancelled booking → P16, return messages), the draft store (owner, expiry).
jest.mock("next/headers", () => ({
  cookies: async () => {
    const w = globalThis as unknown as { w1jar?: { sid?: string }; w1als?: { getStore(): string | undefined } };
    const sid = w.w1als?.getStore() ?? w.w1jar?.sid;
    return { get: (n: string) => (n === "sid" && sid ? { value: sid } : undefined) };
  },
  headers: async () => ({ get: () => null }),
}));
process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GET as options } from "@/app/api/booking/options/route";
import { POST as next } from "@/app/api/booking/next/route";
import { POST as discard } from "@/app/api/booking/discard/route";
import { createBooking, cancelBooking } from "@/lib/booking/core";
import { DRAFT_TTL_MS, getDraft, putDraft, EMPTY_SELECTIONS } from "@/lib/booking/draft";
import { addDays, todayJst } from "@/lib/datetime";
import { checkChoice } from "@/lib/entry/check";
import { daysOf, type Frame } from "@/lib/entry/data";
import { loadEntry } from "@/lib/entry/pages";
import { pool, prisma } from "@/lib/prisma";
import { cleanup, DAY, draftOf, holder, member, req, setup, type Setup } from "./w1-helpers";

process.env.NOTIFY_OUTBOX_DIR = mkdtempSync(path.join(tmpdir(), "p11-outbox-"));
jest.setTimeout(90_000);
let S: Setup;

beforeAll(async () => {
  S = await setup();
});
afterAll(async () => {
  await cleanup(S.f).catch(() => undefined);
  await prisma.$disconnect();
  await pool.end();
});

const sel = (o: Record<string, unknown> = {}) => ({
  clinicId: S.f.clinic.id, departmentId: S.f.dept.id, visitTypeId: S.f.visitType.id, doctorId: S.f.doctors[0].id, date: DAY, start: "09:00", notes: "", ...o,
});
const q = (o: Record<string, string>) => `/api/booking/options?${new URLSearchParams({ clinic: S.f.clinic.id, department: S.f.dept.id, ...o })}`;

describe("P11 availability (抽出6–8, F4-02 / F4-04, Q10 / Q13 A)", () => {
  const f = (doctor: string, start: string, end: string, o: Partial<Frame> = {}): Frame =>
    ({ doctor_id: doctor, date: DAY, start, end, capacity: 1, reserved: 0, status: "OPEN", own: false, ...o });
  const opts = { today: todayJst(), now: new Date(), cutoffMinutes: 30 };

  it("a start needs n consecutive free frames of one doctor; 指名なし is the union; △ ≤ 20 % of frames; × full; — no OPEN frame", () => {
    const rows = [
      f("a", "09:00", "09:15"), f("a", "09:15", "09:30", { reserved: 1 }), f("a", "09:30", "09:45"), f("a", "09:45", "10:00"),
      f("b", "09:00", "09:15"), f("b", "09:15", "09:30"),
    ];
    expect(daysOf(rows.filter((r) => r.doctor_id === "a"), 2, opts)[DAY].starts).toEqual(["09:30"]);
    expect(daysOf(rows, 2, opts)[DAY].starts).toEqual(["09:00", "09:30"]); // b 09:00 + a 09:30, each once
    expect(daysOf(rows, 2, opts)[DAY].mark).toBe("free"); // 2 starts of 6 frames = 33 % > 20 %
  });

  it("marks: free / few / full / closed; a gap breaks a run; own frames count as free in change mode", () => {
    const ten = Array.from({ length: 10 }, (_, i) => f("a", `1${i}:00`, `1${i}:15`, { reserved: i === 0 ? 0 : 1 }));
    expect(daysOf(ten, 1, opts)[DAY]).toEqual({ mark: "few", starts: ["10:00"] });
    expect(daysOf([f("a", "09:00", "09:15", { reserved: 1 })], 1, opts)[DAY].mark).toBe("full");
    expect(daysOf([f("a", "09:00", "09:15", { status: "CLOSED" })], 1, opts)[DAY].mark).toBe("closed");
    expect(daysOf([f("a", "09:00", "09:15"), f("a", "09:30", "09:45")], 2, opts)[DAY].mark).toBe("full");
    expect(daysOf([f("a", "09:00", "09:15", { reserved: 1, own: true })], 1, opts)[DAY].starts).toEqual(["09:00"]);
  });

  it("same-day cut-off: today's starts before now + cut-off are not offered", () => {
    const today = todayJst();
    const rows = [{ ...f("a", "00:00", "00:15"), date: today }, { ...f("a", "23:45", "23:59"), date: today }];
    const late = new Date(`${today}T23:40:00+09:00`);
    expect(daysOf(rows, 1, { today, now: late, cutoffMinutes: 30 })[today]?.starts ?? []).toEqual([]);
  });

  it("options route: departments, types (no pre-selection anonymous), doctors with a free start, the window calendar", async () => {
    await S.frames(0, ["09:00", "09:15", "09:30"]);
    await S.frames(1, ["09:00"], { reserved: 1 });
    const dep = await (await options(req(q({ step: "departments" })))).json();
    expect(dep.departments.map((d: { id: string }) => d.id)).toEqual([S.f.dept.id]);
    const types = await (await options(req(q({ step: "types" })))).json();
    expect(types.types.map((t: { category: string }) => t.category)).toEqual(["FIRST", "REPEAT", "SELF_PAY"]);
    expect(types.preselect).toBeNull();
    const docs = await (await options(req(q({ step: "doctors", visitType: S.f.visitType.id })))).json();
    expect(docs.doctors.map((d: { id: string }) => d.id)).toEqual([S.f.doctors[0].id]); // doctor 1 is full
    const cal = await (await options(req(q({ step: "calendar", visitType: S.f.visitType.id, doctor: "" })))).json();
    expect(cal.min).toBe(todayJst());
    expect(cal.max).toBe(addDays(todayJst(), 30));
    expect(cal.days[DAY].starts).toEqual(["09:00", "09:15", "09:30"]);
    const two = await (await options(req(q({ step: "calendar", visitType: S.first.id, doctor: S.f.doctors[0].id })))).json();
    expect(two.days[DAY].starts).toEqual(["09:00", "09:15"]);
    expect((await options(req(q({ step: "calendar", visitType: "x" })))).status).toBe(400); // tampered → ER-02
  });

  it("options route: 初診 / 再診 pre-selection for the person (抽出5); another account's person or booking → 404 PE091", async () => {
    const h = await holder();
    const other = await holder();
    const types = await (await options(req(q({ step: "types", patient: h.self.id }), { as: h }))).json();
    expect(types.preselect).toBe(S.first.id); // no card, no CHECKED_IN → 初診
    await prisma.patientCard.create({ data: { patientId: h.self.id, clinicId: S.f.clinic.id, cardNo: `W1-${Date.now()}`, enteredByKind: "PATIENT" } });
    expect((await (await options(req(q({ step: "types", patient: h.self.id }), { as: h }))).json()).preselect).toBe(S.f.visitType.id);
    await prisma.patientCard.deleteMany({ where: { patientId: h.self.id } });
    expect((await options(req(q({ step: "types", patient: other.self.id }), { as: h }))).status).toBe(404);
    expect((await options(req(q({ step: "types", change: other.self.id }), { as: h }))).status).toBe(404);
  });
});

describe("P11 event 11 rules, read only (抽出11, order PE031 → PE032 → PE035 → PE030 → PE033 → PE034)", () => {
  it("window, closure, taken, limit, overlap; the booking being changed is excluded (Q7 A); nothing is written", async () => {
    const h = await holder();
    const c = (o: Record<string, unknown>) => ({ ...sel(o), patientId: h.self.id }) as Parameters<typeof checkChoice>[0];
    const far = addDays(todayJst(), 31);
    await S.frames(0, ["10:00"], { date: far });
    expect(await checkChoice(c({ date: far, start: "10:00" }), null, "ja")).toMatchObject({ code: "PE031", params: { n: 30 } });
    await S.frames(1, ["12:00"], { status: "CLOSED" });
    expect(await checkChoice(c({ doctorId: S.f.doctors[1].id, start: "12:00" }), null, "ja")).toMatchObject({ code: "PE035" });
    await S.frames(1, ["12:15"], { reserved: 1 });
    expect(await checkChoice(c({ doctorId: S.f.doctors[1].id, start: "12:15" }), null, "ja")).toMatchObject({ code: "PE030" });
    expect(await checkChoice(c({ doctorId: null, start: "13:59" }), null, "ja")).toMatchObject({ code: "PE030" }); // no frame at all

    await S.frames(0, ["11:00", "11:15"]);
    const booked = await createBooking({ ...c({ start: "11:00" }), doctorRequested: true, slotDate: DAY, startTime: "11:00", notes: null }, { kind: "PATIENT", accountId: h.acc.id, channel: "WEB" });
    if (!booked.ok) throw new Error("setup");
    const before = await prisma.booking.count({ where: { patientId: h.self.id } });
    expect(await checkChoice(c({ start: "11:15" }), null, "ja")).toMatchObject({ code: "PE033", params: { 氏名: `予約 ${h.self.givenName}` } });
    expect(await checkChoice(c({ start: "11:00" }), booked.bookingId, "ja")).toEqual({ ok: true }); // own frame free, own booking excluded
    expect(await checkChoice(c({ start: "11:15" }), booked.bookingId, "ja")).toEqual({ ok: true });
    expect(await prisma.booking.count({ where: { patientId: h.self.id } })).toBe(before);
    await cancelBooking({ bookingId: booked.bookingId, reasonCode: "SCHEDULE", reasonText: null }, { kind: "STAFF", accountId: S.f.admin.id, channel: "PHONE" });
  });
});

describe("P11 event 10 / 11 (POST /api/booking/next)", () => {
  it("anonymous: §4.2 re-check, then the selections are kept server-side and the answer is the login guard (T047)", async () => {
    const bad = await next(req("/api/booking/next", { body: { sel: sel({ date: null, notes: "あ".repeat(201) }), origin: "/" } }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).errors.map((e: { code: string }) => e.code)).toEqual(["PE037", "PE003"]);
    const res = await next(req("/api/booking/next", { body: { sel: sel({ notes: "頭痛" }), origin: `/clinics/${S.f.clinic.code}` } }));
    expect(res.status).toBe(200);
    expect((await res.json()).to).toBe(`/api/auth/guard?next=${encodeURIComponent("/booking/new?resume=1")}`);
    const id = draftOf(res)!;
    expect(getDraft(id, null)).toMatchObject({ kind: "ANON", sel: { clinicId: S.f.clinic.id, notes: "頭痛" } });

    // T010: after login the selections come back (no re-check, Q2 A), 本人 selected, the origin kept
    const h = await holder();
    const r = await loadEntry({ session: h.ctx, draftId: id, query: { resume: "1" }, lang: "ja" });
    expect(r.kind === "ok" && r.props.initial).toMatchObject({ patientId: h.self.id, clinicId: S.f.clinic.id, start: "09:00", notes: "頭痛" });
    expect(r.kind === "ok" && r.props.origin).toBe(`/clinics/${S.f.clinic.code}`);
  });

  it("logged in: a missing person with family → PE001; another account's person → 404 PE091; tampered ids → 400", async () => {
    const h = await holder();
    await member(h);
    const missing = await next(req("/api/booking/next", { body: { sel: sel({ patientId: null, visitTypeId: null }), origin: "/" }, as: h }));
    expect((await missing.json()).errors).toEqual([{ field: "person", code: "PE001" }, { field: "visitType", code: "PE001" }]);
    const other = await holder();
    const steal = await next(req("/api/booking/next", { body: { sel: sel({ patientId: other.self.id }), origin: "/" }, as: h }));
    expect([steal.status, (await steal.json()).code]).toEqual([404, "PE091"]);
    expect((await next(req("/api/booking/next", { body: { sel: sel({ clinicId: "1; drop" }), origin: "/" }, as: h }))).status).toBe(400);
  });

  it("logged in: a rule hit stays (409, the message); a pass makes the draft → P13 (再診) / P12 (初診)", async () => {
    const h = await holder();
    await S.frames(0, ["14:00", "14:15"]);
    await S.frames(1, ["14:00"], { reserved: 1 });
    const taken = await next(req("/api/booking/next", { body: { sel: sel({ patientId: h.self.id, doctorId: S.f.doctors[1].id, start: "14:00" }), origin: "/" }, as: h }));
    expect([taken.status, (await taken.json()).code]).toEqual([409, "PE030"]);
    expect(draftOf(taken)).toBeUndefined();

    const ok = await next(req("/api/booking/next", { body: { sel: sel({ patientId: h.self.id, start: "14:00" }), origin: "/bookings" }, as: h }));
    expect((await ok.json()).to).toBe("/booking/confirm");
    const d = getDraft(draftOf(ok), { accountId: h.acc.id, sessionId: h.ctx.sessionId })!;
    expect(d).toMatchObject({ kind: "DRAFT", origin: "/bookings", sel: { patientId: h.self.id, start: "14:00" }, change: null });
    expect(await prisma.booking.count({ where: { patientId: h.self.id } })).toBe(0); // P11 writes nothing (§8)

    const first = await next(req("/api/booking/next", { body: { sel: sel({ patientId: h.self.id, visitTypeId: S.first.id, start: "14:00" }), origin: "/" }, as: h }));
    expect((await first.json()).to).toBe("/booking/questionnaire");
  });

  it("T057: discard drops the draft and answers the origin screen", async () => {
    const h = await holder();
    const rec = putDraft({ kind: "DRAFT", accountId: h.acc.id, sessionId: h.ctx.sessionId, sel: EMPTY_SELECTIONS, origin: "/mypage/family", change: null, questionnaire: null, bookingId: null });
    const res = await discard(req("/api/booking/discard", { body: {}, draft: rec.id, as: h }));
    expect((await res.json()).to).toBe("/mypage/family");
    expect(getDraft(rec.id, { accountId: h.acc.id, sessionId: h.ctx.sessionId })).toBeNull();
  });
});

describe("P11 initial display (loadEntry) and the draft store", () => {
  it("T036 with another account's patient → ER-01; own family member preset; presets of T040 / T043 and the origin", async () => {
    const h = await holder();
    const other = await holder();
    const kid = await member(h);
    expect((await loadEntry({ session: h.ctx, draftId: undefined, query: { patient: other.self.id }, lang: "ja" })).kind).toBe("notFound");
    const r = await loadEntry({ session: h.ctx, draftId: undefined, query: { patient: kid.id }, lang: "ja" });
    expect(r.kind === "ok" && [r.props.initial.patientId, r.props.origin, r.props.persons.map((p) => p.relation)]).toEqual([kid.id, "/mypage/family", ["SELF", "CHILD"]]);
    const doc = await loadEntry({ session: null, draftId: undefined, query: { clinic: S.f.clinic.code, department: S.f.dept.code, doctor: S.f.doctors[0].id }, lang: "ja" });
    expect(doc.kind === "ok" && [doc.props.initial.clinicId, doc.props.initial.departmentId, doc.props.presetDoctorId, doc.props.origin])
      .toEqual([S.f.clinic.id, S.f.dept.id, S.f.doctors[0].id, `/doctors/${S.f.doctors[0].id}`]);
  });

  it("change mode: another account's booking → ER-01; a cancelled one → P16; own → fixed items, Q9 doctor, its notes", async () => {
    const h = await holder();
    const other = await holder();
    await S.frames(0, ["15:00"]);
    const b = await createBooking({ ...sel({ start: "15:00" }), patientId: h.self.id, doctorRequested: true, slotDate: DAY, startTime: "15:00", notes: "メモ" } as never, { kind: "PATIENT", accountId: h.acc.id, channel: "WEB" });
    if (!b.ok) throw new Error("setup");
    expect((await loadEntry({ session: other.ctx, draftId: undefined, query: {}, changeId: b.bookingId, lang: "ja" })).kind).toBe("notFound");
    const r = await loadEntry({ session: h.ctx, draftId: undefined, query: {}, changeId: b.bookingId, lang: "ja" });
    expect(r.kind === "ok" && r.props.initial).toMatchObject({ patientId: h.self.id, doctorId: S.f.doctors[0].id, notes: "メモ", date: null });
    expect(r.kind === "ok" && r.props.change).toMatchObject({ bookingNo: b.bookingNo, version: 0 });
    await cancelBooking({ bookingId: b.bookingId, reasonCode: "SCHEDULE", reasonText: null }, { kind: "STAFF", accountId: S.f.admin.id, channel: "PHONE" });
    expect(await loadEntry({ session: h.ctx, draftId: undefined, query: {}, changeId: b.bookingId, lang: "ja" })).toEqual({ kind: "redirect", to: `/bookings/${b.bookingId}` });
    expect((await loadEntry({ session: null, draftId: undefined, query: {}, changeId: b.bookingId, lang: "ja" })).kind).toBe("login");
  });

  it("return messages: PE030 de-selects the time (greyed), PE033 keeps all, PE036 clears all", async () => {
    const h = await holder();
    const owner = { accountId: h.acc.id, sessionId: h.ctx.sessionId };
    const d = putDraft({ kind: "DRAFT", ...owner, sel: { ...EMPTY_SELECTIONS, ...sel({ patientId: h.self.id }) }, origin: "/", change: null, questionnaire: null, bookingId: null });
    const load = (e: string) => loadEntry({ session: h.ctx, draftId: d.id, query: { resume: "1", e }, lang: "ja" });
    const taken = await load("PE030");
    expect(taken.kind === "ok" && [taken.props.initial.start, taken.props.lostStart, taken.props.error?.at]).toEqual([null, "09:00", "time"]);
    const limit = await load("PE033");
    expect(limit.kind === "ok" && [limit.props.initial.start, limit.props.error]).toEqual(["09:00", { code: "PE033", params: { 氏名: `予約 ${h.self.givenName}`, name: `予約 ${h.self.givenName}` }, at: "ops" }]);
    const gone = await load("PE036");
    expect(gone.kind === "ok" && [gone.props.initial.clinicId, gone.props.error?.at]).toEqual([null, "top"]);
  });

  it("a draft is the session's: another account or a later session reads it as missing; 30 min fixed from creation", async () => {
    const h = await holder();
    const other = await holder();
    const t0 = Date.now();
    const d = putDraft({ kind: "DRAFT", accountId: h.acc.id, sessionId: h.ctx.sessionId, sel: EMPTY_SELECTIONS, origin: "/", change: null, questionnaire: null, bookingId: null }, t0);
    expect(getDraft(d.id, { accountId: other.acc.id, sessionId: other.ctx.sessionId }, t0)).toBeNull();
    expect(getDraft(d.id, { accountId: h.acc.id, sessionId: "another-session" }, t0)).toBeNull();
    expect(getDraft(d.id, null, t0)).toBeNull();
    expect(getDraft(d.id, { accountId: h.acc.id, sessionId: h.ctx.sessionId }, t0 + DRAFT_TTL_MS - 1)).not.toBeNull();
    expect(getDraft(d.id, { accountId: h.acc.id, sessionId: h.ctx.sessionId }, t0 + DRAFT_TTL_MS)).toBeNull();
  });
});
