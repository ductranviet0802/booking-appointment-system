// S01 予約台帳: list and totals, display states, doctor read-only (every write route 403), 受付 / 受付取消 / 無断キャンセル確定 / 来院に訂正,
// 取消 through the core, 調整依頼 (NT-07), 問診・備考 dialog + audit, 予約番号 search, clinic scope, version conflicts.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { encryptJson, encryptText } from "@/lib/crypto/field";
import { addDays, dbDate, dbTime, todayJst } from "@/lib/datetime";
import { pool, prisma } from "@/lib/prisma";
import { cleanupStaff, makeStaff, request } from "./a03-helpers";
import { fixture, type Fixture } from "./b2-helpers";

process.env.NOTIFY_OUTBOX_DIR = mkdtempSync(path.join(tmpdir(), "s01-outbox-"));
const mockJar: { sid?: string } = {};
jest.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sid" && mockJar.sid ? { value: mockJar.sid } : undefined) }),
  headers: async () => ({ get: () => null }),
}));
jest.mock("../app/(staff)/staff/ledger/ledger.module.css", () => new Proxy({}, { get: (_t, k) => String(k) }));
jest.mock("@/components/ui/Toast", () => ({ useToast: () => ({ toast: jest.fn() }), useLang: () => "ja" }));
jest.mock("@/lib/client/api", () => ({ useApiFetch: () => jest.fn(), postJson: jest.fn(), openStaffErrorScreen: jest.fn() }));

import { POST as postAct } from "@/app/api/staff/ledger/act/route";
import { POST as postDialog } from "@/app/api/staff/ledger/dialog/route";
import { POST as postList } from "@/app/api/staff/ledger/list/route";
import { POST as postSearch } from "@/app/api/staff/ledger/search/route";
import { LedgerClient } from "@/app/(staff)/staff/ledger/LedgerClient";
import type { LedgerView } from "@/lib/staff/ledger";

jest.setTimeout(120_000);
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const TODAY = todayJst();
let f: Fixture;
let reception: Awaited<ReturnType<typeof makeStaff>>;
let doctor: Awaited<ReturnType<typeof makeStaff>>;
let foreign: Fixture;
let runId: string;
let seq = 0;
const extra: string[] = [];

beforeAll(async () => {
  f = await fixture({ doctors: 2 });
  foreign = await fixture({ doctors: 1 });
  reception = await makeStaff("RECEPTION", { clinics: [f.clinic.code] });
  doctor = await makeStaff("DOCTOR", { clinics: [f.clinic.code] });
  await prisma.doctor.update({ where: { id: f.doctors[0].id }, data: { accountId: doctor.account.id } });
  await f.pattern(f.doctors[0].id, 1, "AM"); // a doctor's clinics come from the shifts (_common 抽出4)
  await prisma.session.updateMany({ where: { accountId: doctor.account.id }, data: { clinicId: f.clinic.id } });
  runId = (await prisma.batchRun.create({
    data: { jobCode: "B2", trigger: "MANUAL", clinicId: f.clinic.id, startedAt: new Date(), endedAt: new Date(), status: "SUCCESS", readCount: 0, writtenCount: 0, errorCount: 0 },
  })).id;
});

afterAll(async () => {
  await foreign.cleanup().catch(() => undefined);
  await f.cleanup().catch(() => undefined);
  await prisma.patient.deleteMany({ where: { id: { in: extra } } });
  await cleanupStaff();
  await prisma.$disconnect();
  await pool.end();
});

const as = (token?: string) => { mockJar.sid = token; };
async function call(route: typeof postAct, url: string, body: unknown) {
  const res = await route(request(url, body));
  return { status: res.status, body: (await res.json()) as Json };
}
const act = (body: Json) => call(postAct, "/api/staff/ledger/act", body);
const list = (body: Json = {}) => call(postList, "/api/staff/ledger/list", body);

