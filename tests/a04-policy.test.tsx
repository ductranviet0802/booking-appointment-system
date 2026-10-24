// A04 通知テンプレート・キャンセルポリシー: access (admin only, expired session), the §4.2 checks, SE060 (Q9), the preview (Q7 / Q8),
// SW061 / SW062 round trips (Q10), INSERT / UPDATE / no-change with their audit rows (Q18), two first saves at once (unique key
// clinic × event × channel × language keeps one row, last save wins), the policy save with B2 (EVENT) and SE044 when B2 cannot run.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { guardScreen } from "@/lib/auth/context";
import { loadState } from "@/lib/admin/policy";
import { charCount, fillPreview, placeholdersOf, sampleVars, unknownPlaceholders, validatePolicy, type PolicyValues } from "@/lib/admin/policy-rules";
import { addDays, dbDate, todayJst, toHhmm } from "@/lib/datetime";
import { formatDate } from "@/lib/i18n/format";
import { pool, prisma } from "@/lib/prisma";
import { cleanupStaff, makeStaff, request } from "./a03-helpers";
import { fixture, type Fixture } from "./b2-helpers";

process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
process.env.NOTIFY_OUTBOX_DIR = mkdtempSync(path.join(tmpdir(), "a04-outbox-"));
const mockJar: { sid?: string; path: string } = { path: "/admin/policy" };
jest.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sid" && mockJar.sid ? { value: mockJar.sid } : undefined) }),
  headers: async () => ({ get: (n: string) => (n === "x-pathname" ? mockJar.path : null) }),
}));
jest.mock("../app/(staff)/admin/policy/policy.module.css", () => ({}));
jest.mock("@/components/ui/Toast", () => ({ useToast: () => ({ toast: jest.fn() }), useLang: () => "ja" }));
jest.mock("@/lib/client/api", () => ({ useApiFetch: () => jest.fn(), postJson: jest.fn(), openStaffErrorScreen: jest.fn() }));

import { POST as postPreview } from "@/app/api/admin/policy/preview/route";
import { POST as postPolicy } from "@/app/api/admin/policy/save/route";
import { GET as getTemplate, POST as postTemplate } from "@/app/api/admin/policy/template/route";
import { PolicyClient } from "@/app/(staff)/admin/policy/PolicyClient";

jest.setTimeout(120_000);

let f: Fixture;
let admin: Awaited<ReturnType<typeof makeStaff>>;
let reception: Awaited<ReturnType<typeof makeStaff>>;
let doctor: Awaited<ReturnType<typeof makeStaff>>;
const as = (t: string | undefined) => { mockJar.sid = t; };

type Answer = {
  code?: string; params?: Record<string, string | number>; errors?: { field: string; code: string; params?: Record<string, unknown> }[];
  confirm?: string; preview?: { subject: string | null; body: string; count: number | null }; template?: { subject: string; body: string; exists: boolean };
  policy?: Record<string, unknown>;
};
const send = async (route: (r: ReturnType<typeof request>) => Promise<Response> | Response, url: string, body?: unknown) => {
  const res = await route(request(url, body));
  return { status: res.status, body: (await res.json()) as Answer };
};
const saveT = (b: Record<string, unknown>) => send(postTemplate, "/api/admin/policy/template", b);
const saveP = (b: Record<string, unknown>) => send(postPolicy, "/api/admin/policy/save", b);
const audits = (targetType: string) => prisma.auditLog.findMany({ where: { clinicId: f.clinic.id, action: "MASTER_UPDATE", targetType }, orderBy: { id: "asc" } });
const NT02 = { event: "NT02_REMIND", channel: "MAIL", language: "JA" };

