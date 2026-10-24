// spec-screen: P13 — the failure modes of 予約を確定する through the route, on the slot's real test database (no mocks
// of the core or of Prisma): double press, retry after a timeout (also after the core's in-process key is gone), two
// patients for the last seat (named doctor and 指名なし), the same person in two sessions, expired draft, another
// account's draft cookie, a tampered draft person, anonymous / staff callers, change mode with a booking staff changed or
// cancelled meanwhile (version), the change deadline, 初診 with its 問診, and the screens rendering their props.
jest.mock("next/headers", () => ({
  cookies: async () => {
    const w = globalThis as unknown as { w1jar?: { sid?: string }; w1als?: { getStore(): string | undefined } };
    const sid = w.w1als?.getStore() ?? w.w1jar?.sid;
    return { get: (n: string) => (n === "sid" && sid ? { value: sid } : undefined) };
  },
  headers: async () => ({ get: () => null }),
}));
jest.mock("../components/booking/entry.module.css", () => ({}));
jest.mock("../components/booking/questionnaire.module.css", () => ({}));
jest.mock("../components/booking/confirm.module.css", () => ({}));
process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import bcrypt from "bcrypt";
import { renderToStaticMarkup } from "react-dom/server";
import { POST as confirm } from "@/app/api/booking/confirm/route";
import { POST as next } from "@/app/api/booking/next/route";
import { POST as saveQ } from "@/app/api/booking/questionnaire/route";
import { BookingEntry } from "@/components/booking/BookingEntry";
import { ConfirmView } from "@/components/booking/ConfirmView";
import { QuestionnaireForm } from "@/components/booking/QuestionnaireForm";
import { ToastProvider } from "@/components/ui/Toast";
import { login } from "@/lib/auth/service";
import { changeBooking, createBooking, cancelBooking } from "@/lib/booking/core";
import { DRAFT_TTL_MS, EMPTY_SELECTIONS, getDraft, putDraft } from "@/lib/booking/draft";
import { decryptJson } from "@/lib/crypto/field";
import { addDays, dbDate, todayJst } from "@/lib/datetime";
import { loadConfirm, loadEntry, loadQuestionnaire } from "@/lib/entry/pages";
import { pool, prisma } from "@/lib/prisma";
import { cleanup, DAY, draftOf, holder, req, run, setup, type Holder, type Setup } from "./w1-helpers";

process.env.NOTIFY_OUTBOX_DIR = mkdtempSync(path.join(tmpdir(), "p13-outbox-"));
jest.setTimeout(120_000);
let S: Setup;
beforeAll(async () => { S = await setup(); });
afterAll(async () => {
  const staff = (await prisma.account.findMany({ where: { email: { contains: "w1staff" } }, select: { id: true } })).map((a) => a.id);
  await prisma.staffClinic.deleteMany({ where: { accountId: { in: staff } } });
  await prisma.session.deleteMany({ where: { accountId: { in: staff } } });
  await prisma.auditLog.deleteMany({ where: { accountId: { in: staff } } });
  await prisma.account.deleteMany({ where: { id: { in: staff } } });
  await cleanup(S.f).catch(() => undefined);
  await prisma.$disconnect();
  await pool.end();
});

const sel = (h: Holder, o: Record<string, unknown> = {}) => ({
  patientId: h.self.id, clinicId: S.f.clinic.id, departmentId: S.f.dept.id, visitTypeId: S.f.visitType.id, doctorId: S.f.doctors[0].id, date: DAY, start: "09:00", notes: "", ...o,
});
/** P11 event 11 through its route: the draft cookie of the answer */
async function draftFor(h: Holder, o: Record<string, unknown> = {}, change?: { bookingId: string; version: number }) {
  const res = await run(h, () => next(req("/api/booking/next", { body: { sel: sel(h, o), origin: "/", changeBookingId: change?.bookingId, version: change?.version }, as: h })));
  const body = await res.json();
  if (res.status !== 200) throw new Error(`draft: ${res.status} ${JSON.stringify(body)}`);
  return draftOf(res)!;
}
const press = (h: Holder, draft: string) => run(h, () => confirm(req("/api/booking/confirm", { body: {}, draft, as: h })));
const answer = async (res: Response) => [res.status, (await res.json()).to];
const reserved = async (start: string, doctor = 0) =>
  (await prisma.slot.findFirstOrThrow({ where: { doctorId: S.f.doctors[doctor].id, slotDate: dbDate(DAY), startTime: new Date(`1970-01-01T${start}:00Z`) } })).reservedCount;
