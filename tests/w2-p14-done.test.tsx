// spec-screen: P14 — states 基 / ① / ② (reload after a cancel), PI054 destination (row choice, masking, hidden when not
// sent), 指名なし label, 問診 step, own / family only (another account → ER-01), formats.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

const mockJar: { sid?: string } = {};
jest.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sid" && mockJar.sid ? { value: mockJar.sid } : undefined) }),
  headers: async () => ({ get: () => null }),
}));
jest.mock("@/lib/auth/context", () => ({ ...jest.requireActual("@/lib/auth/context"), guardScreen: jest.fn(async () => null) }));
jest.mock("@/lib/frame/data", () => ({ getLanguage: jest.fn(async () => "ja") }));
jest.mock("next/link", () => ({ __esModule: true, default: (p: { href: string; children: React.ReactNode; className?: string }) => <a href={p.href} className={p.className}>{p.children}</a> }));
jest.mock("../app/(patient)/bookings/[id]/done/done.module.css", () => ({}));
process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
process.env.NOTIFY_OUTBOX_DIR = mkdtempSync(path.join(tmpdir(), "w2-p14-"));

import { cancelBooking, changeBooking } from "@/lib/booking/core";
import { toHhmm, toIsoDate } from "@/lib/datetime";
import { loadDone, maskDestination } from "@/lib/patient/bookings";
import { pool, prisma } from "@/lib/prisma";
import BookingDonePage from "@/app/(patient)/bookings/[id]/done/page";
import { DoneView } from "@/app/(patient)/bookings/[id]/done/DoneView";
import { book, cleanupAccounts, familyMember, frame, holder, interrupt, world, type World } from "./w2-helpers";

jest.setTimeout(90_000);
let w: World;

beforeAll(async () => {
  w = await world();
});
afterAll(async () => {
  await w.cleanup().catch(() => undefined);
  await cleanupAccounts();
  await prisma.$disconnect();
  await pool.end();
});

const html = async (id: string, accountId: string, lang: "ja" | "en" | "vi" = "ja") =>
  renderToStaticMarkup(<DoneView data={(await loadDone(id, accountId, lang))!} lang={lang} />);

