// spec-screen: P06 — save (event 7) with ownership from the session only, all-or-nothing PE005 / PE053, e-mail change
// tokens (single use, expiry, voided by a newer change), password change (other sessions revoked, PE018, PE092 after 5),
// withdrawal (PE042, sessions revoked, PI041 flag), LINE link in fake mode (state, reuse, unlink), route access.
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
  usePathname: () => "/mypage",
}));
jest.mock("next/link", () => ({ __esModule: true, default: (p: { href: string; children: React.ReactNode; className?: string }) => <a href={p.href} className={p.className}>{p.children}</a> }));
process.env.NOTIFY_OUTBOX_DIR = mkdtempSync(path.join(tmpdir(), "p06-outbox-"));
process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";

import { pool, prisma } from "@/lib/prisma";
import { login } from "@/lib/auth/service";
import { readSession, sha256 } from "@/lib/auth/session";
import { resetAuthLimits } from "@/lib/auth/rate-limit";
import { addDays, dbDate, todayJst } from "@/lib/datetime";
import { changePassword, confirmEmailChange, EMAIL_CHANGE_MS, loadMypage, saveMypage, withdraw } from "@/lib/patient/mypage";
import { lineCallback } from "@/lib/patient/line";
import type { Actor } from "@/lib/patient/route";
import { POST as saveRoute } from "@/app/api/mypage/save/route";
import { POST as withdrawRoute } from "@/app/api/mypage/withdraw/route";
import { GET as lineStart } from "@/app/api/mypage/line/start/route";
import { ToastProvider } from "@/components/ui/Toast";
import { MypageForm } from "@/components/patient/MypageForm";

jest.setTimeout(90_000);
const MARK = "p06test";
const IP = "203.0.113.86";
const PW = "Test1234";
let seq = 0;
let hash = "";
let clinicIds: string[] = [];

const person = {
  nameType: "JP" as const, familyName: "試験", givenName: "花子", familyNameKana: "シケン", givenNameKana: "ハナコ",
  birthDate: new Date("1990-01-01T00:00:00Z"), sex: "FEMALE" as const, postcode: "1000005", prefecture: "東京都", city: "千代田区",
  addressLine: "1-1", phone: "0312345678",
};

async function holder() {
  const acc = await prisma.account.create({ data: { email: `h${++seq}.${Date.now()}.${MARK}@example.jp`, passwordHash: hash, role: "PATIENT", status: "ACTIVE", emailBouncedAt: new Date() } });
  const self = await prisma.patient.create({ data: { ...person, accountId: acc.id, relation: "SELF", createdByKind: "PATIENT" } });
  const r = await login({ ip: IP, userAgent: "jest", email: acc.email, password: PW });
  if (!r.ok || !r.session) throw new Error("login");
  const actor: Actor = { accountId: acc.id, sessionId: r.session.sessionId, ip: IP, now: new Date() };
  return { acc, self, sid: r.session.token, actor };
}
const form = (over: Record<string, unknown> = {}) => ({
  nameType: "JP", familyName: "変更", givenName: "花子", familyNameKana: "ヘンコウ", givenNameKana: "ハナコ", birthDate: "1991-02-03",
  sex: "2", postcode: "100-0005", prefecture: "東京都", city: "千代田区", town: "丸の内", addressLine: "2-2", building: "", phone: "090-1111-2222",
  notifyChannel: "MAIL", smsOptIn: false, cards: [], ...over,
});
const code = (r: { ok: boolean; code?: string; body?: Record<string, unknown> }) => (r.ok ? String(r.body?.code ?? "ok") : r.code);
function changeToken(to: string) {
  const dir = process.env.NOTIFY_OUTBOX_DIR!;
  const lines = readdirSync(dir).flatMap((f) => readFileSync(path.join(dir, f), "utf8").trim().split("\n"));
  const mail = lines.map((l) => JSON.parse(l) as { to: string; body: string }).filter((m) => m.to === to).at(-1)!;
  return mail.body.match(/\/api\/mypage\/email\?token=([A-Za-z0-9_-]+)/)![1];
}
const req = (url: string, body?: unknown) => new NextRequest(`http://localhost:3002${url}`, body === undefined ? {} : {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", origin: "http://localhost:3002" },
});

