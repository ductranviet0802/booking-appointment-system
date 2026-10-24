// spec-screen: P07 — family ownership on every write route (add / edit / card numbers / delete / detach, F8-01), the
// limit and the duplicate rule under concurrency (account row lock), cards (confirmed read-only, PE053), delete vs
// detach, PE043, S-02 rules shared with P03, the screen.
import bcrypt from "bcrypt";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";

const mockJar: { sid?: string } = {};
jest.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sid" && mockJar.sid ? { value: mockJar.sid } : undefined) }),
  headers: async () => ({ get: () => null }),
}));
jest.mock("next/navigation", () => ({
  ...jest.requireActual("next/navigation"),
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => "/mypage/family",
}));
jest.mock("next/link", () => ({ __esModule: true, default: (p: { href: string; children: React.ReactNode; className?: string }) => <a href={p.href} className={p.className}>{p.children}</a> }));
process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";

import { t } from "@/lib/i18n";
import { pool, prisma } from "@/lib/prisma";
import { login } from "@/lib/auth/service";
import { addDays, dbDate, todayJst } from "@/lib/datetime";
import { deleteMember, loadFamily, saveMember } from "@/lib/patient/family";
import type { Actor } from "@/lib/patient/route";
import { POST as saveRoute } from "@/app/api/mypage/family/save/route";
import { POST as deleteRoute } from "@/app/api/mypage/family/delete/route";
import { GET as memberRoute } from "@/app/api/mypage/family/member/route";
import { ToastProvider } from "@/components/ui/Toast";
import { FamilyManager } from "@/components/patient/FamilyManager";

jest.setTimeout(90_000);
const MARK = "p07test";
const IP = "203.0.113.87";
const PW = "Test1234";
let seq = 0;
let hash = "";
let clinicIds: string[] = [];

const person = {
  nameType: "JP" as const, familyName: "家族", givenName: "太郎", familyNameKana: "カゾク", givenNameKana: "タロウ",
  birthDate: new Date("1985-05-05T00:00:00Z"), sex: "MALE" as const, postcode: "1000005", prefecture: "東京都", city: "千代田区",
  addressLine: "1-1", phone: "0312345678",
};

async function holder() {
  const acc = await prisma.account.create({ data: { email: `f${++seq}.${Date.now()}.${MARK}@example.jp`, passwordHash: hash, role: "PATIENT", status: "ACTIVE" } });
  const self = await prisma.patient.create({ data: { ...person, accountId: acc.id, relation: "SELF", createdByKind: "PATIENT" } });
  const r = await login({ ip: IP, userAgent: "jest", email: acc.email, password: PW });
  if (!r.ok || !r.session) throw new Error("login");
  const actor: Actor = { accountId: acc.id, sessionId: r.session.sessionId, ip: IP, now: new Date() };
  return { acc, self, sid: r.session.token, actor };
}
type Holder = Awaited<ReturnType<typeof holder>>;
const as = (h: Holder) => { mockJar.sid = h.sid; return h.actor; };
const member = (h: Holder, given = `子${++seq}`) =>
  prisma.patient.create({ data: { ...person, givenName: given, phone: null, accountId: h.acc.id, relation: "CHILD", createdByKind: "PATIENT" } });
const form = (over: Record<string, unknown> = {}) => ({
  relation: "CHILD", nameType: "JP", familyName: "家族", givenName: "花子", familyNameKana: "カゾク", givenNameKana: "ハナコ",
  birthDate: "2018-04-01", sex: "2", postcode: "100-0005", prefecture: "東京都", city: "千代田区", town: "", addressLine: "1-1",
  building: "", phone: "", cards: [], ...over,
});
const code = (r: { ok: boolean; code?: string; body?: Record<string, unknown> }) => (r.ok ? String(r.body?.code ?? "ok") : r.code);
const post = (url: string, body: unknown) => new NextRequest(`http://localhost:3002${url}`, {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", origin: "http://localhost:3002" },
});
async function booking(patientId: string, days: number) {
  const b = await prisma.booking.findFirstOrThrow();
  return prisma.booking.create({
    data: {
      bookingNo: `FAML${String(++seq).padStart(4, "0")}`, clinicId: b.clinicId, departmentId: b.departmentId, visitTypeId: b.visitTypeId,
      doctorId: b.doctorId, doctorRequested: false, patientId, channel: "WEB", slotDate: dbDate(addDays(todayJst(), days)),
      startTime: b.startTime, endTime: b.endTime, status: "RESERVED",
    },
  });
}

