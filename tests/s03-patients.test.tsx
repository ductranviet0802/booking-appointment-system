// S03 患者検索・詳細 on the slot database: rules (4.2, F7-02, Q4), access and role escalation (doctor, disclosure by reception),
// the search (AND, hiragana, romaji case, exact phone / birth / card of the session clinic / booking no., merged hidden, 100 + SI034),
// the detail with PATIENT_VIEW, the save (field errors, ER-02 values, updated_at check SE010, UNIQUE card SE030, audit), 確認する,
// 問診 (QUESTIONNAIRE_VIEW without content), the merge (SE032 / SE033, moves with version + 1, account move, audit rows, SE031 after,
// stale SE010) and a merge racing a booking of the source (lockPerson in id order: no booking is left on a merged record).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { guardScreen } from "@/lib/auth/context";
import { createBooking } from "@/lib/booking/core";
import { encryptJson } from "@/lib/crypto/field";
import { addDays, dbDate, dbTime, todayJst } from "@/lib/datetime";
import { pool, prisma } from "@/lib/prisma";
import { loadDetail, searchPatients } from "@/lib/staff/patients";
import { checkMergeBox, checkSearch, EMPTY_SEARCH, normBookingNo, type ProfileValues } from "@/lib/staff/patients-rules";
import { cleanupStaff, makeStaff, request } from "./a03-helpers";
import { fixture, type Fixture } from "./b2-helpers";

process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
process.env.NOTIFY_OUTBOX_DIR = mkdtempSync(path.join(tmpdir(), "s03-outbox-"));
const mockJar: { sid?: string; path: string } = { path: "/staff/patients" };
jest.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sid" && mockJar.sid ? { value: mockJar.sid } : undefined) }),
  headers: async () => ({ get: (n: string) => (n === "x-pathname" ? mockJar.path : null) }),
}));
jest.mock("../app/(staff)/staff/patients/patients.module.css", () => ({}));

import { POST } from "@/app/api/staff/patients/route";
import PatientDetailPage from "@/app/(staff)/staff/patients/[id]/page";

jest.setTimeout(120_000);

let f: Fixture;
let admin: Awaited<ReturnType<typeof makeStaff>>;
let reception: Awaited<ReturnType<typeof makeStaff>>;
let doctor: Awaited<ReturnType<typeof makeStaff>>;
let runId: string;
let seq = 0;
const made: string[] = [];
const accounts: string[] = [];
const as = (t: string | undefined) => { mockJar.sid = t; };
const KANA = "ヴヰヱ"; // a kana no seeded patient has

type Res = { status: number; body: { code?: string; errors?: { field: string; code: string }[]; rows?: { id: string }[]; [k: string]: unknown } };
const act = async (body: Record<string, unknown>): Promise<Res> => {
  const res = await POST(request("/api/staff/patients", body));
  return { status: res.status, body: await res.json() };
};

async function patient(o: { kana?: string; given?: string; account?: boolean; phone?: string | null; birth?: string; family?: string; relation?: "SELF" | "CHILD" } = {}) {
  const n = ++seq;
  const acc = o.account ? await prisma.account.create({ data: { email: `s03.${f.tag}.${n}.w1test@example.jp`, passwordHash: "x", role: "PATIENT", status: "ACTIVE", notifyChannel: "MAIL" } }) : null;
  if (acc) accounts.push(acc.id);
  const p = await prisma.patient.create({
    data: {
      accountId: acc?.id ?? null, relation: acc ? (o.relation ?? "SELF") : null, nameType: "JP", familyName: o.family ?? "検索", givenName: o.given ?? `花子${n}`,
      familyNameKana: o.kana ?? KANA, givenNameKana: `ハナコ${"アイウエオカキクケコ"[n % 10]}`, birthDate: dbDate(o.birth ?? "1982-07-03"), sex: "FEMALE", postcode: "1000001",
      prefecture: "東京都", city: "千代田区", addressLine: "1-1", phone: o.phone === undefined ? `090${String(10_000_000 + n).slice(0, 8)}` : o.phone,
      createdByKind: acc ? "PATIENT" : "STAFF",
    },
  });
  made.push(p.id);
  return p;
}
const no = () => `SQ${"ABCDEFGHJK"[Math.floor(seq / 10) % 10]}${"ABCDEFGHJK"[seq % 10]}${String(++seq).padStart(4, "0")}`;
const booking = (patientId: string, o: { status?: "RESERVED" | "NO_SHOW"; date?: string } = {}) =>
  prisma.booking.create({
    data: {
      bookingNo: no(), clinicId: f.clinic.id, departmentId: f.dept.id, visitTypeId: f.visitType.id, doctorId: f.doctors[0].id, doctorRequested: true, patientId,
      channel: "PHONE", slotDate: dbDate(o.date ?? addDays(todayJst(), 3)), startTime: dbTime("09:00"), endTime: dbTime("09:15"), status: o.status ?? "RESERVED",
    },
  });
