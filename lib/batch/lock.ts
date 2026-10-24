// Job locks of the batch runner (06 §0): a database advisory lock per job code; B1 per clinic. Its own module so a job
// (b1-remind) can take a clinic lock without importing the runner (runner → jobs → b1-remind would be a cycle).
import { pool } from "@/lib/prisma";

export const SKIPPED = "実行中のため省略";

/** B1 runs per clinic at each clinic's A04 time: its lock is per clinic (two clinics at once, never one clinic twice).
 *  An all-clinic B1 run holds `batch:B1` and takes each clinic's lock while it works on that clinic (b1-remind). */
export const lockKeyOf = (code: string, clinicId: string | null) => (code === "B1" && clinicId ? `batch:B1:${clinicId}` : `batch:${code}`);

/** `fn` under the database advisory lock `key` (session lock on a connection of its own); null when it is held elsewhere */
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [key]);
    if (!rows[0].locked) return null;
    try {
      return await fn();
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]);
    }
  } finally {
    client.release();
  }
}