const form = (o: Partial<PolicyValues> = {}): PolicyValues => ({
  frameMinutes: 15, frameCapacity: "1", bookingWindowDays: "30", sameDayCutoffMinutes: "30", cancelDeadlineType: "PREV_DAY_TIME", cancelDeadlineTime: "23:59",
  cancelDeadlineHours: "", perPersonDailyLimit: "1", reminderTime: "10:00", phoneMessageJa: "お電話ください", phoneMessageEn: "", phoneMessageVi: "", ...o,
});

beforeAll(async () => {
  f = await fixture({ doctors: 1 });
  admin = await makeStaff("ADMIN", { clinics: [f.tag] });
  reception = await makeStaff("RECEPTION", { clinics: [f.tag] });
  doctor = await makeStaff("DOCTOR", { clinics: [f.tag] });
});

afterAll(async () => {
  await prisma.notificationTemplate.deleteMany({ where: { clinicId: f.clinic.id } });
  await f.cleanup();
  await cleanupStaff();
  await prisma.$disconnect();
  await pool.end();
});

describe("rules", () => {
  it("SE060 names: unknown {{name}} of subject and body, each once, joined with 、; a broken {{ or other characters stay text (Q9)", () => {
    expect(unknownPlaceholders("NT01_BOOKED", "{{clinic_name}} {{date}}", "{{date}} {{doctor}} {{reset_url}} {{ x }} {{a-b}} {{open")).toBe("{{date}}、{{doctor}}、{{reset_url}}");
    expect(unknownPlaceholders("NT05_PW_RESET", "{{reset_url}} {{valid_minutes}}")).toBe("");
    expect(unknownPlaceholders("NT06_VERIFY", "{{verify_url}} {{valid_hours}} {{booking_no}}")).toBe("{{booking_no}}");
    expect(placeholdersOf("NT07_ADJUST")).toHaveLength(12);
  });

  it("preview fill keeps an unknown name as typed; SMS sample uses the short URL; count = characters (surrogate pair = 1)", () => {
    const v = sampleVars({ language: "EN", channel: "SMS", today: "2026-10-22", clinicName: "Main", clinicPhone: "03-1234-5678" });
    expect(fillPreview("{{patient_name}} {{visit_date}} {{deadline}} {{booking_url}} {{nope}}", v))
      .toBe("Taro Yamada Fri, 23 Oct 2026 Thu, 22 Oct 2026 23:59 https://bk.example.jp/b/x7Q {{nope}}");
    expect(charCount("𠮷あa")).toBe(3);
  });

  it("policy checks: required (spaces = empty), integer ranges, HH:MM, reminder 07:00–20:00, only the chosen deadline field, 300 characters", () => {
    const codes = (v: PolicyValues) => validatePolicy(v).map((e) => `${e.field}:${e.code}`);
    expect(codes(form())).toEqual([]);
    expect(codes(form({ frameCapacity: " ", bookingWindowDays: "6", sameDayCutoffMinutes: "２０", perPersonDailyLimit: "4" })))
      .toEqual(["frameCapacity:SE001", "bookingWindowDays:SE002", "sameDayCutoffMinutes:SE002", "perPersonDailyLimit:SE002"]);
    expect(codes(form({ sameDayCutoffMinutes: "0", bookingWindowDays: "180", frameCapacity: "10" }))).toEqual([]);
    expect(codes(form({ reminderTime: "06:59" }))).toEqual(["reminderTime:SE002"]);
    expect(codes(form({ reminderTime: "20:00" }))).toEqual([]);
    expect(codes(form({ cancelDeadlineTime: "24:00" }))).toEqual(["cancelDeadlineTime:SE002"]);
    expect(codes(form({ cancelDeadlineType: "HOURS_BEFORE", cancelDeadlineTime: "xx", cancelDeadlineHours: "49" }))).toEqual(["cancelDeadlineHours:SE002"]);
    expect(codes(form({ phoneMessageJa: "　", phoneMessageVi: "a".repeat(301) }))).toEqual(["phoneMessageJa:SE001", "phoneMessageVi:SE003"]);
  });
});

