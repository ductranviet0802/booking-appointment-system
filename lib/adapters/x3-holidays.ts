// X3 祝日CSV (05 X3): Shift_JIS, CRLF, header, `YYYY/M/D,name`. Source by env X3_SOURCE: an https URL (the
// Cabinet Office file, timeout 30 s) or a file path relative to the app root (default: the local fixture).
import { readFile } from "node:fs/promises";

export const X3_HEADER = "国民の祝日・休日月日,国民の祝日・休日名称";
const DEFAULT_SOURCE = "fixtures/x3/syukujitsu.csv";

// 07 §4 — a name not listed stays en/vi null (falls back to ja)
export const HOLIDAY_NAMES: Record<string, { en: string; vi: string }> = {
  元日: { en: "New Year's Day", vi: "Tết Dương lịch" },
  成人の日: { en: "Coming of Age Day", vi: "Ngày Lễ Thành nhân" },
  建国記念の日: { en: "National Foundation Day", vi: "Ngày Kỷ niệm Lập quốc" },
  天皇誕生日: { en: "Emperor's Birthday", vi: "Ngày sinh Thiên hoàng" },
  春分の日: { en: "Vernal Equinox Day", vi: "Ngày Xuân phân" },
  昭和の日: { en: "Showa Day", vi: "Ngày Showa" },
  憲法記念日: { en: "Constitution Memorial Day", vi: "Ngày Hiến pháp" },
  みどりの日: { en: "Greenery Day", vi: "Ngày Cây xanh" },
  こどもの日: { en: "Children's Day", vi: "Ngày Thiếu nhi" },
  海の日: { en: "Marine Day", vi: "Ngày của Biển" },
  山の日: { en: "Mountain Day", vi: "Ngày của Núi" },
  敬老の日: { en: "Respect for the Aged Day", vi: "Ngày Kính lão" },
  秋分の日: { en: "Autumnal Equinox Day", vi: "Ngày Thu phân" },
  スポーツの日: { en: "Sports Day", vi: "Ngày Thể thao" },
  文化の日: { en: "Culture Day", vi: "Ngày Văn hóa" },
  勤労感謝の日: { en: "Labour Thanksgiving Day", vi: "Ngày Cảm tạ Lao động" },
  休日: { en: "Substitute holiday", vi: "Ngày nghỉ bù" },
};

export type HolidayRow = { date: string; nameJa: string; nameEn: string | null; nameVi: string | null };

/** SE041 cases: the import is rejected as a whole */
export class X3ValidationError extends Error {}

/** Rows from 1 Jan of `currentYear` on; throws X3ValidationError when the file breaks a 05 X3 rule. */
export function parseHolidayCsv(bytes: Uint8Array, currentYear: number): HolidayRow[] {
  const lines = new TextDecoder("shift_jis").decode(bytes).split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines[0]?.trim() !== X3_HEADER) throw new X3ValidationError("header missing");

  const seen = new Set<string>();
  const years = new Set<number>();
  const rows: HolidayRow[] = [];
  for (const line of lines.slice(1)) {
    const [rawDate, rawName] = line.split(",");
    const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(rawDate?.trim() ?? "");
    const name = rawName?.trim();
    if (!m || !name) throw new X3ValidationError(`unparseable row: ${line}`);
    const date = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new X3ValidationError(`invalid date: ${rawDate}`);
    }
    if (seen.has(date)) throw new X3ValidationError(`duplicate date: ${date}`);
    seen.add(date);
    years.add(Number(m[1]));
    if (Number(m[1]) >= currentYear) {
      const t = HOLIDAY_NAMES[name];
      rows.push({ date, nameJa: name, nameEn: t?.en ?? null, nameVi: t?.vi ?? null });
    }
  }
  for (const y of [currentYear, currentYear + 1]) {
    if (!years.has(y)) throw new X3ValidationError(`no row for ${y}`);
  }
  return rows;
}

/** SE041 {理由} kinds besides X3ValidationError (A01 Q9 c) */
export class X3HttpError extends Error {}
export class X3TimeoutError extends Error {}

/** A01 SE041 {理由} of a failed import: ダウンロード失敗 / 応答なし (timeout) / ファイルの内容が不正 */
export function x3FailureReason(e: unknown) {
  if (e instanceof X3ValidationError) return "ファイルの内容が正しくありません";
  if (e instanceof X3TimeoutError) return "応答がありませんでした";
  return "ダウンロードに失敗しました";
}

export async function fetchHolidayFile(source = process.env.X3_SOURCE || DEFAULT_SOURCE): Promise<Uint8Array> {
  if (/^https?:\/\//.test(source)) {
    let res: Response;
    try {
      res = await fetch(source, { signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      throw (e as Error)?.name === "TimeoutError" ? new X3TimeoutError("X3 timeout") : new X3HttpError(String(e));
    }
    if (!res.ok) throw new X3HttpError(`X3 HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  try {
    return await readFile(source);
  } catch (e) {
    throw new X3HttpError(String(e));
  }
}