const profile = (p: { familyName: string; givenName: string; familyNameKana: string; givenNameKana: string; phone: string | null; smsOptIn: boolean }, o: Partial<ProfileValues> = {}): ProfileValues => ({
  nameType: "JP", familyName: p.familyName, givenName: p.givenName, familyNameKana: p.familyNameKana, givenNameKana: p.givenNameKana, birthDate: "1982/07/03", sex: "2",
  postcode: "1000001", prefecture: "東京都", city: "千代田区", town: "", addressLine: "1-1", building: "", phone: p.phone ?? "", smsOptIn: p.smsOptIn, ...o,
});
const updatedAt = async (id: string) => (await prisma.patient.findUniqueOrThrow({ where: { id } })).updatedAt.toISOString();
const audits = (action: string, targetId: string) => prisma.auditLog.findMany({ where: { action, targetId }, orderBy: { id: "asc" } });

beforeAll(async () => {
  f = await fixture({ doctors: 1 });
  admin = await makeStaff("ADMIN", { clinics: [f.tag] });
  reception = await makeStaff("RECEPTION", { clinics: [f.tag] });
  doctor = await makeStaff("DOCTOR", { clinics: [f.tag] });
  runId = (await prisma.batchRun.create({
    data: { jobCode: "B2", trigger: "MANUAL", clinicId: f.clinic.id, startedAt: new Date(), status: "SUCCESS", readCount: 0, writtenCount: 0, errorCount: 0 },
  })).id;
});

afterAll(async () => {
  await prisma.exportFile.deleteMany({ where: { clinicId: f.clinic.id } });
  await prisma.notification.deleteMany({ where: { patientId: { in: made } } });
  await prisma.patientCard.deleteMany({ where: { patientId: { in: made } } });
  await f.cleanup();
  await prisma.auditLog.deleteMany({ where: { targetId: { in: made } } });
  await prisma.patient.updateMany({ where: { id: { in: made } }, data: { mergedIntoId: null } });
  await prisma.patient.deleteMany({ where: { id: { in: made } } });
  await prisma.account.deleteMany({ where: { id: { in: accounts } } });
  await cleanupStaff();
  await prisma.$disconnect();
  await pool.end();
});