describe("access", () => {
  async function outcome(sid: string | undefined) {
    as(sid);
    try {
      await guardScreen("A04");
      return "allow";
    } catch (e) {
      const d = (e as { digest?: string }).digest ?? "";
      return d.startsWith("NEXT_REDIRECT") ? "redirect" : d.startsWith("NEXT_HTTP_ERROR_FALLBACK") ? `http:${d.split(";")[1]}` : "other";
    }
  }

  it("page: ADMIN only; RECEPTION and DOCTOR → ER-03; anonymous → login", async () => {
    expect(await outcome(admin.token)).toBe("allow");
    expect(await outcome(reception.token)).toBe("http:403");
    expect(await outcome(doctor.token)).toBe("http:403");
    expect(await outcome(undefined)).toBe("redirect");
  });

  it("role escalation: every route answers RECEPTION / DOCTOR with 403 SE091 and writes nothing; anonymous / expired session 401", async () => {
    const before = await prisma.auditLog.count({ where: { clinicId: f.clinic.id } });
    for (const token of [reception.token, doctor.token]) {
      as(token);
      expect((await saveT({ ...NT02, subject: "x", body: "y" })).status).toBe(403);
      expect((await saveP(form())).body.code).toBe("SE091");
      expect((await send(postPreview, "/api/admin/policy/preview", { ...NT02, subject: "", body: "" })).status).toBe(403);
      expect((await send(getTemplate, "/api/admin/policy/template?event=NT01_BOOKED&channel=MAIL&language=JA")).status).toBe(403);
    }
    as(undefined);
    expect((await saveP(form())).status).toBe(401);
    const expired = await makeStaff("ADMIN", { clinics: [f.tag] });
    await prisma.session.updateMany({ where: { accountId: expired.account.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    as(expired.token);
    expect((await saveP(form())).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { clinicId: f.clinic.id } })).toBe(before);
  });
});

describe("templates", () => {
  beforeEach(() => as(admin.token));

  it("values the UI cannot produce → ER-02 (SE090): unknown event, LINE for NT-05, a non-string body", async () => {
    expect((await saveT({ event: "NT99", channel: "MAIL", language: "JA", subject: "a", body: "b" })).body.code).toBe("SE090");
    expect((await saveT({ event: "NT05_PW_RESET", channel: "LINE", language: "JA", subject: "", body: "b" })).body.code).toBe("SE090");
    expect((await saveT({ ...NT02, subject: "a", body: 5 })).body.code).toBe("SE090");
    expect((await send(getTemplate, "/api/admin/policy/template?event=NT06_VERIFY&channel=SMS&language=JA")).body.code).toBe("SE090");
  });

  it("checks: 件名 required for MAIL / ≤ 100, 本文 required, SE060 with the subject checked too; all errors together, nothing written", async () => {
    const r = await saveT({ ...NT02, subject: "あ".repeat(101), body: "{{date}} です {{doctor}}" });
    expect(r.status).toBe(400);
    expect(r.body.errors!.map((e) => `${e.field}:${e.code}`)).toEqual(["subject:SE003", "body:SE060"]);
    expect(r.body.errors![1].params).toEqual({ 項目: "{{date}}、{{doctor}}" });
    const s = await saveT({ ...NT02, subject: "{{foo}}", body: " " });
    expect(s.body.errors!.map((e) => `${e.field}:${e.code}`)).toEqual(["body:SE001", "subject:SE060"]);
    expect(await prisma.notificationTemplate.count({ where: { clinicId: f.clinic.id } })).toBe(0);
  });

  it("no row → empty form; save inserts (audit: every column); same text again → no UPDATE, no audit; a change → UPDATE of the changed column", async () => {
    const empty = await send(getTemplate, "/api/admin/policy/template?event=NT02_REMIND&channel=MAIL&language=EN");
    expect(empty.body.template).toEqual({ subject: "", body: "", exists: false });
    const combo = { ...NT02, language: "EN" };
    expect((await saveT({ ...combo, subject: "Hi {{clinic_name}}", body: "Body {{visit_date}}" })).body.code).toBe("SI060");
    let a = await audits("notification_templates");
    expect(a).toHaveLength(1);
    expect((a[0].detail as { columns: string[] }).columns).toEqual(["id", "clinic_id", "event", "channel", "language", "subject", "body"]);
    expect((await saveT({ ...combo, subject: "Hi {{clinic_name}}", body: "Body {{visit_date}}" })).body.code).toBe("SI060"); // double submit
    expect(await audits("notification_templates")).toHaveLength(1);
    await saveT({ ...combo, subject: "Hi {{clinic_name}}", body: "Body 2 {{visit_date}}" });
    a = await audits("notification_templates");
    expect((a[1].detail as { columns: string[] }).columns).toEqual(["body"]);
    expect(a[1].targetId).toBe(a[0].targetId);
    const row = await prisma.notificationTemplate.findFirstOrThrow({ where: { clinicId: f.clinic.id, event: "NT02_REMIND", language: "EN" } });
    expect([row.body, row.updatedBy]).toEqual(["Body 2 {{visit_date}}", admin.account.id]);
  });

  it("LINE / SMS: no subject written (null), even when one is sent", async () => {
    await saveT({ event: "NT03_CHANGED", channel: "LINE", language: "JA", subject: "ignored", body: "変更 {{booking_no}}" });
    const row = await prisma.notificationTemplate.findFirstOrThrow({ where: { clinicId: f.clinic.id, event: "NT03_CHANGED", channel: "LINE" } });
    expect(row.subject).toBeNull();
  });

  it("SMS over 70 after expansion → confirm SW061 with the count, nothing written; はい (confirmed) saves; ≤ 70 saves at once", async () => {
    const combo = { event: "NT01_BOOKED", channel: "SMS", language: "JA" };
    const long = "{{clinic_name}}: {{visit_date}} {{visit_time}}のご予約を承りました。ご来院をお待ちしております。{{booking_url}}";
    const c = await saveT({ ...combo, subject: "", body: long });
    const p = await send(postPreview, "/api/admin/policy/preview", { ...combo, subject: "", body: long });
    expect(c.body.confirm).toBe("SW061");
    expect(c.body.params!.n).toBe(p.body.preview!.count);
    expect(Number(c.body.params!.n)).toBeGreaterThan(70);
    expect(await prisma.notificationTemplate.count({ where: { clinicId: f.clinic.id, event: "NT01_BOOKED", channel: "SMS" } })).toBe(0);
    expect((await saveT({ ...combo, subject: "", body: long, confirmed: true })).body.code).toBe("SI060");
    // the confirmed request still runs the checks (7-3)
    expect((await saveT({ ...combo, subject: "", body: "{{bad}}", confirmed: true })).body.errors![0].code).toBe("SE060");
    expect((await saveT({ ...combo, subject: "", body: "{{clinic_name}} {{booking_url}}" })).body.code).toBe("SI060");
  });

  it("preview: subject for MAIL only, unknown names kept, the clinic name / hyphenated phone of the session clinic, tomorrow in full style", async () => {
    const before = (await audits("notification_templates")).length;
    const r = await send(postPreview, "/api/admin/policy/preview", { ...NT02, subject: "【{{clinic_name}}】", body: "{{visit_date}} {{clinic_phone}} {{x}}" });
    expect(r.body.preview).toEqual({
      subject: `【${f.clinic.nameJa}】`, body: `${formatDate(addDays(todayJst(), 1), "ja")} 03-0000-0000 {{x}}`, count: null,
    });
    expect(await audits("notification_templates")).toHaveLength(before); // nothing written by the preview
  });

  it("two first saves of one combination at once: one row (unique key), both answer SI060, the later text stays", async () => {
    const combo = { event: "NT07_ADJUST", channel: "MAIL", language: "VI" };
    const [x, y] = await Promise.all([
      saveT({ ...combo, subject: "A", body: "a {{booking_no}}" }), saveT({ ...combo, subject: "B", body: "b {{booking_no}}" }),
    ]);
    expect([x.body.code, y.body.code]).toEqual(["SI060", "SI060"]);
    const rows = await prisma.notificationTemplate.findMany({ where: { clinicId: f.clinic.id, ...combo } as never });
    expect(rows).toHaveLength(1);
    expect(["a {{booking_no}}", "b {{booking_no}}"]).toContain(rows[0].body);
    const a = (await audits("notification_templates")).filter((r) => r.targetId === rows[0].id);
    expect(a.map((r) => (r.detail as { columns: string[] }).columns.length)).toEqual([7, 2]); // INSERT, then the later UPDATE
  });
});

describe("policy", () => {
  beforeEach(() => as(admin.token));
  const row = () => prisma.bookingPolicy.findUniqueOrThrow({ where: { clinicId: f.clinic.id } });

  it("no row → the 03 defaults; the first save inserts with the form values (audit: every column)", async () => {
    await prisma.bookingPolicy.delete({ where: { clinicId: f.clinic.id } });
    const s = await loadState(f.clinic.id);
    expect(s.policy).toMatchObject({ stored: false, frameMinutes: 15, frameCapacity: "1", reminderTime: "10:00", cancelDeadlineTime: "23:59", phoneMessageJa: "" });
    const r = await saveP(form({ phoneMessageEn: "Call us" }));
    expect(r.body.code).toBe("SI060");
    const p = await row();
    expect([p.phoneMessageJa, p.phoneMessageEn, p.phoneMessageVi, p.updatedBy]).toEqual(["お電話ください", "Call us", null, admin.account.id]);
    const a = await audits("booking_policies");
    expect(a).toHaveLength(1);
    expect(a[0].targetId).toBe(f.clinic.id);
    expect((a[0].detail as { columns: string[] }).columns).toHaveLength(13);
  });

  it("server checks → field errors, nothing written; items 10 / 14 outside their options → SE090", async () => {
    expect((await saveP(form({ frameCapacity: "11", reminderTime: "" }))).body.errors!.map((e) => e.code)).toEqual(["SE002", "SE001"]);
    expect((await saveP({ ...form(), frameMinutes: 25 })).body.code).toBe("SE090");
    expect((await saveP({ ...form(), cancelDeadlineType: "NEVER" })).body.code).toBe("SE090");
    expect(await audits("booking_policies")).toHaveLength(1);
  });

  it("no change → SI060, no UPDATE, no audit; a change writes only the changed columns; the other deadline field keeps its value (Q14)", async () => {
    expect((await saveP(form({ phoneMessageEn: "Call us" }))).body.code).toBe("SI060");
    expect(await audits("booking_policies")).toHaveLength(1);
    await saveP(form({ phoneMessageEn: "Call us", cancelDeadlineType: "HOURS_BEFORE", cancelDeadlineHours: "3", cancelDeadlineTime: "zz" }));
    const p = await row();
    expect([p.cancelDeadlineType, p.cancelDeadlineHours, toHhmm(p.cancelDeadlineTime!)]).toEqual(["HOURS_BEFORE", 3, "23:59"]);
    const a = await audits("booking_policies");
    expect((a[1].detail as { columns: string[] }).columns).toEqual(["cancel_deadline_type", "cancel_deadline_hours"]);
  });

  it("frame length change → SW062 with latest slot_date + 1 (full style), nothing written; はい saves; no B2 run", async () => {
    const run = await prisma.batchRun.create({
      data: { jobCode: "B2", trigger: "MANUAL", clinicId: f.clinic.id, startedAt: new Date(), status: "SUCCESS", readCount: 0, writtenCount: 0, errorCount: 0 },
    });
    const last = addDays(todayJst(), 20);
    await prisma.slot.create({
      data: {
        clinicId: f.clinic.id, departmentId: f.dept.id, doctorId: f.doctors[0].id, slotDate: dbDate(last), startTime: new Date("1970-01-01T09:00:00Z"),
        endTime: new Date("1970-01-01T09:15:00Z"), capacity: 1, status: "OPEN", generatedRunId: run.id,
      },
    });
    const base = form({ phoneMessageEn: "Call us", cancelDeadlineType: "HOURS_BEFORE", cancelDeadlineHours: "3" });
    const c = await saveP({ ...base, frameMinutes: 30 });
    expect(c.body).toMatchObject({ confirm: "SW062", params: { 日付: formatDate(addDays(last, 1), "ja") } });
    expect((await row()).frameMinutes).toBe(15);
    const runs = await prisma.batchRun.count({ where: { clinicId: f.clinic.id, jobCode: "B2" } });
    expect((await saveP({ ...base, frameMinutes: 30, confirmed: true })).body.code).toBe("SI060");
    expect((await row()).frameMinutes).toBe(30);
    expect(await prisma.batchRun.count({ where: { clinicId: f.clinic.id, jobCode: "B2" } })).toBe(runs);
  });

  it("window change → B2 (EVENT) for the clinic after the commit; B2 lock taken → SE044, the policy stays saved", async () => {
    const base = form({ phoneMessageEn: "Call us", cancelDeadlineType: "HOURS_BEFORE", cancelDeadlineHours: "3", frameMinutes: 30 } as Partial<PolicyValues>);
    expect((await saveP({ ...base, bookingWindowDays: "60" })).body.code).toBe("SI060");
    const ev = await prisma.batchRun.findFirstOrThrow({ where: { clinicId: f.clinic.id, jobCode: "B2", trigger: "EVENT" }, orderBy: { startedAt: "desc" } });
    expect(ev.status).toBe("SUCCESS");

    const holder = await pool.connect();
    try {
      await holder.query("SELECT pg_advisory_lock(hashtext('batch:B2'))");
      const r = await saveP({ ...base, bookingWindowDays: "90" });
      expect([r.status, r.body.code]).toEqual([409, "SE044"]);
      expect((await row()).bookingWindowDays).toBe(90);
    } finally {
      await holder.query("SELECT pg_advisory_unlock(hashtext('batch:B2'))");
      holder.release();
    }
  });

  it("two policy saves at once: one row (primary key clinic_id), both SI060", async () => {
    const base = form({ phoneMessageEn: "Call us", cancelDeadlineType: "HOURS_BEFORE", cancelDeadlineHours: "3", frameMinutes: 30, bookingWindowDays: "90" } as Partial<PolicyValues>);
    const [x, y] = await Promise.all([saveP({ ...base, perPersonDailyLimit: "2" }), saveP({ ...base, perPersonDailyLimit: "3" })]);
    expect([x.body.code, y.body.code]).toEqual(["SI060", "SI060"]);
    expect([2, 3]).toContain((await row()).perPersonDailyLimit);
    expect(await prisma.bookingPolicy.count({ where: { clinicId: f.clinic.id } })).toBe(1);
  });
});

describe("page", () => {
  it("opens on the template tab with NT-01 × メール × 日本語, the placeholder list of NT-01 and the LINE count", async () => {
    const html = renderToStaticMarkup(<PolicyClient initial={await loadState(f.clinic.id)} />);
    expect(html).toContain("通知・ポリシー");
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("LINE送信数（今月）");
    expect(html).toContain("{{booking_url}}");
    expect(html).not.toContain("{{reset_url}}");
    expect(html).toContain("英語・ベトナム語が空の場合は日本語で送信します。");
    expect(html).toContain("保存すると次回の送信から適用されます。");
  });
});
