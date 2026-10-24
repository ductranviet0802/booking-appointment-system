// The B3 run message 「追加{a}・変更{b}・削除{c}」 (A01 item 15) and its counts for SI041; no server imports, the page uses it too.
export const b3Message = (a: number, b: number, c: number) => `追加${a}・変更${b}・削除${c}`;
export function parseB3Message(message: string | null) {
  const m = /追加(\d+)・変更(\d+)・削除(\d+)/.exec(message ?? "");
  return { a: Number(m?.[1] ?? 0), b: Number(m?.[2] ?? 0), c: Number(m?.[3] ?? 0) };
}
