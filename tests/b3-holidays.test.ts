// B3 祝日取込 (06 §B3): the fixture file plus lines of the test's own against prepared rows: insert / rename / deactivate, a failing file
// (FAILED, holidays unchanged), the B2 (EVENT) start for the changed dates, and a rerun that changes nothing. The changed dates are Sundays
// inside the booking window on which no clinic has frames, so the B2 run that follows touches no seeded frame.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { diffHolidays } from "@/lib/batch/b3-holidays";
import { runJob } from "@/lib/batch/runner";
import { addDays, dbDate, todayJst, toIsoDate, weekdayOf } from "@/lib/datetime";
import { pool, prisma } from "@/lib/prisma";

jest.setTimeout(120_000);

const dir = mkdtempSync(path.join(tmpdir(), "b3-"));
const fixtureBytes = readFileSync("fixtures/x3/syukujitsu.csv");
const withLines = (name: string, lines: string[]) => {
  const file = path.join(dir, name);
  writeFileSync(file, Buffer.concat([fixtureBytes, Buffer.from(`\r\n${lines.join("\r\n")}\r\n`)])); // ASCII names need no Shift_JIS encoder
  return file;
};
const slash = (d: string) => d.replace(/-/g, "/");
const snapshot = async () => (await prisma.holiday.findMany({ orderBy: { holidayDate: "asc" } })).map((h) => [toIsoDate(h.holidayDate), h.nameJa, h.isActive]);
const b3 = (source: string) => runJob("B3", { trigger: "MANUAL", params: { source, retryDelayMs: 0 } });

let tag: string;
let added: string;
let renamed: string;
let removed: string;
let runId: string;

beforeAll(async () => {
  const today = todayJst();
  const inFile = new Set((await prisma.holiday.findMany()).map((h) => toIsoDate(h.holidayDate)));
  const sundays: string[] = [];
  for (let n = 1; n < 30 && sundays.length < 3; n++) {
    const d = addDays(today, n);
    if (weekdayOf(d) === 0 && !inFile.has(d) && (await prisma.slot.count({ where: { slotDate: dbDate(d) } })) === 0) sundays.push(d);
  }
  expect(sundays).toHaveLength(3);
  [added, renamed, removed] = sundays;
  tag = `b3t${Date.now().toString(36)}`;
  runId = (await prisma.batchRun.create({
    data: { jobCode: "B6", trigger: "MANUAL", startedAt: new Date(), endedAt: new Date(), status: "SUCCESS", readCount: 0, writtenCount: 0, errorCount: 0, message: tag },
  })).id;
  await prisma.holiday.createMany({
    data: [{ holidayDate: dbDate(renamed), nameJa: "旧名称", lastRunId: runId }, { holidayDate: dbDate(removed), nameJa: "消える日", lastRunId: runId }],
  });
});

afterAll(async () => {
  await prisma.holiday.deleteMany({ where: { holidayDate: { in: [added, renamed, removed].map(dbDate) } } });
  await prisma.batchRun.deleteMany({ where: { message: tag } });
  await prisma.$disconnect();
  await pool.end();
});

describe("B3 diff (step 2)", () => {
  it("added / changed (name differs or a returning date) / removed (active, not in the file)", () => {
    const stored = [
      { date: "2030-01-01", nameJa: "元日", isActive: true },
      { date: "2030-02-11", nameJa: "古い", isActive: true },
      { date: "2030-03-20", nameJa: "春分の日", isActive: false },
      { date: "2030-05-03", nameJa: "憲法記念日", isActive: true },
      { date: "2030-06-01", nameJa: "もう無い", isActive: false },
    ];
    const file = [
      { date: "2030-01-01", nameJa: "元日", nameEn: null, nameVi: null },
      { date: "2030-02-11", nameJa: "建国記念の日", nameEn: null, nameVi: null },
      { date: "2030-03-20", nameJa: "春分の日", nameEn: null, nameVi: null },
      { date: "2030-07-15", nameJa: "海の日", nameEn: null, nameVi: null },
    ];
    const d = diffHolidays(stored, file);
    expect(d.added.map((r) => r.date)).toEqual(["2030-07-15"]);
    expect(d.changed.map((r) => r.date)).toEqual(["2030-02-11", "2030-03-20"]);
    expect(d.removed.map((s) => s.date)).toEqual(["2030-05-03"]); // an inactive row is not removed again
  });
});

