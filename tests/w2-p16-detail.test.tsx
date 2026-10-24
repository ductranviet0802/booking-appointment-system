// spec-screen: P16 — the failure modes of the cancel against the slot's real database: double submit (one token, in
// parallel and as a retry), two dialogs racing, a staff change racing the cancel (version), family vs another account,
// the deadline minute (23:59:59 inside, 00:00:00 outside), 要調整 exempt, not RESERVED, tampered values and role
// escalation, an ended session; the re-check of events 2 / 4; the states of event 1 and the screen.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";

const mockJar: { sid?: string } = {};
jest.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sid" && mockJar.sid ? { value: mockJar.sid } : undefined) }),
  headers: async () => ({ get: () => null }),
}));
jest.mock("@/lib/auth/context", () => ({ ...jest.requireActual("@/lib/auth/context"), guardScreen: jest.fn(async () => null) }));
jest.mock("next/navigation", () => ({ ...jest.requireActual("next/navigation"), useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));
jest.mock("../app/(patient)/bookings/[id]/detail.module.css", () => ({}));
process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
process.env.NOTIFY_OUTBOX_DIR = mkdtempSync(path.join(tmpdir(), "w2-p16-"));

import { cancelBooking, changeBooking, type Actor } from "@/lib/booking/core";
import { encryptText } from "@/lib/crypto/field";
import { addDays, jstInstant, todayJst, toIsoDate } from "@/lib/datetime";
import { login } from "@/lib/auth/service";
import { cancelMine, detailState, loadDetail, recheck } from "@/lib/patient/bookings";
import { pool, prisma } from "@/lib/prisma";
import { POST as cancelRoute } from "@/app/api/bookings/cancel/route";
import { POST as checkRoute } from "@/app/api/bookings/check/route";
import BookingDetailPage from "@/app/(patient)/bookings/[id]/page";
import { DetailView, changeHref } from "@/app/(patient)/bookings/[id]/DetailView";
import { ToastProvider } from "@/components/ui/Toast";
import { book, cleanupAccounts, familyMember, frame, holder, interrupt, rawBooking, world, IP, type Holder, type World } from "./w2-helpers";

jest.setTimeout(120_000);
let w: World;
let seq = 0;
const tok = () => `tok-${Date.now()}-${++seq}`;
const staff = (): Actor => ({ kind: "STAFF", accountId: w.admin.id, channel: "PHONE" });

beforeAll(async () => {
  w = await world();
});
afterAll(async () => {
  await w.cleanup().catch(() => undefined);
  await cleanupAccounts();
  await prisma.$disconnect();
  await pool.end();
});

const post = (url: string, body: unknown) => new NextRequest(`http://localhost:3002${url}`, {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", origin: "http://localhost:3002" },
});
const cancelReq = (h: Holder, b: { id: string; version: number }, o: Record<string, unknown> = {}) => {
  mockJar.sid = h.sid;
  return cancelRoute(post("/api/bookings/cancel", { bookingId: b.id, version: b.version, reasonCode: "SCHEDULE", reasonText: "", token: tok(), ...o }));
};
const answer = async (res: Response) => [res.status, ((await res.json()) as { code?: string }).code];
const events = async (bookingId: string) => (await prisma.bookingEvent.findMany({ where: { bookingId } })).map((e) => e.event).sort();
const nt04 = (bookingId: string) => prisma.notification.count({ where: { bookingId, event: "NT04_CANCELED" } });
const reservedOf = async (bookingId: string) => {
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  return (await prisma.slot.findFirstOrThrow({ where: { clinicId: w.clinic.id, slotDate: b.slotDate, startTime: b.startTime, doctorId: b.doctorId } })).reservedCount;
};

describe("P16 cancel — idempotency (DB: booking row lock + status check; in-process key)", () => {
  it("double submit of one dialog in parallel: both PI050, one CANCELED, one NT-04, the frame freed once (CHECK slots_not_overbooked)", async () => {
    const h = await holder();
    const b = await book(w, h, h.self.id, 5, "09:00");
    const token = tok();
    const [x, y] = await Promise.all([cancelReq(h, b, { token }), cancelReq(h, b, { token })]);
    expect([await answer(x), await answer(y)]).toEqual([[200, "PI050"], [200, "PI050"]]);
    expect(await events(b.id)).toEqual(["CANCELED", "CREATED"]);
    expect(await nt04(b.id)).toBe(1);
    expect(await reservedOf(b.id)).toBe(0);
    expect(await prisma.bookingSlot.count({ where: { bookingId: b.id } })).toBe(0);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect([row.status, row.canceledByKind, row.canceledByAccountId, row.cancelReasonCode, row.cancelReasonText, row.version]).toEqual(["CANCELED", "PATIENT", h.acc.id, "SCHEDULE", null, b.version + 1]);
    // retry after a lost answer (same token, later): the first success again, nothing written twice
    expect(await answer(await cancelReq(h, b, { token }))).toEqual([200, "PI050"]);
    expect(await events(b.id)).toEqual(["CANCELED", "CREATED"]);
    // a new dialog on the cancelled booking: PE044 (event 7), no second NT-04
    expect(await answer(await cancelReq(h, b))).toEqual([409, "PE044"]);
    expect(await nt04(b.id)).toBe(1);
  });

  it("two dialogs (two tokens) racing: one PI050, the other PE044; one CANCELED", async () => {
    const h = await holder();
    const b = await book(w, h, h.self.id, 5, "09:30");
    const out = await Promise.all([cancelReq(h, b), cancelReq(h, b), cancelReq(h, b)]);
    const codes = (await Promise.all(out.map(answer))).map((a) => a.join(" ")).sort();
    expect(codes).toEqual(["200 PI050", "409 PE044", "409 PE044"]);
    expect(await events(b.id)).toEqual(["CANCELED", "CREATED"]);
    expect(await reservedOf(b.id)).toBe(0);
  });

  it("a token reused on another booking still cancels that booking (key = booking + token)", async () => {
    const h = await holder();
    const a = await book(w, h, h.self.id, 6, "09:00");
    const b = await book(w, h, h.self.id, 6, "10:00");
    const token = tok();
    expect(await answer(await cancelReq(h, a, { token }))).toEqual([200, "PI050"]);
    expect(await answer(await cancelReq(h, b, { token }))).toEqual([200, "PI050"]);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("CANCELED");
  });

  it("a refused attempt does not hold the token: PE001 first, then the same dialog cancels", async () => {
    const h = await holder();
    const b = await book(w, h, h.self.id, 6, "11:00");
    const token = tok();
    expect(await answer(await cancelReq(h, b, { token, reasonCode: "" }))).toEqual([400, "PE001"]);
    expect(await answer(await cancelReq(h, b, { token }))).toEqual([200, "PI050"]);
  });
});

describe("P16 cancel — races and version (DB: FOR UPDATE on account → patient → booking; bookings.version)", () => {
  it("staff changed the booking after the screen was loaded: PE047, nothing written, still RESERVED on the new frame", async () => {
    const h = await holder();
    const b = await book(w, h, h.self.id, 7, "09:00");
    await frame(w, toIsoDate(b.slotDate), "09:15");
    const moved = await changeBooking(b.id, b.version, {
      clinicId: w.clinic.id, departmentId: w.dept.id, visitTypeId: w.visitType.id, patientId: h.self.id, doctorId: w.doctors[0].id,
      doctorRequested: true, slotDate: toIsoDate(b.slotDate), startTime: "09:15", notes: null,
    }, staff(), { overrideLimit: true });
    expect(moved.ok).toBe(true);
    expect(await answer(await cancelReq(h, b))).toEqual([409, "PE047"]);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect([row.status, row.version]).toEqual(["RESERVED", b.version + 1]);
    expect(await events(b.id)).toEqual(["CHANGED", "CREATED"]);
    expect(await reservedOf(b.id)).toBe(1);
  });

  it("staff change and patient cancel in parallel: exactly one wins, the frames stay consistent", async () => {
    const h = await holder();
    const b = await book(w, h, h.self.id, 7, "10:00");
    const target = await frame(w, toIsoDate(b.slotDate), "10:15");
    const [chg, can] = await Promise.all([
      changeBooking(b.id, b.version, {
        clinicId: w.clinic.id, departmentId: w.dept.id, visitTypeId: w.visitType.id, patientId: h.self.id, doctorId: w.doctors[0].id,
        doctorRequested: true, slotDate: toIsoDate(b.slotDate), startTime: "10:15", notes: null,
      }, staff(), { overrideLimit: true }),
      cancelMine({ accountId: h.acc.id }, { bookingId: b.id, version: b.version, reasonCode: "RECOVERED", reasonText: "", token: tok() }),
    ]);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    if (chg.ok) {
      expect(can).toMatchObject({ ok: false, code: "PE047" });
      expect(row.status).toBe("RESERVED");
      expect((await prisma.slot.findUniqueOrThrow({ where: { id: target.id } })).reservedCount).toBe(1);
    } else {
      expect(chg.rule).toBe("NOT_RESERVED");
      expect(can.ok).toBe(true);
      expect(row.status).toBe("CANCELED");
      expect((await prisma.slot.findUniqueOrThrow({ where: { id: target.id } })).reservedCount).toBe(0);
    }
    const held = await prisma.bookingSlot.count({ where: { bookingId: b.id } });
    expect(held).toBe(row.status === "RESERVED" ? 1 : 0);
  });

  // core bug (reported): P16 5-1 / Q4 order is status → deadline → version; the core checks the version first, so a
  // booking both stale and past its deadline answers PE047 where the spec says PE041. Passes once the core is fixed.
  it.failing("stale and past the deadline at once → PE041 (spec order), not PE047", async () => {
    const h = await holder();
    const b = await book(w, h, h.self.id, 8, "09:00");
    await prisma.booking.update({ where: { id: b.id }, data: { version: { increment: 1 } } });
    const after = jstInstant(toIsoDate(b.slotDate), "00:00");
    const r = await cancelMine({ accountId: h.acc.id, now: after }, { bookingId: b.id, version: b.version, reasonCode: "SCHEDULE", reasonText: "", token: tok() });
    expect(r).toMatchObject({ ok: false, code: "PE041" });
  });
});

describe("P16 cancel — scope, deadline, status, values, roles", () => {
  it("a family member's booking is cancelled by the holder; another account's booking → 404 PE091, untouched", async () => {
    const me = await holder();
    const kid = await familyMember(me);
    const mine = await book(w, me, kid.id, 9, "09:00");
    const other = await holder();
    const theirs = await book(w, other, other.self.id, 9, "09:30");
    expect(await answer(await cancelReq(me, mine))).toEqual([200, "PI050"]);
    expect(await answer(await cancelReq(me, theirs))).toEqual([404, "PE091"]);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe("RESERVED");
    mockJar.sid = me.sid;
    expect(await answer(await checkRoute(post("/api/bookings/check", { bookingId: theirs.id, version: 0 })))).toEqual([404, "PE091"]);
    expect(await interrupt(() => BookingDetailPage({ params: Promise.resolve({ id: theirs.id }) }))).toBe("404");
    expect(await interrupt(() => BookingDetailPage({ params: Promise.resolve({ id: mine.id }) }))).toBe("rendered");
  });

  it("deadline 前日 23:59: 23:59:59 JST still cancels, 00:00:00 is PE041; 要調整 cancels after the deadline (F5-03)", async () => {
    const h = await holder();
    const b = await book(w, h, h.self.id, 10, "09:00");
    const day = toIsoDate(b.slotDate);
    const inside = new Date(jstInstant(addDays(day, -1), "23:59").getTime() + 59_000);
    const outside = jstInstant(day, "00:00");
    const body = { bookingId: b.id, version: b.version, reasonCode: "SCHEDULE", reasonText: "" };
    expect(await recheck(h.acc.id, b.id, b.version, inside)).toBeNull();
    expect(await recheck(h.acc.id, b.id, b.version, outside)).toBe("PE041");
    // a patient cannot lift the deadline from the request body
    expect(await cancelMine({ accountId: h.acc.id, now: outside }, { ...body, token: tok(), deadline: false, overrideLimit: true })).toMatchObject({ ok: false, code: "PE041" });
    expect(await cancelMine({ accountId: h.acc.id, now: inside }, { ...body, token: tok() })).toMatchObject({ ok: true });
    const adj = await book(w, h, h.self.id, 10, "10:00");
    await prisma.booking.update({ where: { id: adj.id }, data: { adjustRequiredAt: new Date() } });
    expect(await recheck(h.acc.id, adj.id, adj.version, outside)).toBeNull();
    expect(await cancelMine({ accountId: h.acc.id, now: outside }, { ...body, bookingId: adj.id, version: adj.version, token: tok() })).toMatchObject({ ok: true });
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: adj.id } });
    expect(row.adjustRequiredAt).toBeNull();
    expect(await events(adj.id)).toEqual(["ADJUST_CLEARED", "CANCELED", "CREATED"]);
  });

  it("not RESERVED (checked in) → PE045 at 18 and at はい; nothing written", async () => {
    const h = await holder();
    const b = await book(w, h, h.self.id, 11, "09:00");
    await prisma.booking.update({ where: { id: b.id }, data: { status: "CHECKED_IN", checkedInAt: new Date() } });
    expect(await recheck(h.acc.id, b.id, b.version, new Date())).toBe("PE045");
    expect(await answer(await cancelReq(h, b))).toEqual([409, "PE045"]);
    expect(await events(b.id)).toEqual(["CREATED"]);
  });

  it("§4.2 on the server: PE001 no reason / その他 empty, PE003 over 200, 200 kept with line breaks, other reasons drop the text", async () => {
    const h = await holder();
    const b = await book(w, h, h.self.id, 12, "09:00");
    const errs = async (o: Record<string, unknown>) => ((await (await cancelReq(h, b, o)).json()) as { errors?: unknown }).errors;
    expect(await errs({ reasonCode: "" })).toEqual([{ field: "reason", code: "PE001" }]);
    expect(await errs({ reasonCode: "OTHER", reasonText: " 　\n" })).toEqual([{ field: "reasonText", code: "PE001" }]);
    expect(await errs({ reasonCode: "OTHER", reasonText: "あ".repeat(201) })).toEqual([{ field: "reasonText", code: "PE003", params: { n: 200 } }]);
    expect(await events(b.id)).toEqual(["CREATED"]);
    const text = `${"あ".repeat(198)}\n😀`; // 200 characters (code points)
    expect(await answer(await cancelReq(h, b, { reasonCode: "OTHER", reasonText: text }))).toEqual([200, "PI050"]);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).cancelReasonText).toBe(text);
    const c = await book(w, h, h.self.id, 12, "10:00");
    expect(await answer(await cancelReq(h, c, { reasonCode: "RECOVERED", reasonText: "残らない" }))).toEqual([200, "PI050"]);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: c.id } })).cancelReasonText).toBeNull();
  });

  it("values the dialog cannot produce → 400 PE090 (ER-02), nothing written: CLINIC (staff only), unknown code, no version, no token", async () => {
    const h = await holder();
    const b = await book(w, h, h.self.id, 13, "09:00");
    for (const o of [{ reasonCode: "CLINIC" }, { reasonCode: "FREE" }, { version: "0" }, { version: undefined }, { token: "" }, { token: "x".repeat(65) }]) {
      expect(await answer(await cancelReq(h, b, o))).toEqual([400, "PE090"]);
    }
    expect(await events(b.id)).toEqual(["CREATED"]);
  });

  it("roles and sessions: no session → 401, a revoked session → 401, a staff session → 403; nothing written", async () => {
    const h = await holder();
    const b = await book(w, h, h.self.id, 14, "09:00");
    mockJar.sid = undefined;
    expect((await cancelRoute(post("/api/bookings/cancel", { bookingId: b.id, version: 0, reasonCode: "SCHEDULE", token: tok() }))).status).toBe(401);
    const s = await login({ ip: IP, userAgent: "jest", email: "reception.honin@example.jp", password: "Demo1234" });
    mockJar.sid = s.ok ? s.session!.token : "";
    expect((await cancelRoute(post("/api/bookings/cancel", { bookingId: b.id, version: 0, reasonCode: "SCHEDULE", token: tok() }))).status).toBe(403);
    await prisma.session.updateMany({ where: { accountId: h.acc.id }, data: { revokedAt: new Date() } });
    expect((await cancelReq(h, b)).status).toBe(401);
    expect(await interrupt(() => BookingDetailPage({ params: Promise.resolve({ id: b.id }) }))).toBe("401");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("RESERVED");
  });

  it("check route (events 2 / 4): ok, PE047 for a stale version, PE044 after a cancel; tampered body → PE090", async () => {
    const h = await holder();
    const b = await book(w, h, h.self.id, 15, "09:00");
    mockJar.sid = h.sid;
    const check = (o: Record<string, unknown>) => checkRoute(post("/api/bookings/check", { bookingId: b.id, version: b.version, ...o }));
    expect((await check({})).status).toBe(200);
    expect(await answer(await check({ version: b.version + 1 }))).toEqual([409, "PE047"]);
    expect(await answer(await check({ version: "0" }))).toEqual([400, "PE090"]);
    await cancelBooking({ bookingId: b.id, reasonCode: "SCHEDULE", reasonText: null }, staff());
    expect(await answer(await check({}))).toEqual([409, "PE044"]);
    expect(changeHref(b.id)).toBe(`/bookings/${b.id}/change`); // T062: slot w1's P11 change mode
  });
});

