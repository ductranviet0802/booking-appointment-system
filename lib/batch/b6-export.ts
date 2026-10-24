// B6 レセコンCSV夜間出力 (06 §B6, 05 X5, F16-01): per clinic an X5-P patients delta file and an X5-B bookings file, CP932,
// stored encrypted (lib/export/store), one export_files row each (DONE, +30 days). A clinic is all-or-nothing: both files are built
// in memory first, stored, and their rows inserted in one transaction; any failure removes the stored files (no partial file).
// params: kind PATIENTS|BOOKINGS|BOTH (default BOTH), periodFrom / periodTo (ISO, BOOKINGS; default today … today + 6, ≤ 31 days
// inclusive → SE080), createdBy (account id of an A06 run). Trigger SCHEDULE → export_files.trigger BATCH, else MANUAL.
// Dry run: counts only. The job lock is the runner's (06 §0): a run that finds it taken writes nothing.
import iconv from "iconv-lite";
import { buildX5Csv, X5B_HEADER, X5P_HEADER, x5FileName } from "@/lib/adapters/x5-csv";
import { addDays, dbDate, todayJst, toIsoDate } from "@/lib/datetime";
import { deleteExportFile, storeExportFile } from "@/lib/export/store";
import { prisma } from "@/lib/prisma";
import { MAX_PERIOD_DAYS, periodDays } from "@/lib/batch/b6-dates";
import { bookingRows, patientRows } from "@/lib/batch/b6-rows";
import type { Job, JobResult } from "@/lib/batch/runner";

export const EXPORT_DAYS = 30;
/** the message the runner gives a run that found the job lock taken (lib/batch/runner.ts); A06 shows SE084 for it */
export const LOCKED_MESSAGE = "実行中のため省略";
/** the first PATIENTS file has no delta start; 03 §3.28 makes `changed_since` not null, so it holds the epoch ("all") */
export const FIRST_SINCE = new Date(0);

export type ExportKind = "PATIENTS" | "BOOKINGS" | "BOTH";
const iso = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: unknown): s is string => typeof s === "string" && iso.test(s) && !Number.isNaN(dbDate(s).getTime()) && toIsoDate(dbDate(s)) === s;

/** start of the next patient delta: the run of the clinic's latest DONE PATIENTS file (nightly or manual); null = first run */
export async function deltaStart(clinicId: string): Promise<Date | null> {
  const f = await prisma.exportFile.findFirst({
    where: { clinicId, kind: "PATIENTS", status: "DONE" }, orderBy: { createdAt: "desc" }, include: { run: { select: { startedAt: true } } },
  });
  return f ? (f.run?.startedAt ?? f.createdAt) : null;
}

type ClinicResult = { patients: number | null; bookings: number | null; warnings: number };