beforeAll(async () => {
  hash = await bcrypt.hash(PW, 4);
  clinicIds = (await prisma.clinic.findMany({ where: { isActive: true }, orderBy: { displayOrder: "asc" } })).map((c) => c.id);
});
afterAll(async () => {
  const ids = (await prisma.account.findMany({ where: { email: { contains: MARK } }, select: { id: true } })).map((a) => a.id);
  const bookings = await prisma.booking.findMany({ where: { bookingNo: { startsWith: "FAML" } }, select: { patientId: true } });
  const pids = [...new Set([...(await prisma.patient.findMany({ where: { accountId: { in: ids } }, select: { id: true } })).map((p) => p.id), ...bookings.map((b) => b.patientId)])];
  await prisma.booking.deleteMany({ where: { bookingNo: { startsWith: "FAML" } } });
  await prisma.patientCard.deleteMany({ where: { patientId: { in: pids } } });
  await prisma.patient.deleteMany({ where: { id: { in: pids } } });
  await prisma.session.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.account.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
  await pool.end();
});

describe("P07 ownership (F8-01, reading 3): another account's patient id is refused (ER-01) and nothing changes", () => {
  it("edit, card numbers, delete check, delete, detach and the edit read → 404 PE091; the other's rows unchanged", async () => {
    const me = await holder();
    const other = await holder();
    const theirs = await member(other, "他人");
    const booked = await member(other, "予約済");
    await booking(booked.id, -3); // booked before: would be detached
    await prisma.patientCard.create({ data: { patientId: theirs.id, clinicId: clinicIds[0], cardNo: "THEIRS-1", enteredByKind: "PATIENT" } });
    mockJar.sid = me.sid;
    const attempts = [
      saveRoute(post("/api/mypage/family/save", form({ patientId: theirs.id, givenName: "乗取" }))), // edit
      saveRoute(post("/api/mypage/family/save", form({ patientId: theirs.id, cards: [{ clinicId: clinicIds[0], cardNo: "MINE-1" }] }))), // cards
      deleteRoute(post("/api/mypage/family/delete", { patientId: theirs.id, confirm: false })), // event 7
      deleteRoute(post("/api/mypage/family/delete", { patientId: theirs.id, confirm: true })), // delete
      deleteRoute(post("/api/mypage/family/delete", { patientId: booked.id, confirm: true })), // detach
      memberRoute(new NextRequest(`http://localhost:3002/api/mypage/family/member?id=${theirs.id}`)), // event 3
      saveRoute(post("/api/mypage/family/save", form({ patientId: "not-a-uuid" }))),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: "PE091" });
    }
    const after = await prisma.patient.findUniqueOrThrow({ where: { id: theirs.id }, include: { cards: true } });
    expect([after.givenName, after.accountId, after.cards.map((c) => c.cardNo)]).toEqual(["他人", other.acc.id, ["THEIRS-1"]]);
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: booked.id } })).accountId).toBe(other.acc.id);
  });

  it("the own SELF row is not a member: edit / delete of it → ER-01; an add never takes a patient id from the body", async () => {
    const me = await holder();
    mockJar.sid = me.sid;
    expect((await saveRoute(post("/api/mypage/family/save", form({ patientId: me.self.id })))).status).toBe(404);
    expect((await deleteRoute(post("/api/mypage/family/delete", { patientId: me.self.id, confirm: true }))).status).toBe(404);
    expect(await prisma.patient.count({ where: { id: me.self.id, relation: "SELF" } })).toBe(1);
    // add: accountId / id in the body are ignored; the row belongs to the session's account
    const other = await holder();
    const res = await saveRoute(post("/api/mypage/family/save", form({ accountId: other.acc.id, id: other.self.id, givenName: "新入" })));
    expect(res.status).toBe(200);
    expect(await prisma.patient.count({ where: { accountId: me.acc.id, givenName: "新入", relation: "CHILD", createdByKind: "PATIENT" } })).toBe(1);
    expect(await prisma.patient.count({ where: { accountId: other.acc.id } })).toBe(1);
  });

  it("route access: no session → 401 PI013, staff session → 403", async () => {
    mockJar.sid = undefined;
    expect((await saveRoute(post("/api/mypage/family/save", form()))).status).toBe(401);
    const s = await login({ ip: IP, userAgent: "jest", email: "reception.honin@example.jp", password: "Demo1234" });
    mockJar.sid = s.ok ? s.session!.token : "";
    expect((await saveRoute(post("/api/mypage/family/save", form()))).status).toBe(403);
  });
});

