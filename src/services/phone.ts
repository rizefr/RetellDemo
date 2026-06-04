import { parsePhoneNumberFromString } from "libphonenumber-js";

export function normalizeUSPhone(input: string | null | undefined): string {
  if (!input) return "";
  const trimmed = input.trim();
  const parsed = parsePhoneNumberFromString(trimmed, "US");
  if (parsed?.isValid()) return parsed.number;

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (trimmed.startsWith("+")) return trimmed.replace(/[^\d+]/g, "");
  return trimmed;
}
