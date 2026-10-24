// spec-screen: A06
// A06 CSV出力 server side: 更新1 (stale DISCLOSURE builds → FAILED, at open), 抽出1–4 (state), 更新2 (B6 on demand), 抽出5 +
// 更新3 / 4 (download: checks, sha256 check, download_count + CSV_DOWNLOAD audit in one transaction).
import { createHash } from "node:crypto";
import type { Role } from "@prisma/client";
import { bad, done, fieldFail, isUuid, type Actor } from "@/lib/admin/common";
import { checkPeriod, isKind, parseSlashDate } from "@/lib/admin/export-rules";
import { audit, type Result } from "@/lib/auth/service";
import { deltaStart, EXPORT_DAYS, LOCKED_MESSAGE } from "@/lib/batch/b6-export";
import { runJob } from "@/lib/batch/runner";
import { addDays, todayJst, toIsoDate } from "@/lib/datetime";
import { readExportFile } from "@/lib/export/store";
import { prisma } from "@/lib/prisma";

/** 6-1 … 6-11 of one row, display strings ready */
export type ExportRow = {
  id: string; fileName: string; kind: "PATIENTS" | "BOOKINGS" | "DISCLOSURE"; tag: "BATCH" | "MANUAL" | "DISCLOSURE"; status: "BUILDING" | "DONE" | "FAILED";
  period: string; count: string; warnings: number; creator: string; downloads: number; expires: string; se083: string | null;
};
export type ExportState = {
  last: { text: string; failedAt: string | null }; // item 1 text; failedAt = SE082 {日時} (state ①)
  since: string; // item 4
  defaults: { from: string; to: string };
  rows: ExportRow[];
};

const jst = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString();
/** 「10/20 05:30」 */
const short = (d: Date) => `${jst(d).slice(5, 7)}/${jst(d).slice(8, 10)} ${jst(d).slice(11, 16)}`;
/** 「2026/10/20 05:30」 */
const long = (d: Date) => `${jst(d).slice(0, 10).replaceAll("-", "/")} ${jst(d).slice(11, 16)}`;
const slashDay = (isoDate: string) => isoDate.replaceAll("-", "/");
const md = (d: Date) => `${toIsoDate(d).slice(5, 7)}/${toIsoDate(d).slice(8, 10)}`;
const WORD = { SUCCESS: "正常終了", PARTIAL: "一部失敗", FAILED: "失敗", RUNNING: "実行中" } as const;

// cap: A06 list length (質疑 pending) — newest 200 rows; the list holds 30 days of one clinic (2 files a night + manual + disclosure)
export const LIST_MAX = 200;

/** the page's data (event 1): 更新1 first, so that a stale BUILDING row already reads FAILED */
export async function loadExportState(clinicId: string, role: Role, now = new Date()): Promise<ExportState> {
  await prisma.exportFile.updateMany({
    where: { clinicId, kind: "DISCLOSURE", status: "BUILDING", createdAt: { lte: new Date(now.getTime() - 3_600_000) } },
    data: { status: "FAILED", expiresAt: new Date(now.getTime() + EXPORT_DAYS * 86_400_000) },
  });

  // 抽出1: the last nightly B6 run of the clinic (or of all clinics)
  const run = await prisma.batchRun.findFirst({
    where: { jobCode: "B6", trigger: "SCHEDULE", OR: [{ clinicId }, { clinicId: null }] }, orderBy: { startedAt: "desc" },
  });
  let last: ExportState["last"] = { text: "夜間出力の実績はありません", failedAt: null };
  if (run) {
    const hasFile = run.status === "PARTIAL" ? (await prisma.exportFile.count({ where: { runId: run.id, clinicId } })) > 0 : true;
    if (run.status === "FAILED" || (run.status === "PARTIAL" && !hasFile)) last = { text: "", failedAt: short(run.startedAt) };
    else {
      const word = run.status === "RUNNING" ? WORD.RUNNING : WORD.SUCCESS; // PARTIAL with a file of the clinic = 正常終了
      const msg = run.message?.split("／")[0]; // (failures of other clinics stay out of this clinic's screen)
      last = { text: `${short(run.startedAt)} ${word}${msg ? `（${msg}）` : ""}`, failedAt: null };
    }
  }

  // 抽出2
  const from = await deltaStart(clinicId);
  const since = from ? `${long(from)} 以降の変更分（前回の正常出力から・変更不可）` : "全件（初回出力）";

  // 抽出3
  const files = await prisma.exportFile.findMany({
    where: { clinicId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], ...(role !== "ADMIN" && { kind: { not: "DISCLOSURE" } }) },
    orderBy: [{ createdAt: "desc" }, { fileName: "desc" }], take: LIST_MAX, include: { creator: { select: { displayName: true } } },
  });
  // 抽出4 (admin only): FAILED DISCLOSURE rows with no later BUILDING / DONE row of the same patient (any clinic)
  const failed = files.filter((f) => f.kind === "DISCLOSURE" && f.status === "FAILED" && f.patientId);
  const later = failed.length
    ? await prisma.exportFile.findMany({
        where: { kind: "DISCLOSURE", status: { in: ["BUILDING", "DONE"] }, patientId: { in: failed.map((f) => f.patientId!) } },
        select: { patientId: true, createdAt: true },
      })
    : [];
  const se083 = (f: (typeof files)[number]) =>
    role === "ADMIN" && f.kind === "DISCLOSURE" && f.status === "FAILED" && !later.some((l) => l.patientId === f.patientId && l.createdAt > f.createdAt)
      ? short(new Date((f.expiresAt ?? f.createdAt).getTime() - EXPORT_DAYS * 86_400_000))
      : null;

  const today = todayJst(now);
  return {
    last, since, defaults: { from: slashDay(today), to: slashDay(addDays(today, 6)) },
    rows: files.map((f) => ({
      id: f.id, fileName: f.fileName, kind: f.kind as ExportRow["kind"], status: f.status as ExportRow["status"],
      tag: f.kind === "DISCLOSURE" ? "DISCLOSURE" : f.trigger === "BATCH" ? "BATCH" : "MANUAL",
      period: f.kind === "BOOKINGS" && f.periodFrom && f.periodTo ? `${md(f.periodFrom)}〜${md(f.periodTo)}` : f.kind === "PATIENTS" ? "差分" : f.kind === "DISCLOSURE" ? "全期間・法人全院" : "",
      count: f.kind === "DISCLOSURE" || f.status !== "DONE" || f.rowCount === null ? "—" : String(f.rowCount),
      warnings: f.warningCount ?? 0, creator: f.creator?.displayName ?? "システム", downloads: f.downloadCount,
      expires: f.expiresAt ? md(new Date(f.expiresAt.getTime() + 9 * 3_600_000)) : "—",
      se083: se083(f),
    })),
  };
}