describe("P07 save (event 6)", () => {
  it("add: PI042, the member with relation, phone null when empty, cards PATIENT / unconfirmed", async () => {
    const h = await holder();
    const r = await saveMember(as(h), form({ phone: "", cards: [{ clinicId: clinicIds[0], cardNo: "K-100" }, { clinicId: clinicIds[1], cardNo: "" }] }));
    expect(code(r)).toBe("PI042");
    const m = await prisma.patient.findFirstOrThrow({ where: { accountId: h.acc.id, relation: "CHILD" }, include: { cards: true } });
    expect([m.givenName, m.phone, m.sex, m.postcode, m.town]).toEqual(["花子", null, "FEMALE", "1000005", null]);
    expect(m.cards.map((c) => [c.cardNo, c.enteredByKind, c.confirmedAt])).toEqual([["K-100", "PATIENT", null]]);
  });

  it("server re-check: S-02 rules shared with P03, relation required / SELF tampered, nothing written", async () => {
    const h = await holder();
    const a = as(h);
    expect(code(await saveMember(a, form({ relation: "" })))).toBe("PE001");
    expect(code(await saveMember(a, form({ givenNameKana: "はなこ" })))).toBe("PE009");
    expect(code(await saveMember(a, form({ nameType: "ROMAJI", familyName: "Smith1", givenName: "Ann" })))).toBe("PE016");
    expect(code(await saveMember(a, form({ nameType: "ROMAJI", familyName: "O'Neil-Smith", givenName: "Mary Ann", givenNameKana: "anything" })))).toBe("PI042");
    expect(code(await saveMember(a, form({ phone: "12345" })))).toBe("PE015");
    expect(code(await saveMember(a, form({ birthDate: "2018-02-30" })))).toBe("PE014");
    expect(code(await saveMember(a, form({ cards: [{ clinicId: clinicIds[0], cardNo: "番号" }] })))).toBe("PE002");
    expect(code(await saveMember(a, form({ relation: "SELF" })))).toBe("PE090");
    expect(code(await saveMember(a, form({ cards: [{ clinicId: "00000000-0000-0000-0000-000000000000", cardNo: "1" }] })))).toBe("PE090");
    expect(await prisma.patient.count({ where: { accountId: h.acc.id, relation: { not: "SELF" } } })).toBe(1); // only the valid romaji one
  });

  it("the same member twice (name + date of birth) is refused; a double submit adds one row", async () => {
    const h = await holder();
    const a = as(h);
    const rs = await Promise.all([saveMember(a, form()), saveMember(a, form()), saveMember(a, form({ familyName: "家族 " }))]);
    expect(rs.map(code).sort()).toEqual(["PI042", "TMP-Q017", "TMP-Q017"]);
    expect(await prisma.patient.count({ where: { accountId: h.acc.id, givenName: "花子" } })).toBe(1);
  });

  it("Q-017: SELF counts, edit counts, kana does not; the message is the customer's text (TMP-Q017)", async () => {
    const h = await holder();
    const a = as(h);
    const selfLike = { familyName: "家族", givenName: "太郎", birthDate: "1985-05-05" };
    expect(code(await saveMember(a, form({ ...selfLike, familyNameKana: "ベツ", givenNameKana: "ベツ" })))).toBe("TMP-Q017");
    const m = await member(h, "別人");
    expect(code(await saveMember(a, form({ ...selfLike, patientId: m.id })))).toBe("TMP-Q017");
    expect(code(await saveMember(a, form({ ...selfLike, givenName: "次郎", givenNameKana: "タロウ" })))).toBe("PI042");
    expect(t("TMP-Q017", "ja")).toBe("同じご家族がすでに登録されています。");
  });

  it("PE046 at family_member_max (9): refused at the press; two adds racing for the last place → one PI042, one PE046", async () => {
    const h = await holder();
    for (let i = 0; i < 8; i++) await member(h);
    const a = as(h);
    const rs = await Promise.all([saveMember(a, form({ givenName: "最後一" })), saveMember(a, form({ givenName: "最後二" }))]);
    expect(rs.map(code).sort()).toEqual(["PE046", "PI042"]);
    expect(rs.find((r) => !r.ok)).toMatchObject({ status: 409, params: { n: 9 } });
    expect(await prisma.patient.count({ where: { accountId: h.acc.id, relation: { not: "SELF" } } })).toBe(9);
    expect(code(await saveMember(a, form({ givenName: "十人目" })))).toBe("PE046");
  });

  it("edit: confirmed card read-only, unconfirmed changed / cleared, PE053 for a number another patient holds (nothing written)", async () => {
    const h = await holder();
    const other = await holder();
    const m = await member(h, "編集");
    await prisma.patientCard.create({ data: { patientId: m.id, clinicId: clinicIds[0], cardNo: "CONF-1", enteredByKind: "STAFF", confirmedAt: new Date() } });
    await prisma.patientCard.create({ data: { patientId: m.id, clinicId: clinicIds[1], cardNo: "OPEN-1", enteredByKind: "PATIENT" } });
    await prisma.patientCard.create({ data: { patientId: other.self.id, clinicId: clinicIds[1], cardNo: "TAKEN-9", enteredByKind: "STAFF" } });
    const a = as(h);
    const dup = await saveMember(a, form({ patientId: m.id, givenName: "変更後", cards: [{ clinicId: clinicIds[1], cardNo: "TAKEN-9" }] }));
    expect(dup.ok ? null : dup.errors).toEqual([{ field: `card:${clinicIds[1]}`, code: "PE053" }]);
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: m.id } })).givenName).toBe("編集");
    const r = await saveMember(a, form({ patientId: m.id, givenName: "変更後", cards: [{ clinicId: clinicIds[0], cardNo: "" }, { clinicId: clinicIds[1], cardNo: "OPEN-2" }] }));
    expect(code(r)).toBe("PI042");
    const cards = await prisma.patientCard.findMany({ where: { patientId: m.id }, orderBy: { cardNo: "asc" } });
    expect(cards.map((c) => c.cardNo)).toEqual(["CONF-1", "OPEN-2"]);
    expect(await saveMember(a, form({ patientId: m.id, cards: [{ clinicId: clinicIds[1], cardNo: "" }] })).then(code)).toBe("PI042");
    expect(await prisma.patientCard.count({ where: { patientId: m.id } })).toBe(1);
  });
});

