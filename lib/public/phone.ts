// P01 item 9 / P10 item 6 (P10 Q6 = A): clinics.phone is digits only (10–11); shown hyphenated, `tel:` with the digits.

/** 03 / 06 → 2-4-4; mobile 070 / 080 / 090 → 3-4-4; other 10 digits → 3-3-4; other 11 digits → 3-4-4. Anything else is returned as is. */
export function formatPhone(digits: string) {
  if (!/^\d{10,11}$/.test(digits)) return digits;
  if (digits.length === 10 && /^0[36]/.test(digits)) return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`; // 11 digits: 070 / 080 / 090 and the rest alike
}

export const telHref = (phone: string) => `tel:${phone.replace(/\D/g, "")}`;