describe("rules", () => {
  it("search checks: one condition required (SE001 検索条件), kana / phone / birth / card / booking no. formats, F7-02", () => {
    const codes = (o: Partial<typeof EMPTY_SEARCH>) => checkSearch({ ...EMPTY_SEARCH, ...o }).errors.map((e) => `${e.field}:${e.code}`);
    expect(codes({})).toEqual(["kana:SE001"]);
    expect(codes({ kana: "yamada" })).toEqual(["kana:SE002"]);
    expect(checkSearch({ ...EMPTY_SEARCH, kana: "やまだ　ﾀﾛｳ" }).conditions.kanaWords).toEqual(["ヤマダ", "タロウ"]);
    expect(codes({ phone: "090-12a" })).toEqual(["phone:SE002"]);
    expect(checkSearch({ ...EMPTY_SEARCH, phone: "０９０-１２３４-５６７８" }).conditions.phone).toBe("09012345678");
    expect(codes({ birth: "1982/02/30" })).toEqual(["birth:SE002"]);
    expect(codes({ card: "a".repeat(21) })).toEqual(["card:SE003"]);
    expect(codes({ card: "あ" })).toEqual(["card:SE002"]);
    expect(normBookingNo("ａｂｃｄ－１２３４")).toBe("ABCD1234"); // full-width converted first (F7-02)
    expect(normBookingNo("abcd-1234")).toBe("ABCD1234");
    expect(normBookingNo("ABCI1234")).toBeNull(); // no I / O (F7-01)
  });

  it("merge box (Q4 A): kana → フリガナ; otherwise phone or card; empty SE001, mixed text SE002", () => {
    expect(checkMergeBox("").errors[0]).toMatchObject({ code: "SE001", params: { 項目: "統合先の患者" } });
    expect(checkMergeBox("やまだ").kanaWords).toEqual(["ヤマダ"]);
    expect(checkMergeBox("090-1234-5678").phoneOrCard).toEqual({ phone: "09012345678", card: "090-1234-5678" });
    expect(checkMergeBox("A-77").phoneOrCard).toEqual({ phone: null, card: "A-77" });
    expect(checkMergeBox("山田").errors[0].code).toBe("SE002");
  });
});

describe("access", () => {
  async function outcome(sid: string | undefined) {
    as(sid);
    try {
      await guardScreen("S03");
      return "allow";
    } catch (e) {
      const d = (e as { digest?: string }).digest ?? "";
      return d.startsWith("NEXT_REDIRECT") ? "redirect" : d.startsWith("NEXT_HTTP_ERROR_FALLBACK") ? `http:${d.split(";")[1]}` : "other";
    }
  }
  it("RECEPTION and ADMIN in; DOCTOR → ER-03; anonymous → login; DOCTOR API 403; reception disclosure 403 SE091 (role escalation)", async () => {
    expect(await outcome(admin.token)).toBe("allow");
    expect(await outcome(reception.token)).toBe("allow");
    expect(await outcome(doctor.token)).toBe("http:403");
    expect(await outcome(undefined)).toBe("redirect");
    const p = await patient();
    as(doctor.token);
    expect((await act({ action: "save", id: p.id })).status).toBe(403);
    as(reception.token);
    const r = await act({ action: "disclosure", id: p.id });
    expect([r.status, r.body.code]).toEqual([403, "SE091"]);
    expect(await prisma.exportFile.count({ where: { patientId: p.id } })).toBe(0);
    expect((await act({ action: "nope", id: p.id })).body.code).toBe("SE090");
    as(undefined);
    expect((await act({ action: "save", id: p.id })).status).toBe(401);
  });
});