describe("P16 states (event 1) and the screen", () => {
  const now = new Date("2026-10-20T03:00:00Z"); // 2026-10-20 12:00 JST
  const future = jstInstant("2026-10-22", "09:00");
  const past = jstInstant("2026-10-19", "09:00");
  it("detailState: 基 / ① / ② (start passed, before ⑤) / ③ / ④ / ⑤", () => {
    const r = { status: "RESERVED" as const, adjustRequiredAt: null };
    expect(detailState(r, future, true, now)).toBe("BASE");
    expect(detailState(r, future, false, now)).toBe("AFTER");
    expect(detailState(r, past, false, now)).toBe("PENDING");
    expect(detailState({ ...r, adjustRequiredAt: now }, past, false, now)).toBe("PENDING");
    expect(detailState({ ...r, adjustRequiredAt: now }, future, false, now)).toBe("ADJUST");
    expect(detailState({ ...r, status: "NO_SHOW" }, past, false, now)).toBe("DONE");
    expect(detailState({ ...r, status: "CANCELED" }, future, true, now)).toBe("CANCELED");
  });

  const render = async (id: string, accountId: string, at?: Date) =>
    renderToStaticMarkup(<ToastProvider lang="ja"><DetailView data={(await loadDetail(id, accountId, "ja", at))!} lang="ja" /></ToastProvider>);

  it("基: PI056 with the full-style deadline, both buttons, notes decrypted and escaped; ①: PI051 + phone button, no buttons", async () => {
    const h = await holder();
    const b = await book(w, h, h.self.id, 16, "09:00", { notes: "<b>頭痛</b>" });
    const day = toIsoDate(b.slotDate);
    const base = await render(b.id, h.acc.id);
    expect(base).toContain('data-state="BASE"');
    expect(base).toMatch(/Webでの変更・キャンセルは\d{4}年\d{1,2}月\d{1,2}日\(.\) 23:59まで可能です。/);
    expect(base).toContain('data-testid="p16-change"');
    expect(base).toContain('data-testid="p16-cancel"');
    expect(base).toContain("&lt;b&gt;頭痛&lt;/b&gt;"); // F10-06
    expect(base).toContain("予約済");
    const after = await render(b.id, h.acc.id, jstInstant(day, "00:00"));
    expect(after).toContain('data-state="AFTER"');
    expect(after).toContain("電話で（"); // policy phone_message_ja of the fixture + （clinic phone）
    expect(after).not.toContain(" — default");
    expect(after).toContain("03-0000-0000 に電話");
    expect(after).not.toContain('data-testid="p16-cancel"');
  });

  it("④: cancel sentence with date and reason, no notes / price / notice / buttons; ⑤: PI057 and the buttons; ② 確認中 + PI055", async () => {
    const h = await holder();
    const b = await book(w, h, h.self.id, 17, "09:00");
    await cancelMine({ accountId: h.acc.id }, { bookingId: b.id, version: b.version, reasonCode: "OTHER", reasonText: "引っ越し", token: tok() });
    const c = await render(b.id, h.acc.id);
    expect(c).toContain('data-state="CANCELED"');
    expect(c).toMatch(/\d{4}年\d{1,2}月\d{1,2}日\(.\)にキャンセルしました（理由: その他（引っ越し））/);
    expect(c).not.toContain('data-testid="p16-notes"');
    expect(c).not.toContain('data-testid="p16-cancel"');
    const a = await book(w, h, h.self.id, 18, "09:00");
    await prisma.booking.update({ where: { id: a.id }, data: { adjustRequiredAt: new Date() } });
    const adj = await render(a.id, h.acc.id, jstInstant(toIsoDate(a.slotDate), "00:00"));
    expect(adj).toContain("要調整");
    expect(adj).toContain('data-testid="p16-pi057"');
    expect(adj).toContain('data-testid="p16-cancel"');
    const p = await rawBooking(w, h.self.id, addDays(todayJst(), -1), "09:00", { notes: encryptText("メモ") });
    const pend = await render(p.id, h.acc.id);
    expect(pend).toContain("確認中");
    expect(pend).toContain("受診結果の確認中です。");
    expect(pend).toContain("メモ");
    expect(pend).not.toContain('data-testid="p16-change"');
  });
});