async function person() {
  const p = await prisma.patient.create({
    data: {
      nameType: "JP", familyName: "台帳", givenName: `患者${++seq}`, familyNameKana: "ダイチョウ", givenNameKana: "カンジャ", birthDate: dbDate("1985-05-05"),
      sex: "FEMALE", postcode: "1000001", prefecture: "東京都", city: "千代田区", addressLine: "1-1", phone: "09011112222", createdByKind: "STAFF",
    },
  });
  extra.push(p.id);
  return p;
}
let no = 0;
async function make(o: { clinic?: Fixture; doctor?: number; date?: string; start?: string; patientId?: string; status?: "RESERVED" | "CHECKED_IN" | "NO_SHOW" | "CANCELED"; data?: Json } = {}) {
  const c = o.clinic ?? f;
  const start = o.start ?? "09:00";
  const end = `${start.slice(0, 2)}:${String(Number(start.slice(3)) + 15).padStart(2, "0")}`;
  return prisma.booking.create({
    data: {
      bookingNo: `LDGR${String(++no).padStart(4, "0")}`,
      clinicId: c.clinic.id, departmentId: c.dept.id, visitTypeId: c.visitType.id, doctorId: c.doctors[o.doctor ?? 0].id, doctorRequested: true,
      patientId: o.patientId ?? (await person()).id, channel: "PHONE", slotDate: dbDate(o.date ?? TODAY), startTime: dbTime(start), endTime: dbTime(end),
      status: o.status ?? "RESERVED",
      ...(o.status === "CANCELED" && { canceledAt: new Date(), canceledByKind: "STAFF", cancelReasonCode: "CLINIC" }), ...o.data,
    },
  });
}
const row = (view: Json, id: string) => (view.rows as Json[]).find((r) => r.id === id) ?? ({} as Json);

describe("list and totals", () => {
  it("rows sorted by time then doctor; states, totals and the doctor filter; キャンセル済 hidden at first", async () => {
    const date = addDays(TODAY, 3);
    const a = await make({ date, start: "09:30", doctor: 1 });
    const b = await make({ date, start: "09:30", doctor: 0 });
    const c = await make({ date, start: "09:00", doctor: 0, status: "CANCELED" });
    const d = await make({ date, start: "10:00", data: { adjustRequiredAt: new Date() } });
    const e = await make({ date, start: "10:15", data: { noShowCandidateAt: new Date(Date.now() - 8 * 86_400_000), adjustRequiredAt: new Date() } });
    as(reception.token);
    const r = await list({ date });
    expect(r.status).toBe(200);
    const v = r.body.view;
    expect((v.rows as Json[]).map((x) => x.id)).toEqual([b.id, a.id, d.id, e.id]); // c hidden; doctor 0 before doctor 1
    expect(v.totals).toMatchObject({ RESERVED: 2, CANDIDATE: 1, CANCELED: 1, ADJUST: 1, all: 5 }); // the client adds CANDIDATE to 予約済 (Q4 b)
    expect(row(v, e.id)).toMatchObject({ state: "CANDIDATE", old: true, badge: "候補（7日以上未確定）" }); // 候補 before 要調整 (Q4 a)
    expect(row(v, d.id).state).toBe("ADJUST");
    expect(row(v, a.id).can).toMatchObject({ checkin: false, change: true, cancel: true, noShow: false }); // not today
    const all = await list({ date, states: ["CANCELED"] });
    expect((all.body.view.rows as Json[]).map((x) => x.id)).toEqual([c.id]);
    const one = await list({ date, doctorId: f.doctors[1].id });
    expect((one.body.view.rows as Json[]).map((x) => x.id)).toEqual([a.id]);
    expect((await list({ date, doctorId: foreign.doctors[0].id })).status).toBe(400); // not an option → ER-02
    expect((await list({ date: "" })).body.code).toBe("SE001");
    expect((await list({ date: "2030-02-31" })).body.code).toBe("SE090");
  });

  it("要調整 / 候補 filters read all dates; notices count the clinic", async () => {
    const adj = await make({ date: addDays(TODAY, 40), data: { adjustRequiredAt: new Date() } });
    const cand = await make({ date: addDays(TODAY, -3), data: { noShowCandidateAt: new Date(Date.now() - 2 * 86_400_000) } });
    as(reception.token);
    const a = await list({ filter: "adjust" });
    expect((a.body.view.rows as Json[]).some((x) => x.id === adj.id)).toBe(true);
    expect((a.body.view.rows as Json[]).some((x) => x.id === cand.id)).toBe(false);
    const c = await list({ filter: "candidate" });
    expect((c.body.view.rows as Json[]).some((x) => x.id === cand.id)).toBe(true);
    expect(c.body.view.notices.candidates).toBeGreaterThanOrEqual(1);
    const old = await list({ filter: "candidate7" });
    expect((old.body.view.rows as Json[]).some((x) => x.id === cand.id)).toBe(false); // 2 days old
    expect((await list({ filter: "nope" })).status).toBe(400);
  });
});