describe("P07 delete (events 7, 9)", () => {
  it("never booked → deleted with its cards; booked before → detached (account_id null, relation kept); future RESERVED → PE043", async () => {
    const h = await holder();
    const fresh = await member(h, "新規");
    await prisma.patientCard.create({ data: { patientId: fresh.id, clinicId: clinicIds[0], cardNo: `DEL-${seq}`, enteredByKind: "PATIENT" } });
    const past = await member(h, "過去");
    await booking(past.id, -2);
    const future = await member(h, "未来");
    await booking(future.id, 3);
    mockJar.sid = h.sid;
    expect((await deleteRoute(post("/api/mypage/family/delete", { patientId: future.id, confirm: false }))).status).toBe(409);
    const blocked = await deleteRoute(post("/api/mypage/family/delete", { patientId: future.id, confirm: true })); // 9-3
    expect([blocked.status, (await blocked.json()).code]).toEqual([409, "PE043"]);
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: future.id } })).accountId).toBe(h.acc.id);
    expect((await deleteRoute(post("/api/mypage/family/delete", { patientId: fresh.id, confirm: false }))).status).toBe(200);
    expect(await deleteMember(h.actor, fresh.id)).toMatchObject({ ok: true, body: { code: "PI047", result: "deleted" } });
    expect(await prisma.patient.count({ where: { id: fresh.id } })).toBe(0);
    expect(await deleteMember(h.actor, past.id)).toMatchObject({ ok: true, body: { result: "detached" } });
    expect(await prisma.patient.findUniqueOrThrow({ where: { id: past.id } })).toMatchObject({ accountId: null, relation: "CHILD" });
    // detached → no longer the account's: a second delete is ER-01
    expect(code(await deleteMember(h.actor, past.id))).toBe("PE091");
  });

  it("double press of はい: one PI047, the other ER-01", async () => {
    const h = await holder();
    const m = await member(h, "二度");
    mockJar.sid = h.sid;
    const rs = await Promise.all([deleteMember(h.actor, m.id), deleteMember(h.actor, m.id)]);
    expect(rs.map(code).sort()).toEqual(["PE091", "PI047"]);
  });
});