beforeAll(async () => {
  hash = await bcrypt.hash(PW, 4);
  clinicIds = (await prisma.clinic.findMany({ where: { isActive: true }, orderBy: { displayOrder: "asc" } })).map((c) => c.id);
});
beforeEach(() => resetAuthLimits());
afterAll(async () => {
  const ids = (await prisma.account.findMany({ where: { email: { contains: MARK } }, select: { id: true } })).map((a) => a.id);
  const pids = (await prisma.patient.findMany({ where: { accountId: { in: ids } }, select: { id: true } })).map((p) => p.id);
  await prisma.booking.deleteMany({ where: { patientId: { in: pids } } });
  await prisma.patientCard.deleteMany({ where: { patientId: { in: pids } } });
  await prisma.patient.deleteMany({ where: { id: { in: pids } } });
  for (const m of [prisma.session, prisma.auditLog, prisma.notification, prisma.authToken] as const) {
    await (m as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({ where: { accountId: { in: ids } } });
  }
  await prisma.account.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
  await pool.end();
});

describe("P06 save (event 7)", () => {
  it("writes the SELF patient, channel, cards (PATIENT, unconfirmed) and clears email_bounced_at", async () => {
    const h = await holder();
    const r = await saveMypage(h.actor, form({ email: h.acc.email, cards: [{ clinicId: clinicIds[0], cardNo: "A-1001" }] }));
    expect(code(r)).toBe("PI040");
    const self = await prisma.patient.findUniqueOrThrow({ where: { id: h.self.id } });
    expect(self).toMatchObject({ familyName: "変更", phone: "09011112222", postcode: "1000005", town: "丸の内", building: null });
    expect(self.birthDate.toISOString().slice(0, 10)).toBe("1991-02-03");
    const card = await prisma.patientCard.findFirstOrThrow({ where: { patientId: h.self.id } });
    expect([card.cardNo, card.enteredByKind, card.confirmedAt]).toEqual(["A-1001", "PATIENT", null]);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: h.acc.id } })).emailBouncedAt).toBeNull();
  });

  it("a patient id in the body is ignored: only the session's SELF patient is written (reading 3)", async () => {
    const h = await holder();
    const other = await holder();
    mockJar.sid = h.sid;
    const res = await saveRoute(req("/api/mypage/save", form({ email: h.acc.email, patientId: other.self.id, id: other.self.id, accountId: other.acc.id })));
    expect(res.status).toBe(200);
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: other.self.id } })).familyName).toBe("試験");
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: h.self.id } })).familyName).toBe("変更");
  });

  it("route access: no session → 401 PI013, staff → 403, cross-origin → 403 PE090", async () => {
    mockJar.sid = undefined;
    expect((await saveRoute(req("/api/mypage/save", form()))).status).toBe(401);
    const s = await login({ ip: IP, userAgent: "jest", email: "reception.honin@example.jp", password: "Demo1234" });
    mockJar.sid = s.ok ? s.session!.token : "";
    expect((await saveRoute(req("/api/mypage/save", form()))).status).toBe(403);
    const cross = new NextRequest("http://localhost:3002/api/mypage/save", { method: "POST", body: "{}", headers: { origin: "http://evil.example" } });
    expect((await saveRoute(cross)).status).toBe(403);
  });

  it("field errors / channel rules / tampered values → nothing written", async () => {
    const h = await holder();
    expect(code(await saveMypage(h.actor, form({ email: "bad", familyNameKana: "ひらがな" })))).toBe("PE009");
    expect(code(await saveMypage(h.actor, form({ email: h.acc.email, notifyChannel: "LINE" })))).toBe("PE050");
    expect(code(await saveMypage(h.actor, form({ email: h.acc.email, notifyChannel: "SMS", smsOptIn: false })))).toBe("PE051");
    expect(code(await saveMypage(h.actor, form({ email: h.acc.email, sex: "9" })))).toBe("PE090");
    expect(code(await saveMypage(h.actor, form({ email: h.acc.email, notifyChannel: "FAX" })))).toBe("PE090");
    expect(code(await saveMypage(h.actor, form({ email: h.acc.email, cards: [{ clinicId: "00000000-0000-0000-0000-000000000000", cardNo: "1" }] })))).toBe("PE090");
    expect(code(await saveMypage(h.actor, form({ email: h.acc.email, cards: [{ clinicId: clinicIds[0], cardNo: "番号" }] })))).toBe("PE002");
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: h.self.id } })).familyName).toBe("試験");
  });

  it("PE005: an address of another account refuses the whole save", async () => {
    const h = await holder();
    const other = await holder();
    expect(code(await saveMypage(h.actor, form({ email: other.acc.email.toUpperCase() })))).toBe("PE005");
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: h.self.id } })).familyName).toBe("試験");
    expect((await prisma.account.findUniqueOrThrow({ where: { id: h.acc.id } })).pendingEmail).toBeNull();
  });

  it("PE053: a card number another patient holds at the clinic refuses the whole save; a confirmed card is never written", async () => {
    const a = await holder();
    const b = await holder();
    await prisma.patientCard.create({ data: { patientId: a.self.id, clinicId: clinicIds[0], cardNo: "DUP-1", enteredByKind: "STAFF", confirmedAt: new Date() } });
    const r = await saveMypage(b.actor, form({ email: b.acc.email, cards: [{ clinicId: clinicIds[0], cardNo: "DUP-1" }] }));
    expect(r.ok ? "ok" : r.errors?.[0]).toEqual({ field: `card:${clinicIds[0]}`, code: "PE053" });
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: b.self.id } })).familyName).toBe("試験");
    // a's confirmed card: a cleared or changed value is ignored
    expect(code(await saveMypage(a.actor, form({ email: a.acc.email, cards: [{ clinicId: clinicIds[0], cardNo: "" }] })))).toBe("PI040");
    expect((await prisma.patientCard.findFirstOrThrow({ where: { patientId: a.self.id } })).cardNo).toBe("DUP-1");
  });

  it("race: two patients saving the same new card number at once → one PI040, one PE053 (UNIQUE patient_cards_clinic_id_card_no_key)", async () => {
    const a = await holder();
    const b = await holder();
    const rs = await Promise.all([a, b].map((h) => saveMypage(h.actor, form({ email: h.acc.email, cards: [{ clinicId: clinicIds[1], cardNo: "RACE-77" }] }))));
    expect(rs.map(code).sort()).toEqual(["PE053", "PI040"]);
    expect(await prisma.patientCard.count({ where: { clinicId: clinicIds[1], cardNo: "RACE-77" } })).toBe(1);
  });
});