const bookingsOf = (h: Holder) => prisma.booking.findMany({ where: { patientId: h.self.id, status: "RESERVED" } });

describe("one booking per draft (Q14 A, idempotency key = draft id)", () => {
  it("double press: two parallel confirms of one draft → one booking, both answers → the same P14", async () => {
    await S.frames(0, ["09:00"]);
    const h = await holder();
    const d = await draftFor(h);
    const [a, b] = await Promise.all([press(h, d), press(h, d)]);
    const [ra, rb] = [await answer(a), await answer(b)];
    expect(ra).toEqual(rb);
    expect(ra[0]).toBe(200);
    const list = await bookingsOf(h);
    expect(list).toHaveLength(1);
    expect(ra[1]).toBe(`/bookings/${list[0].id}/done`);
    expect(await reserved("09:00")).toBe(1);
    expect(await prisma.bookingEvent.count({ where: { bookingId: list[0].id } })).toBe(1);
    expect(await prisma.notification.count({ where: { bookingId: list[0].id } })).toBe(1);
  });

  it("retry after a timeout: a later confirm of the same draft → the same booking, even after the core forgot the key", async () => {
    await S.frames(0, ["09:15"]);
    const h = await holder();
    const d = await draftFor(h, { start: "09:15" });
    const first = await answer(await press(h, d));
    (globalThis as unknown as { bookingOnce?: Map<string, unknown> }).bookingOnce?.clear(); // e.g. the key aged out
    expect(await answer(await press(h, d))).toEqual(first);
    expect(await bookingsOf(h)).toHaveLength(1);
    // a reload of P13 after the commit lands on P14, not on a second confirm (T053)
    expect(await loadConfirm({ session: h.ctx, draftId: d, lang: "ja" })).toEqual({ kind: "redirect", to: first[1] });
  });
});

describe("concurrency on the last seat (slots_not_overbooked CHECK + row locks of the core)", () => {
  it("drafts hold no frame (F4-07): the second patient to confirm the frame both saw free is sent to the P11 time step", async () => {
    await S.frames(1, ["10:00"]);
    const [h1, h2] = [await holder(), await holder()];
    const [d1, d2] = [await draftFor(h1, { doctorId: S.f.doctors[1].id, start: "10:00" }), await draftFor(h2, { doctorId: S.f.doctors[1].id, start: "10:00" })];
    expect((await answer(await press(h1, d1)))[0]).toBe(200);
    expect(await answer(await press(h2, d2))).toEqual([409, "/booking/new?resume=1&e=PE030"]);
    expect(await reserved("10:00", 1)).toBe(1);
    expect(await bookingsOf(h2)).toHaveLength(0);
  });

  it("parallel: three 指名なし drafts for two doctors' last frames → two bookings, one PE030 (T054, draft kept for P11)", async () => {
    await S.frames(0, ["10:30"]);
    await S.frames(1, ["10:30"]);
    const hs = [await holder(), await holder(), await holder()];
    const ds: string[] = [];
    for (const h of hs) ds.push(await draftFor(h, { doctorId: null, start: "10:30" }));
    const res = await Promise.all(hs.map((h, i) => press(h, ds[i])));
    const answers = await Promise.all(res.map(answer));
    expect(answers.filter(([st]) => st === 200)).toHaveLength(2);
    const lost = answers.findIndex(([st]) => st === 409);
    expect(answers[lost][1]).toBe("/booking/new?resume=1&e=PE030");
    expect(getDraft(ds[lost], { accountId: hs[lost].acc.id, sessionId: hs[lost].ctx.sessionId })).toMatchObject({ bookingId: null }); // T054: selections kept
    expect([await reserved("10:30", 0), await reserved("10:30", 1)]).toEqual([1, 1]);
    const p11 = await loadEntry({ session: hs[lost].ctx, draftId: ds[lost], query: { resume: "1", e: "PE030" }, lang: "ja" });
    expect(p11.kind === "ok" && [p11.props.initial.start, p11.props.lostStart, p11.props.error?.code]).toEqual([null, "10:30", "PE030"]);
  });

  it("parallel, named doctor: two patients pressing at the same moment → exactly one booking", async () => {
    await S.frames(1, ["11:00"]);
    const [h1, h2] = [await holder(), await holder()];
    const [d1, d2] = [await draftFor(h1, { doctorId: S.f.doctors[1].id, start: "11:00" }), await draftFor(h2, { doctorId: S.f.doctors[1].id, start: "11:00" })];
    const res = await Promise.all([press(h1, d1), press(h2, d2)]);
    const answers = await Promise.all(res.map(answer));
    expect(answers.map(([st]) => st).sort()).toEqual([200, 409]);
    expect(answers.find(([st]) => st === 409)![1]).toBe("/booking/new?resume=1&e=PE030");
    expect(await reserved("11:00", 1)).toBe(1);
  });

  it("the same person in two sessions, two drafts for different doctors at the same time → one booking, the other PE033", async () => {
    await S.frames(0, ["11:30"]);
    await S.frames(1, ["11:30"]);
    const h = await holder();
    const again = await login({ ip: "203.0.113.12", userAgent: "jest", email: h.acc.email, password: "Test1234" });
    if (!again.ok || !again.session) throw new Error("login");
    const h2: Holder = { ...h, sid: again.session.token, ctx: { ...h.ctx, sessionId: again.session.sessionId } };
    const d1 = await draftFor(h, { start: "11:30" });
    const d2 = await draftFor(h2, { doctorId: S.f.doctors[1].id, start: "11:30" });
    const answers = await Promise.all([press(h, d1), press(h2, d2)].map((p) => p.then(answer)));
    expect(answers.map(([st]) => st).sort()).toEqual([200, 409]);
    expect(answers.find(([st]) => st === 409)![1]).toBe("/booking/new?resume=1&e=PE033"); // limit before overlap (P13 §4.2 order)
    expect(await bookingsOf(h)).toHaveLength(1);
  });
});

