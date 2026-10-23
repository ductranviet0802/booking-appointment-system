// X5 レセコンCSV (05 X5, OD-14): Windows-31J, CRLF, every field quoted, Japanese header row; characters outside
// CP932 → 〓 and the row counts as a warning. Files go to X5_DIR (default var/x5); B6 / A06 fill the rows (waves W4 / W5).
// shortcut: files are written unencrypted to a local folder; use encrypted object storage (03 §3.28) before go-live.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import iconv from "iconv-lite";

export const X5P_HEADER = ["診察券番号", "システム患者ID", "氏名", "氏名カナ", "性別", "生年月日", "郵便番号", "住所", "電話番号", "区分", "更新日時"];
export const X5B_HEADER = [
  "予約番号", "予約日", "開始時刻", "終了時刻", "診療科コード", "診療区分コード", "診療区分名称", "区分", "医師コード", "医師名",
  "診察券番号", "システム患者ID", "氏名カナ", "状態", "経路", "問診有無",
];

const GETA = "〓";

/** each character outside CP932 → 〓; returns the text and whether anything was replaced */
export function toCp932Safe(text: string): { text: string; replaced: boolean } {
  let replaced = false;
  const out = Array.from(text, (ch) => {
    if (iconv.decode(iconv.encode(ch, "cp932"), "cp932") === ch) return ch;
    replaced = true;
    return GETA;
  }).join("");
  return { text: out, replaced };
}

const quote = (field: string) => `"${field.replace(/"/g, '""')}"`;

/** CSV text (header + rows, CRLF) and the number of rows with a replaced character */
export function buildX5Csv(header: string[], rows: string[][]) {
  let warningCount = 0;
  const lines = [header.map(quote).join(",")];
  for (const row of rows) {
    const safe = row.map(toCp932Safe);
    if (safe.some((f) => f.replaced)) warningCount++;
    lines.push(safe.map((f) => quote(f.text)).join(","));
  }
  return { text: `${lines.join("\r\n")}\r\n`, warningCount };
}

/** `P_{clinicCode}_{yyyyMMdd}_{HHmm}.csv` / `B_…`, JST */
export function x5FileName(kind: "P" | "B", clinicCode: string, at: Date) {
  const jst = new Date(at.getTime() + 9 * 60 * 60 * 1000).toISOString();
  return `${kind}_${clinicCode}_${jst.slice(0, 10).replace(/-/g, "")}_${jst.slice(11, 16).replace(":", "")}.csv`;
}

/** writes one file; the values for export_files (03 §3.28) */
export async function writeX5File(kind: "P" | "B", clinicCode: string, rows: string[][], at = new Date()) {
  const { text, warningCount } = buildX5Csv(kind === "P" ? X5P_HEADER : X5B_HEADER, rows);
  const bytes = iconv.encode(text, "cp932");
  const fileName = x5FileName(kind, clinicCode, at);
  const dir = process.env.X5_DIR ?? "var/x5";
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, fileName), bytes);
  return {
    fileName,
    storageKey: path.join(dir, fileName),
    rowCount: rows.length,
    warningCount,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
