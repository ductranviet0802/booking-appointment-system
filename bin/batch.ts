// Batch CLI: npm run batch -- <B1…B6> [--clinic <clinics.code>] [--trigger MANUAL|EVENT|SCHEDULE] [--dry-run] [--param key=value …]
// Prints the run as JSON; exit 0 for SUCCESS / PARTIAL, 1 for FAILED, 2 for a usage error.
import "dotenv/config";
import { pool, prisma } from "@/lib/prisma";
import { isJobCode, JOB_CODES, runJob, type Trigger } from "@/lib/batch/runner";

async function main() {
  const [code, ...rest] = process.argv.slice(3); // node bin/run-ts.mjs bin/batch.ts <args>
  if (!code || !isJobCode(code)) {
    console.error(`usage: npm run batch -- <${JOB_CODES.join("|")}> [--clinic code] [--trigger MANUAL|EVENT|SCHEDULE] [--dry-run] [--param k=v]`);
    return 2;
  }
  let clinicId: string | null = null;
  let trigger: Trigger = "MANUAL";
  let dryRun = false;
  const params: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--clinic") {
      const clinic = await prisma.clinic.findUnique({ where: { code: rest[++i] ?? "" } });
      if (!clinic) return usage(`unknown clinic ${rest[i]}`);
      clinicId = clinic.id;
    } else if (arg === "--trigger") {
      const t = rest[++i];
      if (t !== "MANUAL" && t !== "EVENT" && t !== "SCHEDULE") return usage(`bad trigger ${t}`);
      trigger = t;
    } else if (arg === "--param") {
      const [k, ...v] = (rest[++i] ?? "").split("=");
      if (!k || v.length === 0) return usage(`bad param ${rest[i]}`);
      params[k] = v.join("=");
    } else return usage(`unknown argument ${arg}`);
  }
  const { run, result } = await runJob(code, { trigger, clinicId, params, dryRun });
  console.log(JSON.stringify({ job: code, dryRun, runId: run?.id ?? null, ...result }));
  return result.status === "FAILED" ? 1 : 0;
}

function usage(msg: string) {
  console.error(msg);
  return 2;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