describe("drafts that may not be confirmed (nothing written)", () => {
  it("expired (30 min from P11 次へ) or missing → 410, P11 with PE036 (T056)", async () => {
    const h = await holder();
    const old = putDraft({ kind: "DRAFT", accountId: h.acc.id, sessionId: h.ctx.sessionId, sel: { ...EMPTY_SELECTIONS, ...sel(h, { start: "12:00" }) }, origin: "/", change: null, questionnaire: null, bookingId: null }, Date.now() - DRAFT_TTL_MS);
    expect(await answer(await press(h, old.id))).toEqual([410, "/booking/new?e=PE036"]);
    expect(await answer(await press(h, "no-such-draft"))).toEqual([410, "/booking/new?e=PE036"]);
    expect(await bookingsOf(h)).toHaveLength(0);
  });

  it("another account's draft cookie → PE036 for the caller; the owner's draft is untouched and still confirms", async () => {
    await S.frames(0, ["12:15"]);
    const [owner, thief] = [await holder(), await holder()];
    const d = await draftFor(owner, { start: "12:15" });
    expect(await answer(await press(thief, d))).toEqual([410, "/booking/new?e=PE036"]);
    expect(await prisma.booking.count({ where: { patient: { accountId: thief.acc.id } } })).toBe(0);
    expect((await answer(await press(owner, d)))[0]).toBe(200);
  });

  it("a draft whose person is not the account's (tampered store) → 404 PE091 (ER-01); anonymous 401; staff 403 SE091", async () => {
    const [h, other] = [await holder(), await holder()];
    const d = putDraft({ kind: "DRAFT", accountId: h.acc.id, sessionId: h.ctx.sessionId, sel: { ...EMPTY_SELECTIONS, ...sel(other, { start: "12:30" }) }, origin: "/", change: null, questionnaire: null, bookingId: null });
    const res = await press(h, d.id);
    expect([res.status, await res.json()]).toEqual([404, { code: "PE091", params: {}, to: "/booking/not-found" }]); // A-1: the client lands on ER-01
    const q = await run(h, () => saveQ(req("/api/booking/questionnaire", { body: { answers: {}, action: "next" }, draft: d.id, as: h })));
    expect([q.status, await q.json()]).toEqual([404, { code: "PE091", params: {}, to: "/booking/not-found" }]); // the P12 API too
    expect(await bookingsOf(other)).toHaveLength(0);
    expect((await confirm(req("/api/booking/confirm", { body: {}, draft: d.id }))).status).toBe(401);
    const staff = await prisma.account.create({
      data: { email: `s${Date.now()}.w1staff@example.jp`, passwordHash: await bcrypt.hash("Test1234", 4), role: "RECEPTION", status: "ACTIVE", displayName: "受付" },
    });
    await prisma.staffClinic.create({ data: { accountId: staff.id, clinicId: S.f.clinic.id } });
    const s = await login({ ip: "203.0.113.13", userAgent: "jest", email: staff.email, password: "Test1234" });
    if (!s.ok || !s.session) throw new Error("staff login");
    const asStaff = { ...h, sid: s.session.token };
    const st = await confirm(req("/api/booking/confirm", { body: {}, draft: d.id, as: asStaff }));
    expect([st.status, (await st.json()).code]).toEqual([403, "SE091"]);
  });
});