describe("P07 screen", () => {
  it("empty state PI046 with 家族を追加する; the lead shows family_member_max", async () => {
    const h = await holder();
    const data = await loadFamily(h.acc.id, "ja");
    const html = renderToStaticMarkup(<ToastProvider lang="ja"><FamilyManager lang="ja" data={data} /></ToastProvider>);
    expect(html).toContain("ご家族は登録されていません。");
    expect(html).toContain("登録できるご家族は9人までです。");
    expect(html).toContain("家族を追加する");
    expect(html).not.toContain('data-testid="p07-member"');
  });

  it("list: count heading, cards in created order with relation chip and birth date, 予約 link → /booking/new?patient=<id> (event 10)", async () => {
    const h = await holder();
    const a = await member(h, "一郎");
    const b = await prisma.patient.create({ data: { ...person, nameType: "ROMAJI", familyName: "Smith", givenName: "Ann", familyNameKana: "スミス", givenNameKana: "アン", phone: null, accountId: h.acc.id, relation: "SPOUSE", createdByKind: "PATIENT" } });
    const ja = renderToStaticMarkup(<ToastProvider lang="ja"><FamilyManager lang="ja" data={await loadFamily(h.acc.id, "ja")} /></ToastProvider>);
    expect(ja).toContain("登録済みのご家族（2人）");
    expect(ja.indexOf("家族 一郎")).toBeLessThan(ja.indexOf("Smith Ann"));
    expect(ja).toContain(`href="/booking/new?patient=${a.id}"`);
    expect(ja).toContain("1985年5月5日生");
    expect(ja).toContain(">配偶者<");
    const en = renderToStaticMarkup(<ToastProvider lang="en"><FamilyManager lang="en" data={await loadFamily(h.acc.id, "en")} /></ToastProvider>);
    expect(en).toContain("Ann Smith"); // romaji given family in en (04 §6.1)
    expect(en).toContain(`href="/booking/new?patient=${b.id}"`);
    expect(en).toContain(">Spouse<");
  });
});
