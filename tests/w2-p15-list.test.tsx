// spec-screen: P15 — tab rules (予約中 / 受診履歴 incl. 確認中 / キャンセル), the start-time boundary, the 12-month window,
// sort and ties, 20-row paging with もっと見る (count-based), family names, scope (other accounts, detached members),
// the list API (session only, tampered parameters → ER-02), the empty state.
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";

const mockJar: { sid?: string } = {};
jest.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sid" && mockJar.sid ? { value: mockJar.sid } : undefined) }),
  headers: async () => ({ get: () => null }),
}));
jest.mock("next/navigation", () => ({ ...jest.requireActual("next/navigation"), useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));
jest.mock("next/link", () => ({ __esModule: true, default: (p: { href: string; children: React.ReactNode; className?: string }) => <a href={p.href} className={p.className}>{p.children}</a> }));
jest.mock("../app/(patient)/bookings/list.module.css", () => ({}));

import { addDays, jstInstant, todayJst } from "@/lib/datetime";
import { login } from "@/lib/auth/service";
import { listBookings, tabCounts, twelveMonthsBefore } from "@/lib/patient/bookings";
import { pool, prisma } from "@/lib/prisma";
import { GET as listRoute } from "@/app/api/bookings/list/route";
import { ListView } from "@/app/(patient)/bookings/ListView";
import { ToastProvider } from "@/components/ui/Toast";
import { cleanupAccounts, familyMember, holder, rawBooking, world, IP, type World } from "./w2-helpers";

jest.setTimeout(90_000);
let w: World;
const today = todayJst();
const canceled = { status: "CANCELED" as const, canceledAt: new Date(), canceledByKind: "PATIENT" as const, cancelReasonCode: "SCHEDULE" as const };

beforeAll(async () => {
  w = await world();
});
afterAll(async () => {
  await w.cleanup().catch(() => undefined);
  await cleanupAccounts();
  await prisma.$disconnect();
  await pool.end();
});

const get = (q: string) => listRoute(new NextRequest(`http://localhost:3002/api/bookings/list?${q}`));

describe("P15 tabs (抽出1 / 抽出2)", () => {
  it("予約中 = RESERVED future (asc); 受診履歴 = CHECKED_IN, NO_SHOW, RESERVED past as 確認中 (desc); キャンセル = CANCELED", async () => {
    const h = await holder();
    const p = h.self.id;
    const f2 = await rawBooking(w, p, addDays(today, 2), "09:00");
    const f1 = await rawBooking(w, p, addDays(today, 1), "09:00");
    const visited = await rawBooking(w, p, addDays(today, -3), "09:00", { status: "CHECKED_IN", checkedInAt: new Date() });
    const missed = await rawBooking(w, p, addDays(today, -2), "09:00", { status: "NO_SHOW" });
    const pending = await rawBooking(w, p, addDays(today, -1), "09:00");
    const gone = await rawBooking(w, p, addDays(today, 3), "10:00", canceled);
    const up = await listBookings(h.acc.id, "upcoming", 0, "ja");
    expect(up.rows.map((r) => r.id)).toEqual([f1.id, f2.id]);
    expect(up.more).toBe(false);
    const past = await listBookings(h.acc.id, "past", 0, "ja");
    expect(past.rows.map((r) => r.id)).toEqual([pending.id, missed.id, visited.id]);
    expect(past.rows.map((r) => r.status)).toEqual(["確認中", "無断キャンセル", "来院済"]);
    expect(past.rows[0].pending).toBe(true);
    expect((await listBookings(h.acc.id, "canceled", 0, "ja")).rows.map((r) => r.id)).toEqual([gone.id]);
    expect(up.counts).toEqual({ upcoming: 2, past: 3, canceled: 1 });
    expect(up.rows[0].dateText).toMatch(/^\d{4}年\d{1,2}月\d{1,2}日\(.\) 9:00〜$/); // Q7 A: start + 〜
    expect((await listBookings(h.acc.id, "upcoming", 0, "en")).rows[0].dateText).toMatch(/ 9:00$/); // en / vi: start time, no trailing dash (demo polish)
  });

  it("boundary: a booking today at 10:00 is 予約中 until 09:59:59 JST and 受診履歴 (確認中) from 10:00:00", async () => {
    const h = await holder();
    const b = await rawBooking(w, h.self.id, today, "10:00");
    const at = jstInstant(today, "10:00").getTime();
    expect((await listBookings(h.acc.id, "upcoming", 0, "ja", new Date(at - 1000))).rows.map((r) => r.id)).toEqual([b.id]);
    const past = await listBookings(h.acc.id, "past", 0, "ja", new Date(at));
    expect(past.rows.map((r) => [r.id, r.status])).toEqual([[b.id, "確認中"]]);
    expect(past.counts.upcoming).toBe(0);
  });

  it("12 calendar months by slot_date on 受診履歴 and キャンセル (also the counts, Q1 A / Q3 A); ties by booking_no", async () => {
    const h = await holder();
    const edge = twelveMonthsBefore(today);
    const inside = await rawBooking(w, h.self.id, edge, "09:00", { status: "CHECKED_IN" });
    await rawBooking(w, h.self.id, addDays(edge, -1), "09:00", { status: "CHECKED_IN" });
    await rawBooking(w, h.self.id, addDays(edge, -1), "09:00", canceled);
    const a = await rawBooking(w, h.self.id, addDays(today, -5), "09:00", canceled);
    const b = await rawBooking(w, h.self.id, addDays(today, -5), "09:00", canceled);
    const past = await listBookings(h.acc.id, "past", 0, "ja");
    expect(past.rows.map((r) => r.id)).toEqual([inside.id]);
    const c = await listBookings(h.acc.id, "canceled", 0, "ja");
    const desc = [a, b].sort((x, y) => (x.bookingNo < y.bookingNo ? 1 : -1)).map((x) => x.id);
    expect(c.rows.map((r) => r.id)).toEqual(desc);
    expect(await tabCounts(h.acc.id)).toEqual({ upcoming: 0, past: 1, canceled: 2 });
    expect(twelveMonthsBefore("2028-02-29")).toBe("2027-02-28");
    expect(twelveMonthsBefore("2026-10-24")).toBe("2025-10-24");
  });

  it("20 rows per page; もっと見る while the 12-month count is not reached (Q14 A); 予約中 too (Q-040)", async () => {
    const h = await holder();
    for (let i = 1; i <= 25; i++) await rawBooking(w, h.self.id, addDays(today, -i), "09:00", canceled);
    const p1 = await listBookings(h.acc.id, "canceled", 0, "ja");
    expect([p1.rows.length, p1.more]).toEqual([20, true]);
    const p2 = await listBookings(h.acc.id, "canceled", 20, "ja");
    expect([p2.rows.length, p2.more]).toEqual([5, false]);
    expect(new Set([...p1.rows, ...p2.rows].map((r) => r.id)).size).toBe(25);
    for (let i = 1; i <= 21; i++) await rawBooking(w, h.self.id, addDays(today, i), "11:00");
    // Q-040 answer: 予約中 pages like the other tabs
    const up1 = await listBookings(h.acc.id, "upcoming", 0, "ja");
    expect([up1.rows.length, up1.more, up1.counts.upcoming]).toEqual([20, true, 21]);
    const up2 = await listBookings(h.acc.id, "upcoming", 20, "ja");
    expect([up2.rows.length, up2.more]).toEqual([1, false]);
    expect(new Set([...up1.rows, ...up2.rows].map((r) => r.id)).size).toBe(21);
  });

  it("scope: own + family (name with relation only when the account has family); not other accounts, not a detached member", async () => {
    const h = await holder();
    const solo = await listBookings(h.acc.id, "upcoming", 0, "ja");
    expect(solo.rows).toEqual([]);
    await rawBooking(w, h.self.id, addDays(today, 4), "09:00", { doctorRequested: false });
    expect((await listBookings(h.acc.id, "upcoming", 0, "ja")).rows[0].person).toBeNull();
    const kid = await familyMember(h, "次郎");
    await rawBooking(w, kid.id, addDays(today, 5), "09:00");
    const detached = await familyMember(h, "離脱");
    await rawBooking(w, detached.id, addDays(today, 6), "09:00");
    await prisma.patient.update({ where: { id: detached.id }, data: { accountId: null } });
    const other = await holder();
    await rawBooking(w, other.self.id, addDays(today, 4), "10:00");
    const list = await listBookings(h.acc.id, "upcoming", 0, "ja");
    expect(list.rows.map((r) => r.person)).toEqual(["山田 花子（本人）", "山田 次郎（子）"]);
    expect(list.rows[0].doctor).toBe("指名なし（当日の担当医）");
    expect(list.rows[1].clinicDept).toBe(`${w.clinic.nameJa}・試験科`);
    expect((await listBookings(h.acc.id, "upcoming", 0, "en")).rows[1].person).toBe("山田 次郎 (Child)");
  });
});

describe("P15 list API", () => {
  it("session account only; tampered tab / offset → 400 PE090; no session → 401; staff → 403", async () => {
    const h = await holder();
    await rawBooking(w, h.self.id, addDays(today, 2), "12:00");
    mockJar.sid = h.sid;
    const ok = await get("tab=upcoming&offset=0");
    expect(ok.status).toBe(200);
    expect((await ok.json()).rows).toHaveLength(1);
    for (const q of ["tab=all&offset=0", "tab=past&offset=7", "tab=past&offset=-20", "tab=past&offset=1000", "tab=past&offset=x"]) {
      const res = await get(q);
      expect([q, res.status, (await res.json()).code]).toEqual([q, 400, "PE090"]);
    }
    mockJar.sid = undefined;
    expect((await get("tab=upcoming&offset=0")).status).toBe(401);
    const staff = await login({ ip: IP, userAgent: "jest", email: "reception.honin@example.jp", password: "Demo1234" });
    mockJar.sid = staff.ok ? staff.session!.token : "";
    expect((await get("tab=upcoming&offset=0")).status).toBe(403);
  });
});

describe("P15 screen", () => {
  it("empty 予約中: PI045 with 予約する → /booking/new; rows: one Tab stop, 確認中 with PI055, link to the opaque id", async () => {
    const h = await holder();
    const empty = renderToStaticMarkup(<ToastProvider lang="ja"><ListView lang="ja" initial={await listBookings(h.acc.id, "upcoming", 0, "ja")} /></ToastProvider>);
    expect(empty).toContain("該当するご予約はありません。");
    expect(empty).toContain('href="/booking/new?from=bookings"'); // T061: P11 knows the origin P15 (中止 returns there)
    const b1 = await rawBooking(w, h.self.id, addDays(today, 2), "09:00");
    await rawBooking(w, h.self.id, addDays(today, 3), "09:00");
    const out = renderToStaticMarkup(<ToastProvider lang="ja"><ListView lang="ja" initial={await listBookings(h.acc.id, "upcoming", 0, "ja")} /></ToastProvider>);
    expect(out).toContain(`href="/bookings/${b1.id}"`);
    expect(out.match(/data-testid="p15-row" tabindex="0"|tabindex="0"[^>]*data-testid="p15-row"/g)).toHaveLength(1);
    expect(out).toContain("予約中<span>2</span>");
    expect(out).not.toContain('data-testid="p15-more"');
    expect(out).not.toContain(b1.bookingNo); // 予約番号 shown hyphenated
    expect(out).toContain(`${b1.bookingNo.slice(0, 4)}-${b1.bookingNo.slice(4)}`);
  });
});