describe("change mode (event 4, T103)", () => {
  async function booked(h: Holder, start: string) {
    await S.frames(0, [start]);
    const r = await createBooking({ ...sel(h, { start }), doctorRequested: true, slotDate: DAY, startTime: start, notes: "旧" } as never, { kind: "PATIENT", accountId: h.acc.id, channel: "WEB" });
    if (!r.ok) throw new Error("setup");
    return r.bookingId;
  }

  it("PW002 はい: the booking moves (version + 1, CHANGED, notes replaced, NT-03), frames moved", async () => {
    const h = await holder();
    const id = await booked(h, "13:00");
    await S.frames(0, ["13:15"]);
    const d = await draftFor(h, { start: "13:15", notes: "新" }, { bookingId: id, version: 0 });
    expect(await answer(await press(h, d))).toEqual([200, `/bookings/${id}/done`]);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id }, include: { events: true, notifications: true } });
    expect([b.version, b.changeCount, b.events.map((e) => e.event).sort(), b.notifications.map((n) => n.event).sort()]).toEqual([1, 1, ["CHANGED", "CREATED"], ["NT01_BOOKED", "NT03_CHANGED"]]);
    expect([await reserved("13:00"), await reserved("13:15")]).toEqual([0, 1]);
  });

  it("staff changed the booking meanwhile (version) → P16 with PE045, nothing written by the patient, the draft discarded", async () => {
    const h = await holder();
    const id = await booked(h, "13:30");
    await S.frames(0, ["13:45", "14:00"]);
    const d = await draftFor(h, { start: "13:45" }, { bookingId: id, version: 0 });
    const staff = { kind: "STAFF" as const, accountId: S.f.admin.id, channel: "PHONE" as const };
    expect((await changeBooking(id, 0, { ...sel(h, { start: "14:00" }), doctorRequested: true, slotDate: DAY, startTime: "14:00", notes: null } as never, staff)).ok).toBe(true);
    const res = await press(h, d);
    expect(await answer(res)).toEqual([409, `/bookings/${id}`]);
    expect((res as unknown as { cookies: { get(n: string): { value: string } | undefined } }).cookies.get("flash")?.value).toBe("PE045");
    const b = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect([b.version, b.startTime.toISOString().slice(11, 16)]).toEqual([1, "14:00"]);
    expect([await reserved("13:45"), await reserved("14:00")]).toEqual([0, 1]);
    expect(getDraft(d, { accountId: h.acc.id, sessionId: h.ctx.sessionId })).toBeNull();
  });

  it("cancelled meanwhile → P16 PE045; the web deadline passed meanwhile (not 要調整) → P16 PE041", async () => {
    const h = await holder();
    const id = await booked(h, "14:15");
    await S.frames(0, ["14:30"]);
    const d = await draftFor(h, { start: "14:30" }, { bookingId: id, version: 0 });
    await cancelBooking({ bookingId: id, reasonCode: "CLINIC", reasonText: null }, { kind: "STAFF", accountId: S.f.admin.id, channel: "PHONE" });
    const res = await press(h, d);
    expect(await answer(res)).toEqual([409, `/bookings/${id}`]);
    expect((res as unknown as { cookies: { get(n: string): { value: string } | undefined } }).cookies.get("flash")?.value).toBe("PE045");

    // a booking for today (its deadline was yesterday 23:59), made by staff; the patient's change draft is refused
    const today = todayJst();
    await S.frames(1, ["23:15", "23:30"], { date: today });
    const t = await createBooking({ ...sel(h, { doctorId: S.f.doctors[1].id }), doctorRequested: true, slotDate: today, startTime: "23:15", notes: null } as never, { kind: "STAFF", accountId: S.f.admin.id, channel: "PHONE" }, { overrideLimit: true });
    if (!t.ok) throw new Error("setup");
    const late = putDraft({
      kind: "DRAFT", accountId: h.acc.id, sessionId: h.ctx.sessionId, origin: `/bookings/${t.bookingId}`, change: { bookingId: t.bookingId, version: 0 }, questionnaire: null, bookingId: null,
      sel: { ...EMPTY_SELECTIONS, ...sel(h, { doctorId: S.f.doctors[1].id, date: today, start: "23:30" }) },
    });
    const r2 = await press(h, late.id);
    expect(await answer(r2)).toEqual([409, `/bookings/${t.bookingId}`]);
    expect((r2 as unknown as { cookies: { get(n: string): { value: string } | undefined } }).cookies.get("flash")?.value).toBe("PE041");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: t.bookingId } })).version).toBe(0);
  });
});

