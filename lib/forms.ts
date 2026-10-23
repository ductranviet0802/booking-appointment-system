// F17-05: leading and trailing spaces, half- and full-width (U+0020, U+3000, tabs …), are removed before checks and storage;
// spaces only = empty (PE001).
export function trimSpaces(value: string) {
  return value.replace(/^[\s　]+|[\s　]+$/g, "");
}

export function isBlank(value: string) {
  return trimSpaces(value) === "";
}

/** Trim every string value of a form object */
export function trimFields<T extends Record<string, unknown>>(fields: T): T {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, typeof v === "string" ? trimSpaces(v) : v])) as T;
}

/** onBlur handler for an uncontrolled / controlled input: writes the trimmed text back */
export function trimOnBlur(e: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) {
  const el = e.currentTarget;
  const trimmed = trimSpaces(el.value);
  if (trimmed !== el.value) {
    el.value = trimmed;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}
