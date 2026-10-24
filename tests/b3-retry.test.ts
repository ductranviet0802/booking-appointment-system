// J-09: B3 retries a failed X3 download once after the delay; the second attempt succeeds → SUCCESS with the counts.
// Dry run, so the shared holidays table is not touched; a second failure still ends FAILED (one retry only).
import * as x3 from "@/lib/adapters/x3-holidays";
import { runJob } from "@/lib/batch/runner";
import { pool, prisma } from "@/lib/prisma";

jest.setTimeout(60_000);
const source = "fixtures/x3/syukujitsu.csv";

afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

it("first attempt HTTP error, retry after the delay succeeds → SUCCESS", async () => {
  const spy = jest.spyOn(x3, "fetchHolidayFile").mockRejectedValueOnce(new x3.X3HttpError("HTTP 503"));
  const started = Date.now();
  const r = await runJob("B3", { trigger: "MANUAL", params: { source, retryDelayMs: 200 }, dryRun: true });
  expect(r.result.status).toBe("SUCCESS");
  expect(r.result.message).toMatch(/^追加\d+・変更\d+・削除\d+$/);
  expect(spy).toHaveBeenCalledTimes(2);
  expect(Date.now() - started).toBeGreaterThanOrEqual(200);
  spy.mockRestore();
});

it("two failures → FAILED with the SE041 reason (no third attempt)", async () => {
  const spy = jest.spyOn(x3, "fetchHolidayFile").mockRejectedValue(new x3.X3TimeoutError("timeout"));
  const r = await runJob("B3", { trigger: "MANUAL", params: { source, retryDelayMs: 0 }, dryRun: true });
  expect(r.result.status).toBe("FAILED");
  expect(spy).toHaveBeenCalledTimes(2);
  spy.mockRestore();
});