describe("doctor read-only", () => {
  it("sees own bookings only, no action flags; every write route answers 403 SE091 and writes nothing", async () => {
    const own = await make({ doctor: 0, date: addDays(TODAY, 4) });
    const other = await make({ doctor: 1, date: addDays(TODAY, 4) });
    as(doctor.token);
    const r = await list({ date: addDays(TODAY, 4), doctorId: f.doctors[1].id }); // another doctor's id is ignored
    expect(r.body.code).toBeUndefined();
    expect((r.body.view.rows as Json[]).map((x) => x.id)).toEqual([own.id]);
    expect(r.body.view.isDoctor).toBe(true);
    expect(Object.values(r.body.view.rows[0].can).every((x) => x === false)).toBe(true);
    for (const body of [
      { kind: "checkin", bookingId: own.id, version: 0 }, { kind: "undo", bookingId: own.id, version: 0 }, { kind: "noshow", bookingId: own.id, version: 0 },
      { kind: "correct", bookingId: own.id, version: 0 }, { kind: "cancel", bookingId: own.id, version: 0, reasonCode: "CLINIC", channel: "PHONE" },
      { kind: "adjust", items: [{ bookingId: own.id, version: 0 }] },
    ]) {
      expect(await act(body)).toEqual({ status: 403, body: { code: "SE091", params: {} } });
    }
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: own.id } })).version).toBe(0);
    // dialog: own booking readable, another doctor's → 403 without an audit row
    const before = await prisma.auditLog.count({ where: { action: "QUESTIONNAIRE_VIEW", targetId: other.id } });
    expect((await call(postDialog, "/api/staff/ledger/dialog", { bookingId: other.id })).status).toBe(403);
    expect(await prisma.auditLog.count({ where: { action: "QUESTIONNAIRE_VIEW", targetId: other.id } })).toBe(before);
    expect((await call(postDialog, "/api/staff/ledger/dialog", { bookingId: own.id })).status).toBe(200);
  });

  it("the doctor view renders no 新規予約 and no action columns; the name is not a link", async () => {
    await make({ doctor: 0, start: "16:00" });
    as(doctor.token);
    const v = (await list({})).body.view as LedgerView;
    expect(v.rows.length).toBeGreaterThan(0);
    const html = renderToStaticMarkup(<LedgerClient initial={v} flash={null} />);
    expect(html).not.toContain("新規予約");
    expect(html).not.toContain("<th>受付</th>");
    expect(html).not.toContain("/staff/patients?patientId");
    as(reception.token);
    const v2 = (await list({})).body.view as LedgerView;
    const html2 = renderToStaticMarkup(<LedgerClient initial={v2} flash={null} />);
    expect(html2).toContain("新規予約");
    expect(html2).toContain("<th>受付</th>");
  });
});