describe("初診: 問診 first, stored with the booking (更新5)", () => {
  it("confirm before P12 → P12; after P12 the answers are stored encrypted with form 2026.1 and the language", async () => {
    await S.frames(0, ["15:00", "15:15"]);
    const h = await holder();
    const d = await draftFor(h, { visitTypeId: S.first.id, start: "15:00" });
    expect(await answer(await press(h, d))).toEqual([409, "/booking/questionnaire"]);
    const answers = { C01: "咳", C02: "D1_3", C03: "NONE", C04: "NONE", C05: ["NONE"], C08: "NEVER", C09: "NONE", C10: "NO" };
    expect((await saveQ(req("/api/booking/questionnaire", { body: { action: "next", answers }, draft: d, as: h }))).status).toBe(200);
    const [st, to] = await answer(await press(h, d));
    expect(st).toBe(200);
    const id = String(to).split("/")[2];
    const q = await prisma.questionnaire.findUniqueOrThrow({ where: { bookingId: id } });
    expect([q.formVersion, q.language, decryptJson(q.answers)]).toEqual(["2026.1", "JA", answers]);
    expect(q.purgeAfter.toISOString().slice(0, 10)).toBe(addDays(DAY, 90));
  });
});

describe("the screens render their props (SSR)", () => {
  it("P11, P12, P13 render with the loaders' props", async () => {
    await S.frames(0, ["16:00", "16:15"]);
    const h = await holder();
    const p11 = await loadEntry({ session: h.ctx, draftId: undefined, query: { clinic: S.f.clinic.code }, lang: "en" });
    if (p11.kind !== "ok") throw new Error("p11");
    expect(renderToStaticMarkup(<ToastProvider lang="en"><BookingEntry {...p11.props} /></ToastProvider>)).toContain("Choose a date and time");
    const d1 = await draftFor(h, { visitTypeId: S.first.id, start: "16:00" });
    const p12 = await loadQuestionnaire({ session: h.ctx, draftId: d1, lang: "vi" });
    if (p12.kind !== "ok") throw new Error("p12");
    expect(renderToStaticMarkup(<ToastProvider lang="vi"><QuestionnaireForm {...p12.props} /></ToastProvider>)).toContain("Phiếu khám sơ bộ");
    const d2 = await draftFor(h, { visitTypeId: S.selfPay.id, start: "16:00" });
    const p13 = await loadConfirm({ session: h.ctx, draftId: d2, lang: "ja" });
    if (p13.kind !== "ok") throw new Error("p13");
    const html = renderToStaticMarkup(<ToastProvider lang="ja"><ConfirmView {...p13.props} /></ToastProvider>);
    expect(html).toContain("4,000円");
    expect(html).toContain("予約を確定する");
    expect(html).toContain("戻る（日時選択へ）");
  });
});
