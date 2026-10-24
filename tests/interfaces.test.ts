// X1–X5 adapters with their local fakes, and the batch runner (real, seeded database; rows created here are removed).
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import iconv from "iconv-lite";
import { pool, prisma } from "@/lib/prisma";
import { deliver, queueNotification, quietUntil, recordMailBounce } from "@/lib/notify/queue";
import { fill } from "@/lib/notify/render";
import { defaultTemplateRows } from "@/lib/notify/templates-default";
import { cleanTown, lookupPostcode, normalizePostcode, X4UnavailableError } from "@/lib/adapters/x4-postcode";
import { buildX5Csv, toCp932Safe, writeX5File, x5FileName } from "@/lib/adapters/x5-csv";
import { JOBS } from "@/lib/batch/jobs";
import { runJob } from "@/lib/batch/runner";
import { dueJobs } from "@/lib/batch/schedule";

const outbox = mkdtempSync(path.join(tmpdir(), "outbox-"));
const x5dir = mkdtempSync(path.join(tmpdir(), "x5-"));
process.env.NOTIFY_OUTBOX_DIR = outbox;
process.env.X5_DIR = x5dir;

const DAYTIME = new Date("2026-10-23T03:00:00Z"); // 12:00 JST
const MARK = "ifacetest";

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { toAddress: { contains: MARK } } });
  await prisma.batchRun.deleteMany({ where: { params: { path: ["test"], equals: MARK } } });
  await prisma.account.updateMany({ where: { email: "yamada.taro@example.jp" }, data: { emailBouncedAt: null } });
  await prisma.$disconnect();
  await pool.end();
});

describe("X1 / X2 notifications", () => {
  const mail = (to: string) => ({ event: "NT05_PW_RESET" as const, channel: "MAIL" as const, language: "JA" as const, toAddress: to, vars: { reset_url: "https://x/r", valid_minutes: "30" } });

  it("sends at once through the fake and logs the rendered text", async () => {
    const r = await queueNotification(mail(`ok.${MARK}@example.jp`));
    expect(r.status).toBe("SENT");
    const log = readdirSync(outbox).map((f) => readFileSync(path.join(outbox, f), "utf8")).join("");
    expect(log).toContain("30分以内にパスワードを再設定してください: https://x/r");
  });

  it("retries 5xx after 1, 5, 30 min, then FAILED; 4xx FAILED at once", async () => {
    const first = await queueNotification(mail(`fail500.${MARK}@example.jp`));
    expect(first.status).toBe("QUEUED");
    let row = await prisma.notification.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt!.getTime() - row.updatedAt.getTime()).toBeGreaterThan(50_000);
    for (const expected of ["QUEUED", "QUEUED", "FAILED"]) expect((await deliver(first.id)).status).toBe(expected);
    row = await prisma.notification.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.attempts).toBe(4);
    expect((await queueNotification(mail(`fail400.${MARK}@example.jp`))).status).toBe("FAILED");
  });

  it("a refused LINE message is FAILED and goes out by MAIL instead (OD-6)", async () => {
    const account = await prisma.account.findFirstOrThrow({ where: { email: "yamada.taro@example.jp" } });
    const before = await prisma.notification.count({ where: { accountId: account.id, channel: "MAIL" } });
    const r = await queueNotification({ ...mail(`fail400-line.${MARK}`), event: "NT04_CANCELED", channel: "LINE", accountId: account.id }, DAYTIME);
    expect(r.status).toBe("FAILED");
    expect(await prisma.notification.count({ where: { accountId: account.id, channel: "MAIL" } })).toBe(before + 1);
    await prisma.notification.deleteMany({ where: { accountId: account.id, channel: "MAIL", queuedAt: { gte: new Date(Date.now() - 60_000) } } });
  });

  it("holds LINE / SMS during the quiet hours 21:00–08:00 JST; mail is not held", () => {
    expect(quietUntil("SMS", new Date("2026-10-23T13:30:00Z"))?.toISOString()).toBe("2026-10-23T23:00:00.000Z"); // 22:30 → 08:00 next day
    expect(quietUntil("LINE", new Date("2026-10-22T20:00:00Z"))?.toISOString()).toBe("2026-10-22T23:00:00.000Z"); // 05:00 → 08:00
    expect(quietUntil("SMS", DAYTIME)).toBeNull();
    expect(quietUntil("MAIL", new Date("2026-10-23T13:30:00Z"))).toBeNull();
  });

  it("the 3rd hard bounce in a row on the current address sets email_bounced_at", async () => {
    const account = await prisma.account.findFirstOrThrow({ where: { email: "yamada.taro@example.jp" } });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const n = await prisma.notification.create({
        data: { event: "NT01_BOOKED", channel: "MAIL", language: "JA", accountId: account.id, toAddress: account.email, status: "SENT", providerMessageId: `${MARK}-${i}`, queuedAt: new Date(Date.now() + i) },
      });
      ids.push(n.id);
    }
    await recordMailBounce(`${MARK}-0`, true);
    await recordMailBounce(`${MARK}-1`, false); // soft: ignored
    await recordMailBounce(`${MARK}-1`, true);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).emailBouncedAt).toBeNull();
    await recordMailBounce(`${MARK}-2`, true);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).emailBouncedAt).not.toBeNull();
    await prisma.notification.deleteMany({ where: { id: { in: ids } } });
  });

  it("templates: 04 §6 defaults per clinic, placeholders filled", () => {
    const rows = defaultTemplateRows();
    expect(rows).toHaveLength(7 * 3 + 5 * 3 * 2); // MAIL all events; LINE + SMS for the 5 booking events
    expect(rows.filter((r) => r.channel === "MAIL").every((r) => r.subject)).toBe(true);
    expect(fill("{{a}}-{{b}}", { a: "1" })).toBe("1-");
  });
});

