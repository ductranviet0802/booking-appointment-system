// Job registry: each wave adds its job here (B2 / B3 in W2, B1 / B4 in W4, B5 / B6 in W5).
// A code without an entry runs as FAILED 「not implemented」 (lib/batch/runner.ts).
import type { Job, JobCode } from "@/lib/batch/runner";

export const JOBS: Partial<Record<JobCode, Job>> = {};