describe("B3 job", () => {
  it("a file that fails validation or download: FAILED with the SE041 reason, holidays unchanged, no B2", async () => {
    const before = await snapshot();
    const since = new Date();
    const bad = path.join(dir, "bad.csv");
    writeFileSync(bad, Buffer.concat([fixtureBytes.subarray(0, fixtureBytes.indexOf(0x0d)), Buffer.from("\r\n2999/99/99,broken\r\n")]));
    const r = await b3(bad);
    expect([r.result.status, r.result.message, r.run?.status]).toEqual(["FAILED", "ファイルの内容が正しくありません", "FAILED"]);
    const missing = await b3(path.join(dir, "missing.csv"));
    expect([missing.result.status, missing.result.message]).toEqual(["FAILED", "ダウンロードに失敗しました"]);
    expect(await snapshot()).toEqual(before);
    expect(await prisma.batchRun.count({ where: { jobCode: "B2", trigger: "EVENT", startedAt: { gte: since } } })).toBe(0);
  });

  it("insert / rename / deactivate against the prepared rows, then B2 (EVENT, all clinics) for the changed dates; a rerun changes nothing", async () => {
    const source = withLines("ok.csv", [`${slash(added)},TestAdded`, `${slash(renamed)},TestRenamed`]);
    const since = new Date();
    const r = await b3(source);
    expect([r.result.status, r.result.message, r.run?.status]).toEqual(["SUCCESS", "追加1・変更1・削除1", "SUCCESS"]);
    const rows = Object.fromEntries((await prisma.holiday.findMany({ where: { holidayDate: { in: [added, renamed, removed].map(dbDate) } } })).map((h) => [toIsoDate(h.holidayDate), h]));
    expect(rows[added]).toMatchObject({ nameJa: "TestAdded", isActive: true, lastRunId: r.run?.id });
    expect(rows[renamed]).toMatchObject({ nameJa: "TestRenamed", isActive: true, lastRunId: r.run?.id });
    expect(rows[removed]).toMatchObject({ nameJa: "消える日", isActive: false, lastRunId: r.run?.id }); // deactivated, never deleted

    const b2 = await prisma.batchRun.findMany({ where: { jobCode: "B2", trigger: "EVENT", clinicId: null, startedAt: { gte: since } } });
    expect(b2).toHaveLength(1);
    expect((b2[0].params as { dates: string[] }).dates.sort()).toEqual([added, renamed, removed].sort());
    expect(b2[0].status).toBe("SUCCESS");

    const after = await snapshot();
    const again = await b3(source);
    expect([again.result.status, again.result.message, again.result.written]).toEqual(["SUCCESS", "追加0・変更0・削除0", 0]);
    expect(await snapshot()).toEqual(after);
    expect(await prisma.batchRun.count({ where: { jobCode: "B2", trigger: "EVENT", startedAt: { gt: b2[0].startedAt } } })).toBe(0);
  });

  it("--dry-run reports the counts and writes nothing", async () => {
    const source = withLines("dry.csv", [`${slash(addDays(added, 1100))},TestDry`]);
    const before = await snapshot();
    const r = await runJob("B3", { trigger: "MANUAL", params: { source, retryDelayMs: 0 }, dryRun: true });
    // the file lacks the two lines of the test above, so those two active rows count as removed
    expect([r.run, r.result.status, r.result.message]).toEqual([null, "SUCCESS", "追加1・変更0・削除2"]);
    expect(await snapshot()).toEqual(before);
  });
});