describe("search", () => {
  it("AND of words on family / given kana, hiragana; exact phone / birth / card (session clinic) / booking no.; merged and anonymised hidden; kana order", async () => {
    const a = await patient({ kana: `${KANA}ア`, birth: "1990-01-01" });
    const b = await patient({ kana: `${KANA}イ` });
    const merged = await patient({ kana: `${KANA}ウ` });
    await prisma.patient.update({ where: { id: merged.id }, data: { mergedIntoId: a.id } });
    const anon = await patient({ kana: `${KANA}エ` });
    await prisma.patient.update({ where: { id: anon.id }, data: { anonymizedAt: new Date() } });
    const search = (o: Partial<typeof EMPTY_SEARCH>) => searchPatients(f.clinic.id, checkSearch({ ...EMPTY_SEARCH, ...o }).conditions);
    let r = await search({ kana: "ゔゐゑ" });
    const ids = r.rows.map((x) => x.id);
    expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(b.id));
    expect(ids).not.toContain(merged.id);
    expect(ids).not.toContain(anon.id);
    r = await search({ kana: `${KANA}ア ハナコ` });
    expect(r.rows.map((x) => x.id)).toEqual([a.id]);
    expect((await search({ phone: a.phone!.slice(0, 5) })).rows).toHaveLength(0); // exact, not partial
    expect((await search({ kana: KANA, birth: "1990/01/01" })).rows.map((x) => x.id)).toEqual([a.id]);
    await prisma.patientCard.create({ data: { patientId: b.id, clinicId: f.clinic.id, cardNo: `C-${f.tag}`, enteredByKind: "STAFF" } });
    expect((await search({ card: `C-${f.tag}` })).rows.map((x) => x.id)).toEqual([b.id]);
    expect((await searchPatients((await prisma.clinic.findFirstOrThrow({ where: { code: "honin" } })).id, { card: `C-${f.tag}` })).rows).toHaveLength(0);
    const bk = await booking(b.id);
    expect((await search({ bookingNo: `${bk.bookingNo.slice(0, 4).toLowerCase()}-${bk.bookingNo.slice(4)}` })).rows.map((x) => x.id)).toEqual([b.id]);
    expect(r.rows[0]).toMatchObject({ birth: "1990/01/01（" + (Number(todayJst().slice(0, 4)) - 1990 - (todayJst().slice(5) < "01-01" ? 1 : 0)) + "歳）", kind: "スタッフ登録", card: "—" });
  });

  it("romaji names case-insensitive (Q1 A); more than 100 rows → 100 and over (SI034)", async () => {
    const r1 = await patient({ family: "Smith", given: "Anna", kana: `${KANA}ス` });
    expect((await searchPatients(f.clinic.id, checkSearch({ ...EMPTY_SEARCH, name: "smith anna" }).conditions)).rows.map((x) => x.id)).toContain(r1.id);
    await prisma.patient.createMany({
      data: Array.from({ length: 101 }, (_, i) => ({
        nameType: "JP" as const, familyName: "多数", givenName: `${i}`, familyNameKana: "ヴヴヴ", givenNameKana: `タ${i}`, birthDate: dbDate("2000-01-01"), sex: "MALE" as const,
        postcode: "1000001", prefecture: "東京都", city: "千代田区", addressLine: "1", phone: "0311112222", createdByKind: "STAFF" as const,
      })),
    });
    made.push(...(await prisma.patient.findMany({ where: { familyNameKana: "ヴヴヴ" }, select: { id: true } })).map((p) => p.id));
    const r = await searchPatients(f.clinic.id, { kanaWords: ["ヴヴヴ"] });
    expect([r.rows.length, r.over]).toEqual([100, true]);
  });
});

