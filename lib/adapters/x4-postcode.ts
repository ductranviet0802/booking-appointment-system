// X4 郵便番号マスタ (05 X4, OD-13): postcode → address candidates. X4_SOURCE=fixture (default) reads
// fixtures/x4/postcodes.json; the provider is chosen at go-live (05), so any other value is "unavailable" for now.
// The browser calls /api/postcode, never the provider.
import { readFile } from "node:fs/promises";

export type AddressCandidate = { prefecture: string; city: string; town: string; prefectureKana: string; cityKana: string; townKana: string };

/** PE013: timeout / HTTP error — the fields stay editable */
export class X4UnavailableError extends Error {}

const CACHE_MS = 30 * 24 * 60 * 60 * 1000;
const g = globalThis as unknown as { x4Cache?: Map<string, { at: number; value: AddressCandidate[] }> };
const cache = (g.x4Cache ??= new Map());

/** full-width digits → half-width, hyphens removed; null unless 7 digits */
export function normalizePostcode(raw: string): string | null {
  const s = raw.normalize("NFKC").replace(/[-‐－ー−]/g, "").trim();
  return /^\d{7}$/.test(s) ? s : null;
}

/** 05 X4 special data: 「以下に掲載がない場合」 → empty town; 「（次のビルを除く）」 style notes stripped */
export function cleanTown(town: string) {
  if (town.includes("以下に掲載がない場合")) return "";
  return town.replace(/（[^）]*(除く|含む|以外|番地)[^）]*）/g, "").trim();
}

/** 0 candidates → PE012 for the caller; throws X4UnavailableError → PE013 */
export async function lookupPostcode(postcode: string, now = Date.now()): Promise<AddressCandidate[]> {
  const hit = cache.get(postcode);
  if (hit && now - hit.at < CACHE_MS) return hit.value;

  const source = process.env.X4_SOURCE ?? "fixture";
  if (source !== "fixture") throw new X4UnavailableError(`X4 source ${source} is not configured`);
  let table: Record<string, AddressCandidate[]>;
  try {
    table = JSON.parse(await readFile("fixtures/x4/postcodes.json", "utf8"));
  } catch (e) {
    throw new X4UnavailableError(String(e));
  }
  const value = (table[postcode] ?? []).map((c) => ({ ...c, town: cleanTown(c.town), townKana: c.town.includes("以下に掲載がない場合") ? "" : c.townKana }));
  cache.set(postcode, { at: now, value });
  return value;
}