describe("P06 e-mail change (7-2, 7-7, event 14)", () => {
  it("pending address + 24 h token + NT-06 to it; the link applies it once; a second open → PE004", async () => {
    const h = await holder();
    const to = `new.${h.acc.email}`;
    const r = await saveMypage(h.actor, form({ email: to.toUpperCase() }));
    expect(r.ok && r.body).toEqual({ code: "PI040", pendingEmail: to });
    expect((await prisma.account.findUniqueOrThrow({ where: { id: h.acc.id } })).email).toBe(h.acc.email); // old stays active
    const token = changeToken(to);
    const row = await prisma.authToken.findUniqueOrThrow({ where: { tokenHash: sha256(token) } });
    expect(row.purpose).toBe("EMAIL_CHANGE");
    expect(row.expiresAt.getTime() - h.actor.now.getTime()).toBeGreaterThanOrEqual(EMAIL_CHANGE_MS - 5000);
    expect(await confirmEmailChange(token)).toEqual({ code: "PI061", accountId: h.acc.id });
    const acc = await prisma.account.findUniqueOrThrow({ where: { id: h.acc.id } });
    expect([acc.email, acc.pendingEmail, acc.emailBouncedAt]).toEqual([to, null, null]);
    expect(acc.emailVerifiedAt).not.toBeNull();
    expect((await confirmEmailChange(token)).code).toBe("PE004"); // single use
    expect((await readSession(h.sid)).state).toBe("valid"); // no session revoked
  });

  it("expired after 24 h → PE004, nothing written; a newer change voids the older token; back to the active address drops it", async () => {
    const h = await holder();
    await saveMypage(h.actor, form({ email: `one.${h.acc.email}` }));
    const t1 = changeToken(`one.${h.acc.email}`);
    expect((await confirmEmailChange(t1, new Date(Date.now() + EMAIL_CHANGE_MS + 1000))).code).toBe("PE004");
    expect((await prisma.account.findUniqueOrThrow({ where: { id: h.acc.id } })).pendingEmail).toBe(`one.${h.acc.email}`);
    await saveMypage(h.actor, form({ email: `two.${h.acc.email}` }));
    expect((await confirmEmailChange(t1)).code).toBe("PE004"); // voided by 更新17
    const t2 = changeToken(`two.${h.acc.email}`);
    expect(code(await saveMypage(h.actor, form({ email: h.acc.email })))).toBe("PI040"); // 7-7
    expect((await prisma.account.findUniqueOrThrow({ where: { id: h.acc.id } })).pendingEmail).toBeNull();
    expect((await confirmEmailChange(t2)).code).toBe("PE004");
  });

  it("14-2: the address taken meanwhile → PE005, pending cleared, token used, e-mail unchanged", async () => {
    const h = await holder();
    const to = `taken.${h.acc.email}`;
    await saveMypage(h.actor, form({ email: to }));
    const token = changeToken(to);
    await prisma.account.create({ data: { email: to, passwordHash: hash, role: "PATIENT", status: "ACTIVE" } });
    expect((await confirmEmailChange(token)).code).toBe("PE005");
    const acc = await prisma.account.findUniqueOrThrow({ where: { id: h.acc.id } });
    expect([acc.email, acc.pendingEmail]).toEqual([h.acc.email, null]);
    expect((await prisma.authToken.findUniqueOrThrow({ where: { tokenHash: sha256(token) } })).usedAt).not.toBeNull();
  });

  it("race: the link opened twice at once applies once", async () => {
    const h = await holder();
    const to = `race.${h.acc.email}`;
    await saveMypage(h.actor, form({ email: to }));
    const token = changeToken(to);
    const rs = await Promise.all([1, 2, 3].map(() => confirmEmailChange(token)));
    expect(rs.map((r) => r.code).sort()).toEqual(["PE004", "PE004", "PI061"]);
  });
});

