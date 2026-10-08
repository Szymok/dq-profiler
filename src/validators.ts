/** Simple e-mail shape check: something@domain.tld. It does not prove the mailbox exists. */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

/** Polish NIP: 10 digits (separators and a "PL" prefix are allowed) with the official checksum. */
export function isValidNip(value: string): boolean {
  const digits = value.trim().replace(/^PL/i, "").replace(/[\s-]/g, "");
  if (!/^\d{10}$/.test(digits)) return false;
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  const control = sum % 11;
  return control !== 10 && control === Number(digits[9]);
}

/** Polish postal code: 00-000. */
export function isValidPostalCodePl(value: string): boolean {
  return /^\d{2}-\d{3}$/.test(value.trim());
}

/** Polish phone number: 9 digits, optionally with +48 / 0048 and spaces, dashes or brackets. */
export function isValidPhonePl(value: string): boolean {
  const compact = value.trim().replace(/[\s\-()]/g, "");
  return /^(\+48|0048)?\d{9}$/.test(compact);
}