describe("status writes", () => {
  it("受付 → 受付取消 → version, events, audit; stale version SE010; 要調整 → SE011", async () => {
    const b = await make({ start: "11:00" });
    as(reception.token);
    expect((await act({ kind: "checkin", bookingId: b.id, version: 5 })).body.code).toBe("SE010");
    const ok = await act({ kind: "checkin", bookingId: b.id, version: 0 });
    expect(ok.status).toBe(200);
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(after).toMatchObject({ status: "CHECKED_IN", version: 1 });
    expect(after.checkedInAt).not.toBeNull();
    expect((await prisma.bookingEvent.findMany({ where: { bookingId: b.id } })).map((e) => e.event)).toEqual(["CHECKED_IN"]);
    expect(await prisma.auditLog.count({ where: { action: "BOOKING_UPDATE", targetId: b.id } })).toBe(1);
    expect((await act({ kind: "checkin", bookingId: b.id, version: 1 })).body).toMatchObject({ code: "SE011", params: { 状態: "来院済" } });
    expect((await act({ kind: "undo", bookingId: b.id, version: 1 })).status).toBe(200);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ status: "RESERVED", checkedInAt: null, version: 2 });
    const adj = await make({ start: "11:15", data: { adjustRequiredAt: new Date() } });
    expect((await act({ kind: "checkin", bookingId: adj.id, version: 0 })).body).toMatchObject({ code: "SE011", params: { 状態: "要調整" } });
    const past = await make({ date: addDays(TODAY, -1) });
    expect((await act({ kind: "checkin", bookingId: past.id, version: 0 })).body.code).toBe("SE011");
    expect((await act({ kind: "undo", bookingId: adj.id, version: 0 })).body.code).toBe("SE090"); // not CHECKED_IN → ER-02
  });

  it("無断キャンセル確定 needs a candidate; 来院に訂正 takes a candidate or a NO_SHOW within 7 days", async () => {
    const cand = await make({ date: addDays(TODAY, -2), data: { noShowCandidateAt: new Date() } });
    const plain = await make({ date: addDays(TODAY, -2) });
    as(reception.token);
    expect((await act({ kind: "noshow", bookingId: plain.id, version: 0 })).body.code).toBe("SE090");
    expect((await act({ kind: "noshow", bookingId: cand.id, version: 0 })).status).toBe(200);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: cand.id } })).status).toBe("NO_SHOW");
    expect((await act({ kind: "correct", bookingId: cand.id, version: 1 })).status).toBe(200);
    const fixed = await prisma.booking.findUniqueOrThrow({ where: { id: cand.id } });
    expect(fixed).toMatchObject({ status: "CHECKED_IN", version: 2 });
    expect(fixed.checkedInAt).not.toBeNull();
    expect((await prisma.bookingEvent.findMany({ where: { bookingId: cand.id }, orderBy: { id: "asc" } })).map((e) => e.event)).toEqual(["NO_SHOW", "NO_SHOW_CORRECTED"]);
    const edge = await make({ date: addDays(TODAY, -7), status: "NO_SHOW" });
    const tooOld = await make({ date: addDays(TODAY, -8), status: "NO_SHOW" });
    expect((await act({ kind: "correct", bookingId: edge.id, version: 0 })).status).toBe(200); // slot_date ≥ today − 7 (Q8 b)
    expect((await act({ kind: "correct", bookingId: tooOld.id, version: 0 })).body.code).toBe("SE090");
  });

  it("another clinic's booking → 403 SE091; an unknown id → SE090; nothing written", async () => {
    const other = await make({ clinic: foreign });
    as(reception.token);
    expect(await act({ kind: "checkin", bookingId: other.id, version: 0 })).toEqual({ status: 403, body: { code: "SE091", params: {} } });
    expect((await act({ kind: "checkin", bookingId: "11111111-1111-4111-8111-111111111111", version: 0 })).body.code).toBe("SE090");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: other.id } })).version).toBe(0);
    expect((await call(postDialog, "/api/staff/ledger/dialog", { bookingId: other.id })).status).toBe(403);
  });
});