describe("P14 states", () => {
  it("基: PI052, 予約番号 ABCD-1234, date with year (Q4 A), PI054 with the masked NT-01 mail address, three steps for 再診", async () => {
    const h = await holder();
    const b = await book(w, h, h.self.id, 3, "09:00");
    const out = await html(b.id, h.acc.id);
    expect(out).toContain("ご予約が確定しました。");
    expect(out).toContain(`${b.bookingNo.slice(0, 4)}-${b.bookingNo.slice(4)}`);
    expect(out).toMatch(/\d{4}年\d{1,2}月\d{1,2}日\(.\) 9:00〜9:15/);
    expect(out).toContain(`予約内容を<b>${h.acc.email.slice(0, 2)}***@example.jp</b>にお送りしました。`);
    expect(out).toContain("山田 花子 様");
    expect(out).toContain(`href="tel:0300000000"`);
    expect(out).toContain(">03-0000-0000<");
    expect(out).toContain(`href="/bookings/${b.id}"`); // 11 → P16
    expect(out).toContain(`href="/clinics/${w.clinic.code}"`); // 12 → P10 (Q12 B)
    expect(out.indexOf(`/bookings/${b.id}"`)).toBeLessThan(out.indexOf(`/clinics/${w.clinic.code}"`)); // Tab 11 → 12
    expect(out).not.toContain("問診");
    expect(out).toContain("試験科・再診");
  });

  it("①: after a change PI053 and the destination of the NT-03 row", async () => {
    const h = await holder();
    const b = await book(w, h, h.self.id, 4, "09:00");
    await frame(w, toIsoDate(b.slotDate), "09:15");
    const r = await changeBooking(b.id, b.version, {
      clinicId: w.clinic.id, departmentId: w.dept.id, visitTypeId: w.visitType.id, patientId: h.self.id, doctorId: w.doctors[0].id,
      doctorRequested: true, slotDate: toIsoDate(b.slotDate), startTime: "09:15", notes: null,
    }, h.actor, { overrideLimit: true });
    expect(r.ok).toBe(true);
    // only the NT-03 row may feed item 10 in ①: make it SMS so the two rows differ
    await prisma.notification.updateMany({ where: { bookingId: b.id, event: "NT03_CHANGED" }, data: { channel: "SMS", toAddress: "+819011112222", status: "SENT" } });
    const out = await html(b.id, h.acc.id);
    expect(out).toContain("ご予約を変更しました。");
    expect(out).toContain("<b>090-****-2222</b>");
    expect(toHhmm((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).startTime)).toBe("09:15");
  });

  it("②: the same URL after a cancel shows the real status (キャンセル済 badge), no PI052, the rest kept (Q10)", async () => {
    const h = await holder();
    const b = await book(w, h, h.self.id, 5, "09:00");
    expect((await cancelBooking({ bookingId: b.id, version: b.version, reasonCode: "SCHEDULE", reasonText: null }, h.actor)).ok).toBe(true);
    const out = await html(b.id, h.acc.id);
    expect(out).not.toContain("ご予約が確定しました。");
    expect(out).toContain('data-testid="p14-status"');
    expect(out).toContain("キャンセル済");
    expect(out).toContain('data-testid="p14-copy"');
    expect(out).toContain('data-testid="p14-destination"'); // Q10 d A: NT-01 row still shown
  });

  it("PI054 hidden for FAILED / SKIPPED / no row; LINE shows the word only; 指名なし label never the doctor's name", async () => {
    const h = await holder();
    const b = await book(w, h, h.self.id, 6, "10:00", { doctorRequested: false });
    await prisma.notification.updateMany({ where: { bookingId: b.id }, data: { status: "FAILED" } });
    let out = await html(b.id, h.acc.id);
    expect(out).not.toContain('data-testid="p14-destination"');
    expect(out).toContain("指名なし（当日の担当医）");
    expect(out).not.toContain(w.doctors[0].familyName);
    await prisma.notification.updateMany({ where: { bookingId: b.id }, data: { status: "QUEUED", channel: "LINE", toAddress: "U1234567890" } });
    out = await html(b.id, h.acc.id);
    expect(out).toContain("<b>LINE</b>");
    expect(out).not.toContain("U1234567890");
    await prisma.notification.deleteMany({ where: { bookingId: b.id } });
    expect(await html(b.id, h.acc.id)).not.toContain('data-testid="p14-destination"');
  });

  it("初診 new booking: four steps with 問診; en / vi texts and formats; notice box in the language with ja fallback", async () => {
    const h = await holder();
    const vt = await prisma.visitType.create({
      data: { clinicId: w.clinic.id, departmentId: w.dept.id, code: "F", category: "FIRST", nameJa: "初診", nameEn: "First visit", durationFrames: 1, questionnaireRequired: true, displayOrder: 2, noticeJa: "保険証をお持ちください" },
    });
    const b = await book(w, h, h.self.id, 7, "11:00");
    await prisma.booking.update({ where: { id: b.id }, data: { visitTypeId: vt.id } });
    const ja = await html(b.id, h.acc.id);
    expect(ja).toContain("問診");
    expect(ja).toContain("保険証をお持ちください");
    const en = await html(b.id, h.acc.id, "en");
    expect(en).toContain("Your booking is confirmed.");
    expect(en).toMatch(/[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2} \d{4} 11:00–11:15/);
    expect(en).toContain("Questionnaire");
    expect(en).toContain("保険証をお持ちください"); // notice_en empty → ja (F13-06)
    expect(en).toContain("<dd>山田 花子</dd>"); // nameType JP stays 姓 名 in en; 様 in ja only (Q6 b A)
    expect(en).not.toContain("様");
    const vi = await html(b.id, h.acc.id, "vi");
    expect(vi).toContain("Lịch hẹn đã được xác nhận.");
  });
});

describe("P14 access (T065 / T099)", () => {
  it("own and family booking → rendered; another account's or an unknown id → ER-01 (404), nothing disclosed", async () => {
    const me = await holder();
    const kid = await familyMember(me);
    const mine = await book(w, me, kid.id, 8, "09:00");
    const other = await holder();
    const theirs = await book(w, other, other.self.id, 8, "09:30");
    mockJar.sid = me.sid;
    expect(await interrupt(() => BookingDonePage({ params: Promise.resolve({ id: mine.id }) }))).toBe("rendered");
    expect(await interrupt(() => BookingDonePage({ params: Promise.resolve({ id: theirs.id }) }))).toBe("404");
    expect(await interrupt(() => BookingDonePage({ params: Promise.resolve({ id: "not-a-uuid" }) }))).toBe("404");
    expect(await interrupt(() => BookingDonePage({ params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }) }))).toBe("404");
    expect(await loadDone(theirs.id, me.acc.id, "ja")).toBeNull();
    mockJar.sid = undefined;
    expect(await interrupt(() => BookingDonePage({ params: Promise.resolve({ id: mine.id }) }))).toBe("401"); // no session → ER-05 path
  });
});

describe("P14 masking (F6-06, Q3)", () => {
  it("MAIL 2 + *** + @domain; SMS 11 digits 3 + **** + 4, 10 digits 2 + **** + 4; LINE the word", () => {
    expect(maskDestination("MAIL", "yamada@example.jp")).toBe("ya***@example.jp");
    expect(maskDestination("MAIL", "a@example.jp")).toBe("a***@example.jp");
    expect(maskDestination("SMS", "+819012345678")).toBe("090-****-5678");
    expect(maskDestination("SMS", "+81312345678")).toBe("03-****-5678");
    expect(maskDestination("LINE", "Uabc")).toBe("LINE");
  });
});