describe("P06 password change (event 12)", () => {
  it("wrong current → PE018; 5 wrong in 15 min → PE092 unverified; success revokes the other sessions and keeps the current", async () => {
    const h = await holder();
    const other = await login({ ip: IP, userAgent: "jest", email: h.acc.email, password: PW });
    const body = (current: string) => ({ currentPassword: current, newPassword: "Newpass99", newPasswordConfirm: "Newpass99" });
    expect(code(await changePassword(h.actor, { currentPassword: "", newPassword: "x", newPasswordConfirm: "y" }))).toBe("PE001");
    for (let i = 0; i < 5; i++) expect(code(await changePassword(h.actor, body("Wrong999")))).toBe("PE018");
    expect(code(await changePassword(h.actor, body(PW)))).toBe("PE092"); // even the right one, until the window passes
    resetAuthLimits();
    expect(code(await changePassword(h.actor, body(PW)))).toBe("PI049");
    expect((await readSession(other.ok ? other.session!.token : "")).state).toBe("invalid");
    expect((await readSession(h.sid)).state).toBe("valid");
    expect(await prisma.auditLog.count({ where: { accountId: h.acc.id, action: "PASSWORD_CHANGE" } })).toBe(1);
    expect(await bcrypt.compare("Newpass99", (await prisma.account.findUniqueOrThrow({ where: { id: h.acc.id } })).passwordHash)).toBe(true);
  });
});

describe("P06 withdrawal (events 9, 11)", () => {
  async function futureBooking(patientId: string) {
    const b = await prisma.booking.findFirstOrThrow();
    return prisma.booking.create({
      data: {
        bookingNo: `WDRW${String(++seq).padStart(4, "0")}`, clinicId: b.clinicId, departmentId: b.departmentId, visitTypeId: b.visitTypeId,
        doctorId: b.doctorId, doctorRequested: false, patientId, channel: "WEB", slotDate: dbDate(addDays(todayJst(), 3)),
        startTime: b.startTime, endTime: b.endTime, status: "RESERVED",
      },
    });
  }

  it("a future RESERVED booking of a family member blocks it (PE042), nothing written", async () => {
    const h = await holder();
    const child = await prisma.patient.create({ data: { ...person, phone: null, accountId: h.acc.id, relation: "CHILD", createdByKind: "PATIENT" } });
    const bk = await futureBooking(child.id);
    expect(code(await withdraw(h.actor, false))).toBe("PE042");
    expect(code(await withdraw(h.actor, true))).toBe("PE042"); // 11-2 server re-check
    expect((await prisma.account.findUniqueOrThrow({ where: { id: h.acc.id } })).status).toBe("ACTIVE");
    await prisma.booking.update({ where: { id: bk.id }, data: { status: "CANCELED", canceledAt: new Date(), canceledByKind: "PATIENT", cancelReasonCode: "SCHEDULE" } }).catch(() => prisma.booking.delete({ where: { id: bk.id } }));
  });

  it("はい: WITHDRAWN, every session revoked, the cookie dropped and PI041 flagged for P01", async () => {
    const h = await holder();
    const second = await login({ ip: IP, userAgent: "jest", email: h.acc.email, password: PW });
    mockJar.sid = h.sid;
    const res = await withdrawRoute(req("/api/mypage/withdraw", { confirm: true }));
    expect(await res.json()).toMatchObject({ ok: true, destination: "/", code: "PI041" });
    const set = res.headers.getSetCookie().join("\n");
    expect(set).toMatch(/flash=PI041/);
    expect(set).toMatch(/sid=;/);
    const acc = await prisma.account.findUniqueOrThrow({ where: { id: h.acc.id } });
    expect(acc.status).toBe("WITHDRAWN");
    expect(acc.withdrawnAt).not.toBeNull();
    for (const t of [h.sid, second.ok ? second.session!.token : ""]) expect((await readSession(t)).state).toBe("invalid");
  });
});

