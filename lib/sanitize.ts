export function sanitizePatientNotes(input: string | null | undefined): string | null {
  if (!input) {
    return null;
  }

  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .trim();
}
