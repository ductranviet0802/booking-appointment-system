// Batch runner (06 §0): one batch_runs row per run; a database advisory lock per job code, so two runs of one job
// never overlap — a run that finds the lock taken ends SUCCESS 「実行中のため省略」 and writes nothing else.
// A dry run (B2 --dry-run) writes nothing at all and returns the counts.
import type { BatchRun, BatchStatus, Prisma } from "@prisma/client";
import { pool, prisma } from "@/lib/prisma";
import { JOBS } from "@/lib/batch/jobs";

export const JOB_CODES = ["B1", "B2", "B3", "B4", "B5", "B6"] as const;
export type JobCode = (typeof JOB_CODES)[number];
export type Trigger = "SCHEDULE" | "MANUAL" | "EVENT";

export type JobContext = {
  runId: string | null; // null in a dry run
  clinicId: string | null; // null = all clinics
  params: Record<string, unknown>;
  dryRun: boolean;
  trigger: Trigger;
};
export type JobResult = { status: Exclude<BatchStatus, "RUNNING">; read: number; written: number; errors: number; message?: string };
export type Job = (ctx: JobContext) => Promise<JobResult>;

/** the wave that builds each job (STATE.md build order) */
export const JOB_WAVE: Record<JobCode, string> = { B1: "W4", B2: "W2", B3: "W2", B4: "W4", B5: "W5", B6: "W5" };

export const isJobCode = (s: string): s is JobCode => (JOB_CODES as readonly string[]).includes(s);

export async function runJob(
  code: JobCode,
  opts: { trigger: Trigger; clinicId?: string | null; params?: Record<string, unknown>; dryRun?: boolean },
): Promise<{ run: BatchRun | null; result: JobResult }> {
  const params = opts.params ?? {};
  const clinicId = opts.clinicId ?? null;
  const job = JOBS[code];
  const execute = async (runId: string | null): Promise<JobResult> => {
    if (!job) return { status: "FAILED", read: 0, written: 0, errors: 0, message: `not implemented (wave ${JOB_WAVE[code]})` };
    try {
      return await job({ runId, clinicId, params, dryRun: !!opts.dryRun, trigger: opts.trigger });
    } catch (e) {
      return { status: "FAILED", read: 0, written: 0, errors: 1, message: String(e instanceof Error ? e.message : e).slice(0, 500) };
    }
  };
  if (opts.dryRun) return { run: null, result: await execute(null) };

  const base = {
    jobCode: code, trigger: opts.trigger, clinicId, params: params as Prisma.InputJsonValue, startedAt: new Date(),
    readCount: 0, writtenCount: 0, errorCount: 0,
  };
  const lockKey = `batch:${code}`;
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [lockKey]);
    if (!rows[0].locked) {
      const result: JobResult = { status: "SUCCESS", read: 0, written: 0, errors: 0, message: "実行中のため省略" };
      const run = await prisma.batchRun.create({ data: { ...base, status: "SUCCESS", endedAt: new Date(), message: result.message } });
      return { run, result };
    }
    try {
      const started = await prisma.batchRun.create({ data: { ...base, status: "RUNNING" } });
      const result = await execute(started.id);
      const run = await prisma.batchRun.update({
        where: { id: started.id },
        data: {
          status: result.status, endedAt: new Date(), readCount: result.read, writtenCount: result.written,
          errorCount: result.errors, message: result.message ?? null,
        },
      });
      return { run, result };
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]);
    }
  } finally {
    client.release();
  }
}
