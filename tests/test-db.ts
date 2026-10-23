// Tests run against their own database `<service db>_test`, reset and seeded once per `npm test`
// (globalSetup), so a run never sees the rows of an earlier one and never touches the app's data.
import { execFileSync } from "node:child_process";
import path from "node:path";

export function testDbUrl(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  const u = new URL(url);
  if (!u.pathname.endsWith("_test")) u.pathname += "_test";
  return u.toString();
}

export function pointAtTestDb() {
  const url = testDbUrl();
  process.env.DATABASE_URL = url;
  process.env.POSTGRES_URL_NON_POOLING = url;
}

export function resetTestDb() {
  pointAtTestDb();
  const opts = { cwd: path.join(__dirname, ".."), stdio: "inherit" as const, env: process.env };
  execFileSync("npx", ["prisma", "migrate", "reset", "--force"], opts);
  execFileSync(process.execPath, ["prisma/seed.js"], opts);
}