async function exportClinic(
  clinic: { id: string; code: string }, o: { kind: ExportKind; from: string; to: string; dryRun: boolean; runId: string | null; trigger: string; createdBy: string | null; now: Date },
): Promise<ClinicResult> {
  const out: ClinicResult = { patients: null, bookings: null, warnings: 0 };
  const files: { kind: "PATIENTS" | "BOOKINGS"; fileName: string; bytes: Buffer; rows: number; warnings: number; changedSince?: Date }[] = [];
  if (o.kind !== "BOOKINGS") {
    const since = await deltaStart(clinic.id);
    const rows = await patientRows(clinic.id, since);
    const csv = buildX5Csv(X5P_HEADER, rows);
    files.push({ kind: "PATIENTS", fileName: x5FileName("P", clinic.code, o.now), bytes: iconv.encode(csv.text, "cp932"), rows: rows.length, warnings: csv.warningCount, changedSince: since ?? FIRST_SINCE });
  }
  if (o.kind !== "PATIENTS") {
    const last = await prisma.exportFile.findFirst({ where: { clinicId: clinic.id, kind: "BOOKINGS", status: "DONE" }, orderBy: { createdAt: "desc" } });
    const rows = await bookingRows(clinic.id, o.from, o.to, last?.createdAt ?? null);
    const csv = buildX5Csv(X5B_HEADER, rows);
    files.push({ kind: "BOOKINGS", fileName: x5FileName("B", clinic.code, o.now), bytes: iconv.encode(csv.text, "cp932"), rows: rows.length, warnings: csv.warningCount });
  }
  for (const f of files) {
    out[f.kind === "PATIENTS" ? "patients" : "bookings"] = f.rows;
    out.warnings += f.warnings;
  }
  if (o.dryRun) return out;

  const stored: string[] = [];
  try {
    const data = [];
    for (const f of files) {
      const s = await storeExportFile(f.fileName, f.bytes);
      stored.push(s.storageKey);
      data.push({
        clinicId: clinic.id, kind: f.kind, trigger: o.trigger === "SCHEDULE" ? "BATCH" : "MANUAL", status: "DONE", fileName: f.fileName,
        storageKey: s.storageKey, sha256: s.sha256, rowCount: f.rows, warningCount: f.warnings, runId: o.runId, createdBy: o.createdBy,
        expiresAt: new Date(o.now.getTime() + EXPORT_DAYS * 86_400_000),
        ...(f.kind === "PATIENTS" ? { changedSince: f.changedSince } : { periodFrom: dbDate(o.from), periodTo: dbDate(o.to) }),
      });
    }
    await prisma.exportFile.createMany({ data });
  } catch (e) {
    await Promise.all(stored.map((k) => deleteExportFile(k).catch(() => undefined)));
    throw e;
  }
  return out;
}

export const b6Job: Job = async (ctx) => {
  const now = new Date();
  const today = todayJst(now);
  const kind = ctx.params.kind ?? "BOTH";
  if (kind !== "PATIENTS" && kind !== "BOOKINGS" && kind !== "BOTH") throw new Error(`bad parameter kind: ${String(kind)}`);
  const from = ctx.params.periodFrom ?? today;
  const to = ctx.params.periodTo ?? addDays(today, 6);
  if (!validDate(from) || !validDate(to) || to < from) throw new Error(`bad period: ${String(from)} … ${String(to)}`);
  if (periodDays(from, to) > MAX_PERIOD_DAYS) throw new Error(`SE080: period over ${MAX_PERIOD_DAYS} days`);
  const createdBy = typeof ctx.params.createdBy === "string" ? ctx.params.createdBy : null;

  const clinics = await prisma.clinic.findMany({ where: ctx.clinicId ? { id: ctx.clinicId } : {}, orderBy: { displayOrder: "asc" }, select: { id: true, code: true } });
  let patients = 0;
  let bookings = 0;
  let warnings = 0;
  let written = 0;
  let ok = 0;
  const failed: string[] = [];
  for (const c of clinics) {
    try {
      const r = await exportClinic(c, { kind, from, to, dryRun: ctx.dryRun, runId: ctx.runId, trigger: ctx.trigger, createdBy, now });
      patients += r.patients ?? 0;
      bookings += r.bookings ?? 0;
      warnings += r.warnings;
      written += ctx.dryRun ? 0 : (r.patients === null ? 0 : 1) + (r.bookings === null ? 0 : 1);
      ok++;
    } catch (e) {
      failed.push(`${c.code}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const parts = [kind !== "BOOKINGS" && `患者 ${patients}件`, kind !== "PATIENTS" && `予約 ${bookings}件`, `外字あり ${warnings}件`].filter(Boolean).join("・");
  const message = `${ctx.dryRun ? "（試行）" : ""}${parts}${failed.length ? `／失敗 ${failed.join("; ")}` : ""}`.slice(0, 500);
  const status: JobResult["status"] = failed.length === 0 ? "SUCCESS" : ok > 0 ? "PARTIAL" : "FAILED";
  return { status, read: patients + bookings, written, errors: failed.length, message };
};