describe("cancel (booking core)", () => {
  it("SE001 per field, ER-02 for tampering; success frees the frame, writes CANCELED and the audit row", async () => {
    const [slot] = [await prisma.slot.create({
      data: {
        clinicId: f.clinic.id, departmentId: f.dept.id, doctorId: f.doctors[0].id, slotDate: dbDate(addDays(TODAY, 6)), startTime: dbTime("14:00"), endTime: dbTime("14:15"),
        capacity: 1, reservedCount: 1, status: "OPEN", generatedRunId: runId,
      },
    })];
    const b = await make({ date: addDays(TODAY, 6), start: "14:00" });
    await prisma.bookingSlot.create({ data: { bookingId: b.id, slotId: slot.id } });
    as(reception.token);
    const empty = await act({ kind: "cancel", bookingId: b.id, version: 0, reasonCode: "", channel: "" });
    expect(empty.status).toBe(400);
    expect((empty.body.errors as Json[]).map((e) => e.field)).toEqual(["reason", "channel"]);
    expect((await act({ kind: "cancel", bookingId: b.id, version: 0, reasonCode: "OTHER", reasonText: "  ", channel: "PHONE" })).body.errors[0].field).toBe("reasonText");
    expect((await act({ kind: "cancel", bookingId: b.id, version: 0, reasonCode: "NOPE", channel: "PHONE" })).body.code).toBe("SE090");
    expect((await act({ kind: "cancel", bookingId: b.id, version: 0, reasonCode: "OTHER", reasonText: "あ".repeat(201), channel: "PHONE" })).body.code).toBe("SE090");
    expect((await act({ kind: "cancel", bookingId: b.id, version: 9, reasonCode: "CLINIC", channel: "PHONE" })).body.code).toBe("SE010");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("RESERVED");
    const ok = await act({ kind: "cancel", bookingId: b.id, version: 0, reasonCode: "SCHEDULE", reasonText: "", channel: "COUNTER" });
    expect(ok.status).toBe(200);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ status: "CANCELED", cancelReasonCode: "SCHEDULE", canceledByKind: "STAFF", version: 1 });
    expect((await prisma.slot.findUniqueOrThrow({ where: { id: slot.id } })).reservedCount).toBe(0);
    const ev = await prisma.bookingEvent.findFirstOrThrow({ where: { bookingId: b.id, event: "CANCELED" } });
    expect(ev).toMatchObject({ actorKind: "STAFF", channel: "COUNTER" });
    expect(await prisma.auditLog.count({ where: { action: "BOOKING_UPDATE", targetId: b.id } })).toBe(1);
    // already cancelled with an equal version is ER-02; with the old version SE010 (cancelled meanwhile, 9-3)
    expect((await act({ kind: "cancel", bookingId: b.id, version: 1, reasonCode: "CLINIC", channel: "PHONE" })).body.code).toBe("SE090");
    expect((await act({ kind: "cancel", bookingId: b.id, version: 0, reasonCode: "CLINIC", channel: "PHONE" })).body.code).toBe("SE010");
  });
});

describe("調整依頼 (NT-07)", () => {
  it("bulk send: NT07 for a patient with a recipient, none without; {m} counts them; one stale row stops the send", async () => {
    const date = addDays(TODAY, 20);
    const withAccount = await make({ date, start: "09:00", patientId: f.patient.id, data: { adjustRequiredAt: new Date() } });
    const without = await make({ date, start: "09:15", data: { adjustRequiredAt: new Date() } });
    as(reception.token);
    const stale = await act({ kind: "adjust", items: [{ bookingId: withAccount.id, version: 0 }, { bookingId: without.id, version: 3 }] });
    expect(stale.body.code).toBe("SE010");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: withAccount.id } })).adjustNotifiedAt).toBeNull(); // whole send rolled back
    const ok = await act({ kind: "adjust", items: [{ bookingId: withAccount.id, version: 0 }, { bookingId: without.id, version: 0 }] });
    expect(ok.body).toMatchObject({ n: 2, m: 1 });
    expect(await prisma.notification.count({ where: { bookingId: withAccount.id, event: "NT07_ADJUST" } })).toBe(1);
    expect(await prisma.notification.count({ where: { bookingId: without.id } })).toBe(0);
    const both = await prisma.booking.findMany({ where: { id: { in: [withAccount.id, without.id] } } });
    expect(both.every((b) => b.adjustNotifiedAt && b.version === 1)).toBe(true);
    expect(await prisma.bookingEvent.count({ where: { bookingId: { in: [withAccount.id, without.id] }, event: "ADJUST_NOTIFIED" } })).toBe(2);
    const view = (await list({ filter: "adjust" })).body.view;
    expect(row(view, withAccount.id).adjustNotified).toMatch(/^\d+\/\d+ \d\d:\d\d$/);
    expect((await act({ kind: "adjust", items: [] })).body.code).toBe("SE090");
    const plain = await make({ date });
    expect((await act({ kind: "adjust", items: [{ bookingId: plain.id, version: 0 }] })).body.code).toBe("SE090"); // no longer 要調整 → ER-02
  });
});

