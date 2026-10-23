// spec-screen: P08
// Keyword rules shared by P01 item 5 and P08 item 1 (F12-02): trim, 50 characters, NFKC / kana / case normalisation, words AND.

export const KEYWORD_MAX = 50;

/** removes half- and full-width spaces at both ends (spaces only → "") */
export const trimKeyword = (s: string) => s.replace(/^[\s　]+|[\s　]+$/g, "");

/** the box value to keep: trimmed, cut at 50 characters (a paste is cut, counted after trimming; leading spaces are not kept) */
export const clampKeyword = (s: string) => Array.from(trimKeyword(s)).slice(0, KEYWORD_MAX).join("");

/** NFKC (width), lower case, hiragana → katakana (U+3041–3096 + 0x60) */
export function normalizeText(s: string) {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

/** words of a keyword after normalisation, split at spaces */
export const keywordWords = (keyword: string) => normalizeText(trimKeyword(keyword)).split(/\s+/).filter(Boolean);

/** every word is a substring of at least one field (AND across words, OR across fields); no words → true */
export function matchesKeyword(words: string[], fields: Array<string | null | undefined>) {
  const hay = fields.filter((f): f is string => !!f).map(normalizeText);
  return words.every((w) => hay.some((f) => f.includes(w)));
}