describe("detail and save", () => {
  it("unknown / anonymised id → null (ER-02); the page writes PATIENT_VIEW; cards show an empty row of the staff's clinic; Q13 notices; no-show counts", async () => {
    expect(await loadDetail("00000000-0000-0000-0000-000000000000", { accountId: admin.account.id })).toBeNull();
    const p = await patient({ account: true });
    await booking(p.id, { status: "NO_SHOW", date: addDays(todayJst(), -10) });
    await booking(p.id, { status: "NO_SHOW", date: addDays(todayJst(), -400) });
    const bk = await booking(p.id);
    await prisma.notification.create({ data: { event: "NT01_BOOKED", channel: "MAIL", language: "JA", toAddress: "x@example.jp", bookingId: bk.id, status: "FAILED", queuedAt: new Date(), lastError: "550 mailbox unavailable" } });
    as(reception.token);
    mockJar.path = `/staff/patients/${p.id}`;
    await PatientDetailPage({ params: Promise.resolve({ id: p.id }), searchParams: Promise.resolve({}) });
    expect(await audits("PATIENT_VIEW", p.id)).toHaveLength(1);
    const d = (await loadDetail(p.id, { accountId: reception.account.id }))!;
    expect(d.cards).toEqual([expect.objectContaining({ clinicId: f.clinic.id, stored: false, editable: true, cardNo: "" })]);
    expect(d.notifications).toEqual([expect.objectContaining({ status: "FAILED", error: "550 mailbox unavailable" })]);
    expect(d.noShow).toEqual({ total: 2, recent: 1 });
    expect(d.tags).toMatchObject({ web: true, merged: false });
  });

  it("save: field errors; values the UI cannot produce → SE090; stale updated_at → SE010; card taken → SE030; success writes columns + card + audit", async () => {
    as(reception.token);
    const p = await patient({ account: true });
    const base = { action: "save", id: p.id, updatedAt: await updatedAt(p.id), profile: profile(p), cards: [] as unknown[] };
    let r = await act({ ...base, profile: profile(p, { familyName: " ", phone: "", birthDate: "2999/01/01" }) });
    expect(r.body.errors!.map((e) => `${e.field}:${e.code}`)).toEqual(["familyName:SE001", "birthDate:SE002", "phone:SE001"]);
    expect((await act({ ...base, profile: profile(p, { smsOptIn: true }) })).body.code).toBe("SE090"); // sms_opt_in of a web member
    const honin = await prisma.clinic.findFirstOrThrow({ where: { code: "honin" } });
    expect((await act({ ...base, cards: [{ clinicId: honin.id, cardNo: "1", updatedAt: null }] })).body.code).toBe("SE090"); // not the staff's clinic
    expect((await act({ ...base, updatedAt: new Date(0).toISOString(), profile: profile(p, { city: "港区" }) })).body.code).toBe("SE010");

    const other = await patient();
    await prisma.patientCard.create({ data: { patientId: other.id, clinicId: f.clinic.id, cardNo: `T-${f.tag}`, enteredByKind: "PATIENT" } });
    r = await act({ ...base, cards: [{ clinicId: f.clinic.id, cardNo: `T-${f.tag}`, updatedAt: null }] });
    expect(r.body.code).toBe("SE030");

    r = await act({ ...base, profile: profile(p, { city: "港区", phone: "03-1234-5678" }), cards: [{ clinicId: f.clinic.id, cardNo: `N-${f.tag}`, updatedAt: null }] });
    expect(r.body.code).toBe("SI030");
    const row = await prisma.patient.findUniqueOrThrow({ where: { id: p.id }, include: { cards: true } });
    expect([row.city, row.phone]).toEqual(["港区", "0312345678"]);
    expect(row.cards[0]).toMatchObject({ cardNo: `N-${f.tag}`, enteredByKind: "STAFF" });
    expect(row.cards[0].confirmedAt).not.toBeNull();
    const [a] = await audits("PATIENT_UPDATE", p.id);
    expect(a.detail).toEqual({ columns: ["city", "phone"], cards: [f.clinic.id] });
    // the same request again (double submit with the old updated_at) is refused, nothing written twice
    expect((await act({ ...base, profile: profile(p, { city: "港区", phone: "03-1234-5678" }) })).body.code).toBe("SE010");
    expect(await audits("PATIENT_UPDATE", p.id)).toHaveLength(1);
  });

  it("確認する: a patient entry gets confirmed_at; a stale row → SE010", async () => {
    as(reception.token);
    const p = await patient({ account: true });
    const card = await prisma.patientCard.create({ data: { patientId: p.id, clinicId: f.clinic.id, cardNo: `P-${f.tag}`, enteredByKind: "PATIENT" } });
    expect((await act({ action: "confirm", id: p.id, clinicId: f.clinic.id, updatedAt: new Date(0).toISOString() })).body.code).toBe("SE010");
    expect((await act({ action: "confirm", id: p.id, clinicId: f.clinic.id, updatedAt: card.updatedAt.toISOString() })).body.code).toBe("SI030");
    expect((await prisma.patientCard.findFirstOrThrow({ where: { patientId: p.id } })).confirmedAt).not.toBeNull();
    expect((await act({ action: "confirm", id: p.id, clinicId: f.clinic.id, updatedAt: card.updatedAt.toISOString() })).body.code).toBe("SE010");
  });

  it("問診を見る: decrypted answers, QUESTIONNAIRE_VIEW without content; a booking without 問診 → SE090", async () => {
    as(reception.token);
    const p = await patient();
    const bk = await booking(p.id);
    await prisma.questionnaire.create({ data: { bookingId: bk.id, formVersion: "2026.1", language: "JA", answers: encryptJson({ C01: "腹痛" }), submittedAt: new Date(), purgeAfter: dbDate("2030-01-01") } });
    const r = await act({ action: "questionnaire", id: p.id, bookingId: bk.id });
    expect(r.body.questionnaire).toMatchObject({ language: "ja", answers: [{ key: "C01", value: "腹痛" }] });
    const [a] = await audits("QUESTIONNAIRE_VIEW", bk.id);
    expect(JSON.stringify(a.detail)).not.toContain("腹痛");
    const none = await booking(p.id);
    expect((await act({ action: "questionnaire", id: p.id, bookingId: none.id })).body.code).toBe("SE090");
  });
});

