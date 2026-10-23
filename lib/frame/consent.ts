/** `next` of /consent is a path inside this site only (no open redirect); the default is the P02 destination without return target (T009 → P06) */
export function safeNext(next: string | string[] | undefined) {
  const value = Array.isArray(next) ? next[0] : next;
  return value && /^\/(?![/\\])/.test(value) ? value : "/mypage";
}
