// Languages and the message catalog (04). Safe for server and client code.
import catalog from "./messages.json";

export type Lang = "ja" | "en" | "vi";
export const LANGS: readonly Lang[] = ["ja", "en", "vi"];
export const DEFAULT_LANG: Lang = "ja";

/** Language cookie (F13-02): lifetime 1 year. The auth module writes it at login with the account language. */
export const LANG_COOKIE = "lang";
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Own-language names for the switcher (item 8) */
export const LANG_NAMES: Record<Lang, string> = { ja: "日本語", en: "English", vi: "Tiếng Việt" };

/** Accepts "ja" or the Prisma value "JA"; anything else → null */
export function parseLang(value: unknown): Lang | null {
  if (typeof value !== "string") return null;
  const v = value.toLowerCase();
  return v === "ja" || v === "en" || v === "vi" ? v : null;
}

export type MessageId = string;
type Entry = { ja: string; en?: string; vi?: string };
const messages: Record<string, Entry> = catalog.messages;
const aliases: Record<string, string> = catalog.aliases;
// 04 names a placeholder {項目} in ja and {field} in en / vi: a caller may pass either name.
const reverseAliases = Object.fromEntries(Object.entries(aliases).map(([ja, en]) => [en, ja]));

export function hasMessage(id: string) {
  return id in messages;
}

export function messageIds() {
  return Object.keys(messages);
}

export type Params = Record<string, string | number>;

/** Text of a 04 message in a language (staff ids exist in ja only). Unknown `{x}` stay visible. */
export function t(id: MessageId, lang: Lang, params: Params = {}): string {
  const entry = messages[id];
  if (!entry) return id;
  const text = entry[lang] ?? entry.ja;
  return text.replace(/\{([^{}]+)\}/g, (whole, name: string) => {
    const v = params[name] ?? params[aliases[name]] ?? params[reverseAliases[name]];
    return v === undefined ? whole : String(v);
  });
}