describe("merge", () => {
  it("refusals: different cards at one clinic → SE032 first; both with web accounts → SE033", async () => {
    as(reception.token);
    const a = await patient({ account: true });
    const b = await patient({ account: true });
    await prisma.patientCard.create({ data: { patientId: a.id, clinicId: f.clinic.id, cardNo: `X1-${f.tag}`, enteredByKind: "STAFF" } });
    await prisma.patientCard.create({ data: { patientId: b.id, clinicId: f.clinic.id, cardNo: `X2-${f.tag}`, enteredByKind: "STAFF" } });
    expect((await act({ action: "mergeCheck", id: a.id, targetId: b.id })).body.code).toBe("SE032");
    await prisma.patientCard.deleteMany({ where: { patientId: b.id } });
    expect((await act({ action: "mergeCheck", id: a.id, targetId: b.id })).body.code).toBe("SE033");
    expect((await act({ action: "mergeCheck", id: a.id, targetId: a.id })).body.code).toBe("SE090");
  });

  it("merge: bookings (version + 1), cards, notifications and the account move to the target; audit rows; the source is read-only after (SE031); a stale dialog → SE010", async () => {
    as(reception.token);
    const src = await patient({ account: true });
    const dst = await patient({ phone: "0311112222" });
    const b1 = await booking(src.id);
    await prisma.patientCard.create({ data: { patientId: src.id, clinicId: f.clinic.id, cardNo: `M-${f.tag}`, enteredByKind: "PATIENT" } });
    const n = await prisma.notification.create({ data: { event: "NT01_BOOKED", channel: "MAIL", language: "JA", toAddress: "x@example.jp", patientId: src.id, status: "SENT", queuedAt: new Date() } });

    const check = await act({ action: "mergeCheck", id: src.id, targetId: dst.id });
    expect(check.body).toMatchObject({ confirm: "SW030", params: { 統合元: `${src.familyName} ${src.givenName}`, 統合先: `${dst.familyName} ${dst.givenName}` } });
    const stale = await act({ action: "merge", id: src.id, targetId: dst.id, sourceUpdatedAt: new Date(0).toISOString(), targetUpdatedAt: check.body.targetUpdatedAt });
    expect(stale.body.code).toBe("SE010");

    const r = await act({ action: "merge", id: src.id, targetId: dst.id, sourceUpdatedAt: check.body.sourceUpdatedAt, targetUpdatedAt: check.body.targetUpdatedAt });
    expect(r.body).toMatchObject({ code: "SI031", moved: 1 });
    const moved = await prisma.booking.findUniqueOrThrow({ where: { id: b1.id } });
    expect([moved.patientId, moved.version]).toEqual([dst.id, b1.version + 1]);
    expect((await prisma.patientCard.findFirstOrThrow({ where: { cardNo: `M-${f.tag}` } })).patientId).toBe(dst.id);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).patientId).toBe(dst.id);
    const [s2, d2] = await Promise.all([prisma.patient.findUniqueOrThrow({ where: { id: src.id } }), prisma.patient.findUniqueOrThrow({ where: { id: dst.id } })]);
    expect([s2.mergedIntoId, s2.accountId, s2.relation]).toEqual([dst.id, null, null]);
    expect([d2.accountId, d2.relation]).toEqual([src.accountId, "SELF"]);
    expect((await audits("PATIENT_MERGE", dst.id))[0].detail).toMatchObject({ source: src.id, bookings: 1, accountMoved: true });
    expect(await audits("BOOKING_UPDATE", b1.id)).toHaveLength(1);
    // 3-2: every edit request on the merged source is refused
    expect((await act({ action: "save", id: src.id, updatedAt: s2.updatedAt.toISOString(), profile: profile(src), cards: [] })).body.code).toBe("SE031");
    expect((await act({ action: "merge", id: src.id, targetId: dst.id, sourceUpdatedAt: "", targetUpdatedAt: "" })).body.code).toBe("SE031");
    const d = (await loadDetail(src.id, { accountId: reception.account.id }))!;
    expect(d.merged?.id).toBe(dst.id);
    expect(d.bookings).toHaveLength(0);
  });

  it("merge racing a booking of the source: both lock the source person; no booking is left on the merged record", async () => {
    as(reception.token);
    const src = await patient();
    const dst = await patient();
    const day = addDays(todayJst(), 4);
    await prisma.slot.create({
      data: { clinicId: f.clinic.id, departmentId: f.dept.id, doctorId: f.doctors[0].id, slotDate: dbDate(day), startTime: dbTime("10:00"), endTime: dbTime("10:15"), capacity: 1, status: "OPEN", generatedRunId: runId },
    });
    const check = await act({ action: "mergeCheck", id: src.id, targetId: dst.id });
    const [book, m] = await Promise.allSettled([
      createBooking(
        { clinicId: f.clinic.id, departmentId: f.dept.id, visitTypeId: f.visitType.id, patientId: src.id, doctorId: f.doctors[0].id, doctorRequested: true, slotDate: day, startTime: "10:00", notes: null },
        { kind: "STAFF", accountId: reception.account.id, channel: "PHONE" },
      ),
      act({ action: "merge", id: src.id, targetId: dst.id, sourceUpdatedAt: check.body.sourceUpdatedAt, targetUpdatedAt: check.body.targetUpdatedAt }),
    ]);
    expect(m.status === "fulfilled" && m.value.body.code).toBe("SI031");
    expect(await prisma.booking.count({ where: { patientId: src.id } })).toBe(0);
    // either the booking committed first and moved with the merge, or it found the source merged and wrote nothing
    const onTarget = await prisma.booking.count({ where: { patientId: dst.id } });
    expect(book.status === "fulfilled" ? onTarget : onTarget + 1).toBe(1);
    expect((await prisma.slot.findFirstOrThrow({ where: { clinicId: f.clinic.id, slotDate: dbDate(day) } })).reservedCount).toBe(onTarget);
  });
});

describe("disclosure", () => {
  it("admin: export_files DISCLOSURE BUILDING with the file name, DISCLOSURE_REQUEST audit; a second request makes a new row", async () => {
    as(admin.token);
    const p = await patient();
    const r = await act({ action: "disclosure", id: p.id });
    expect(r.body.code).toBe("SI032");
    await act({ action: "disclosure", id: p.id });
    const rows = await prisma.exportFile.findMany({ where: { patientId: p.id } });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "DISCLOSURE", status: "BUILDING", trigger: "MANUAL", clinicId: f.clinic.id, createdBy: admin.account.id });
    expect(rows[0].fileName).toMatch(new RegExp(`^DISCLOSURE_${p.id}_\\d{12}\\.zip$`));
    expect(await audits("DISCLOSURE_REQUEST", p.id)).toHaveLength(2);
  });
});