describe("問診・備考 dialog and 予約番号 search", () => {
  it("decrypts answers with the labels of 10, shows the notes and writes QUESTIONNAIRE_VIEW at every opening (no content in the log)", async () => {
    const b = await make({ data: { notes: encryptText("車いすで来院") } });
    await prisma.questionnaire.create({
      data: {
        bookingId: b.id, formVersion: "2026.1", language: "VI", submittedAt: new Date(), purgeAfter: dbDate(addDays(TODAY, 90)),
        answers: encryptJson({ C01: "Ho nhiều về đêm", C02: "D1_3", C05: ["HYPERTENSION", "OTHER"] }),
      },
    });
    as(reception.token);
    const r = await call(postDialog, "/api/staff/ledger/dialog", { bookingId: b.id });
    expect(r.body.heading).toBe(`問診 — 台帳 ${(await prisma.patient.findUniqueOrThrow({ where: { id: b.patientId } })).givenName} 様（再診・試験科）`);
    expect(r.body.language).toBe("回答言語: vi");
    expect(r.body.answers).toEqual([
      { id: "C01", question: "主訴", answer: "Ho nhiều về đêm" }, { id: "C02", question: "発症時期", answer: "1〜3日前" },
      { id: "C05", question: "既往歴", answer: "高血圧、その他" },
    ]);
    expect(r.body.notes).toBe("車いすで来院");
    await call(postDialog, "/api/staff/ledger/dialog", { bookingId: b.id });
    const logs = await prisma.auditLog.findMany({ where: { action: "QUESTIONNAIRE_VIEW", targetId: b.id } });
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.detail === null && l.targetType === "booking")).toBe(true);
    const v = (await list({ date: TODAY })).body.view;
    expect(row(v, b.id)).toMatchObject({ hasQuestionnaire: true, hasNotes: true });
  });

  it("search: full-width, lower case and hyphen normalised; not found / malformed → found:false; empty → SE001; other clinic switches the session", async () => {
    const b = await make({ date: addDays(TODAY, 9) });
    const full = [...`${b.bookingNo.slice(0, 4).toLowerCase()}-${b.bookingNo.slice(4)}`].map((c) => (/[a-z0-9]/.test(c) ? String.fromCharCode(c.charCodeAt(0) + 0xfee0) : c)).join("");
    as(reception.token);
    const s = (v: string) => call(postSearch, "/api/staff/ledger/search", { bookingNo: v });
    expect((await s(full)).body).toMatchObject({ found: true, date: addDays(TODAY, 9), bookingNo: b.bookingNo, switched: false });
    expect((await s("  ")).body).toMatchObject({ code: "SE001", params: { 項目: "予約番号" } });
    expect((await s("ZZZZ9999")).body.found).toBe(false);
    expect((await s("IOIO1234")).body.found).toBe(false);
    const other = await make({ clinic: foreign });
    expect((await s(other.bookingNo)).body.found).toBe(false); // not one of the staff's clinics
    const two = await makeStaff("RECEPTION", { clinics: [f.clinic.code, foreign.clinic.code] });
    as(two.token);
    expect((await s(other.bookingNo)).body).toMatchObject({ found: true, switched: true });
    expect((await prisma.session.findFirstOrThrow({ where: { accountId: two.account.id } })).clinicId).toBe(foreign.clinic.id);
  });

  it("no session → 401; cross-origin → 400", async () => {
    as(undefined);
    expect((await list({})).status).toBe(401);
    as(reception.token);
    const res = await postList(request("/api/staff/ledger/list", {}, { headers: { origin: "http://evil.example" } }));
    expect(res.status).toBe(400);
  });
});