describe("P06 LINE link (event 5, X2-L fake mode)", () => {
  async function roundTrip(sid: string) {
    mockJar.sid = sid;
    const start = await lineStart(req("/api/mypage/line/start"));
    const cookie = start.headers.getSetCookie().join(";").match(/line_oauth=([^;]+)/)![1];
    const q = new URL(start.headers.get("location")!).searchParams;
    return { cookie, q: { code: q.get("code"), state: q.get("state"), error: null } };
  }

  it("stores the LINE id and FOLLOWING; a wrong state → PE052 and nothing written", async () => {
    const h = await holder();
    const rt = await roundTrip(h.sid);
    expect(await lineCallback(h.acc.id, { ...rt.q, state: "forged" }, rt.cookie)).toBe("PE052");
    expect(await lineCallback(h.acc.id, rt.q, undefined)).toBe("PE052");
    expect((await prisma.account.findUniqueOrThrow({ where: { id: h.acc.id } })).lineUserId).toBeNull();
    expect(await lineCallback(h.acc.id, rt.q, rt.cookie)).toBe("PI043");
    const acc = await prisma.account.findUniqueOrThrow({ where: { id: h.acc.id } });
    expect(acc.lineUserId).toMatch(/^U[0-9a-f]{32}$/);
    expect([acc.lineFriend, acc.notifyChannel]).toEqual(["FOLLOWING", "MAIL"]); // channel unchanged (Q9 d)
  });

  it("a LINE id already linked to another account → PE052 (UNIQUE accounts_line_user_id_key)", async () => {
    const a = await holder();
    const b = await holder();
    const rt = await roundTrip(a.sid);
    expect(await lineCallback(a.acc.id, rt.q, rt.cookie)).toBe("PI043");
    expect(await lineCallback(b.acc.id, rt.q, rt.cookie)).toBe("PE052"); // same code → same LINE user
    expect((await prisma.account.findUniqueOrThrow({ where: { id: b.acc.id } })).lineUserId).toBeNull();
  });

  it("a cancel at LINE (error=…) → PE052", async () => {
    const h = await holder();
    const rt = await roundTrip(h.sid);
    expect(await lineCallback(h.acc.id, { ...rt.q, error: "access_denied" }, rt.cookie)).toBe("PE052");
  });
});

describe("P06 screen", () => {
  it("draws the holder's data, PI059 for a bounced address, 未連携, cards rows, 保存する disabled", async () => {
    const h = await holder();
    const data = await loadMypage(h.acc.id, "ja");
    const html = renderToStaticMarkup(<ToastProvider lang="ja"><MypageForm lang="ja" data={{ ...data, inline: null }} /></ToastProvider>);
    expect(html).toContain("メールが届いていません。");
    expect(html).toContain('value="試験"');
    expect(html).toContain('value="03-1234-5678"');
    expect(html).toContain('value="100-0005"');
    expect(html).toContain("未連携");
    expect(html).toContain('href="/api/mypage/line/start"');
    expect(html).toContain('href="/mypage/family"');
    expect((html.match(/placeholder="未登録"/g) ?? []).length).toBe(clinicIds.length);
    expect(html).toMatch(/class="btn bdis bw" disabled="">保存する/);
    expect(html).toContain("退会すると、ご家族の情報を含めて利用できなくなります。");
  });
});
