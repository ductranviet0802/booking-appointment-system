// J-08 (N-OPS-06): a FAILED or PARTIAL run mails the operator and the admins of the clinic concerned; SUCCESS and a run skipped
// by the advisory lock send nothing. Fake transport: one JSON line per mail in NOTIFY_OUTBOX_DIR.
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { OPERATOR_ALERT_KEY, runJob } from "@/lib/batch/runner";
import { todayJst } from "@/lib/datetime";
import { pool, prisma } from "@/lib/prisma";
import { cleanupStaff, makeStaff } from "./a03-helpers";
import { fixture, type Fixture } from "./b2-helpers";

const outbox = mkdtempSync(path.join(tmpdir(), "alert-outbox-"));
process.env.NOTIFY_OUTBOX_DIR = outbox;
jest.setTimeout(60_000);

let f: Fixture;
let admin: Awaited<ReturnType<typeof makeStaff>>;
const OPERATOR = "ops.w4test@example.jp";
const mails = () =>
  readdirSync(outbox).flatMap((n) => readFileSync(path.join(outbox, n), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { to: string; subject: string; body: string; event: string }))
    .filter((m) => m.event === "BATCH_ALERT");

beforeAll(async () => {
  f = await fixture({ doctors: 1 });
  admin = await makeStaff("ADMIN", { clinics: [f.tag] });
  await prisma.systemSetting.create({ data: { key: OPERATOR_ALERT_KEY, value: OPERATOR } });
});
afterAll(async () => {
  await prisma.systemSetting.deleteMany({ where: { key: OPERATOR_ALERT_KEY } });
  await f.cleanup();
  await cleanupStaff();
  await prisma.$disconnect();
  await pool.end();
});

it("FAILED run → alert to the operator and the clinic's admin, with job, status, counts and message", async () => {
  const r = await runJob("B4", { trigger: "MANUAL", clinicId: f.clinic.id, params: { date: todayJst() } });
  expect(r.run!.status).toBe("FAILED");
  const sent = mails().filter((m) => m.body.includes(r.run!.id));
  expect(sent.map((m) => m.to).sort()).toEqual(expect.arrayContaining([OPERATOR, admin.account.email]));
  expect(sent[0].subject).toBe(`【バッチ失敗】B4 ${f.clinic.nameJa}`);
  expect(sent[0].body).toContain("状態: FAILED");
  expect(sent[0].body).toContain("bad parameter date");
});

it("SUCCESS and a run skipped by the lock send nothing", async () => {
  const before = mails().length;
  const ok = await runJob("B4", { trigger: "MANUAL", clinicId: f.clinic.id });
  expect(ok.run!.status).toBe("SUCCESS");
  const holder = await pool.connect();
  try {
    await holder.query("SELECT pg_advisory_lock(hashtext('batch:B4'))");
    const skipped = await runJob("B4", { trigger: "MANUAL", clinicId: f.clinic.id });
    expect(skipped.result.message).toBe("実行中のため省略");
  } finally {
    await holder.query("SELECT pg_advisory_unlock(hashtext('batch:B4'))");
    holder.release();
  }
  expect(mails().length).toBe(before);
});