describe("X4 postcode", () => {
  it("normalises input and cleans the special town values", async () => {
    expect(normalizePostcode("１００－０００５")).toBe("1000005");
    expect(normalizePostcode("100-00")).toBeNull();
    expect(cleanTown("丸の内（次のビルを除く）")).toBe("丸の内");
    expect((await lookupPostcode("1000000"))[0].town).toBe("");
    expect(await lookupPostcode("0790177")).toHaveLength(2);
    expect(await lookupPostcode("9999999")).toEqual([]);
  });

  it("an unavailable service is PE013 (X4UnavailableError)", async () => {
    process.env.X4_SOURCE = "https://example.invalid";
    await expect(lookupPostcode("1234567")).rejects.toBeInstanceOf(X4UnavailableError);
    delete process.env.X4_SOURCE;
  });
});

describe("X5 CSV", () => {
  it("replaces characters outside CP932 with 〓 and counts the rows", () => {
    expect(toCp932Safe("𠮷田")).toEqual({ text: "〓田", replaced: true });
    const { text, warningCount } = buildX5Csv(["a", "b"], [["山田", 'x"y'], ["𠮷田", "1"]]);
    expect(text).toBe('"a","b"\r\n"山田","x""y"\r\n"〓田","1"\r\n');
    expect(warningCount).toBe(1);
  });

  it("names files in JST and writes Windows-31J", async () => {
    expect(x5FileName("B", "honin", new Date("2026-10-22T20:30:00Z"))).toBe("B_honin_20261023_0530.csv");
    const f = await writeX5File("P", "honin", [["H-10001", "id", "山田　太郎", "ヤマダ　タロウ", "1", "19800401", "100-0005", "東京都", "090-1234-5678", "新規", "2026/10/23 05:30"]]);
    expect(f.rowCount).toBe(1);
    expect(iconv.decode(readFileSync(path.join(x5dir, f.fileName)), "cp932")).toContain('"診察券番号","システム患者ID"');
    expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("batch runner", () => {
  it("records a run of a job that is not built yet as 'not implemented'", async () => {
    // every job is built by W5: take B5 out of the registry for this case only
    const b5 = JOBS.B5;
    delete JOBS.B5;
    try {
      const { run, result } = await runJob("B5", { trigger: "MANUAL", params: { test: MARK } });
      expect(result).toMatchObject({ status: "FAILED", message: "not implemented (wave W5)" });
      expect(run).toMatchObject({ jobCode: "B5", status: "FAILED", trigger: "MANUAL" });
      expect(run!.endedAt).not.toBeNull();
    } finally {
      JOBS.B5 = b5;
    }
  });

  it("a dry run writes nothing", async () => {
    const before = await prisma.batchRun.count();
    expect((await runJob("B2", { trigger: "MANUAL", dryRun: true })).run).toBeNull();
    expect(await prisma.batchRun.count()).toBe(before);
  });

  it("a run that finds the job lock taken ends SUCCESS 「実行中のため省略」", async () => {
    const holder = await pool.connect();
    try {
      await holder.query("SELECT pg_advisory_lock(hashtext('batch:B6'))");
      const { run } = await runJob("B6", { trigger: "MANUAL", params: { test: MARK } });
      expect(run).toMatchObject({ status: "SUCCESS", message: "実行中のため省略" });
    } finally {
      await holder.query("SELECT pg_advisory_unlock(hashtext('batch:B6'))");
      holder.release();
    }
  });

  it("schedule: daily times, once a day, B1 window, nothing in the Tuesday maintenance window", () => {
    const empty = { ranToday: new Set<string>(), reminders: [], remindedToday: new Set<string>() };
    const at = (iso: string) => dueJobs(new Date(iso), empty).map((d) => d.code);
    expect(at("2026-10-22T15:20:00Z")).toEqual([]); // Fri 00:20 JST
    expect(at("2026-10-22T15:35:00Z")).toEqual(["B4"]); // 00:35
    expect(at("2026-10-22T20:35:00Z")).toEqual(["B4", "B2", "B5", "B6"]); // 05:35, not the 1st → no B3
    expect(at("2026-10-31T16:50:00Z")).toContain("B3"); // Sun 1 Nov 01:50
    expect(at("2026-10-26T17:30:00Z")).toEqual([]); // Tue 02:30 JST, maintenance window
    expect(dueJobs(new Date("2026-10-22T20:35:00Z"), { ...empty, ranToday: new Set(["B4", "B2", "B5", "B6"]) })).toEqual([]);
    const b1 = (iso: string) => dueJobs(new Date(iso), { ...empty, ranToday: new Set(["B4", "B2", "B5", "B6"]), reminders: [{ clinicId: "c1", at: "10:00" }] });
    expect(b1("2026-10-23T01:02:00Z")).toEqual([{ code: "B1", clinicId: "c1" }]); // 10:02
    expect(b1("2026-10-23T01:06:00Z")).toEqual([]); // 10:06, outside the 5 minutes
  });
});