// ── event 3: 出力する ──────────────────────────────────────────────────────────────────────────────────────────────────

/** body { kind, from, to } (slash dates). Answers 200 with `outcome` for SI080 / SI081 / SE084 / SE090, 400 with field errors */
export async function startExport(a: Actor, b: Record<string, unknown>): Promise<Result> {
  if (!isKind(b.kind)) return bad(); // 2: the UI cannot produce it
  const from = typeof b.from === "string" ? b.from : "";
  const to = typeof b.to === "string" ? b.to : "";
  const errors = checkPeriod(b.kind, from, to);
  if (errors.length) return fieldFail(errors);
  const { run, result } = await runJob("B6", {
    trigger: "MANUAL", clinicId: a.clinicId,
    params: { kind: b.kind, createdBy: a.accountId, ...(b.kind !== "PATIENTS" && { periodFrom: parseSlashDate(from.trim()), periodTo: parseSlashDate(to.trim()) }) },
  });
  if (result.message === LOCKED_MESSAGE) return done({ outcome: { code: "SE084" } });
  if (!run || result.status !== "SUCCESS") return done({ outcome: { code: "SE090" } });
  const rows = await prisma.exportFile.findMany({ where: { runId: run.id, clinicId: a.clinicId }, select: { kind: true, rowCount: true } });
  const n = (k: string) => rows.find((r) => r.kind === k)?.rowCount ?? 0;
  if (rows.every((r) => !r.rowCount)) return done({ outcome: { code: "SI081" } }); // Q10: only when every file of the run is empty
  const count = b.kind === "BOTH" ? `患者 ${n("PATIENTS")}件・予約 ${n("BOOKINGS")}件` : `${b.kind === "PATIENTS" ? n("PATIENTS") : n("BOOKINGS")}件`;
  return done({ outcome: { code: "SI080", params: { 件数: count } } });
}

// ── event 4: ダウンロード ─────────────────────────────────────────────────────────────────────────────────────────────

export type Download = { ok: true; bytes: Buffer; fileName: string } | { ok: false; status: number; code: string };
const no = (status: number, code: string): Download => ({ ok: false, status, code });

/** 4-1 … 4-4: nothing is streamed, counted or audited on a refusal */
export async function downloadExport(a: Actor, id: unknown): Promise<Download> {
  if (!isUuid(id)) return no(404, "SE090");
  const f = await prisma.exportFile.findUnique({ where: { id } });
  if (!f) return no(404, "SE090"); // ER-02
  if (f.clinicId !== a.clinicId) return no(403, "SE091"); // ER-03
  if (f.kind === "DISCLOSURE" && a.role !== "ADMIN") return no(403, "SE091"); // N-PI-07
  if (f.expiresAt && f.expiresAt <= a.now) return no(404, "SE090");
  if (f.status !== "DONE" || !f.storageKey) return no(409, "SE090"); // 4-3
  let bytes: Buffer;
  try {
    bytes = await readExportFile(f.storageKey);
  } catch {
    return no(500, "SE090");
  }
  if (createHash("sha256").update(bytes).digest("hex") !== f.sha256) return no(500, "SE090"); // Q11 b
  await prisma.$transaction(async (tx) => {
    await tx.exportFile.update({ where: { id }, data: { downloadCount: { increment: 1 } } });
    await audit(tx, {
      accountId: a.accountId, role: a.role, action: "CSV_DOWNLOAD", ip: a.ip, now: a.now, targetType: "export_files", targetId: id, clinicId: a.clinicId,
      detail: { kind: f.kind, ...(f.kind === "DISCLOSURE" && { patientId: f.patientId }) },
    });
  });
  return { ok: true, bytes, fileName: f.fileName };
}
