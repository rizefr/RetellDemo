import { DateTime } from "luxon";

const SMALL_NUMBERS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
] as const;
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"] as const;

function integerToWords(value: number): string {
  const number = Math.max(0, Math.trunc(value));
  if (number < 20) return SMALL_NUMBERS[number];
  if (number < 100) {
    const remainder = number % 10;
    return `${TENS[Math.floor(number / 10)]}${remainder ? `-${SMALL_NUMBERS[remainder]}` : ""}`;
  }
  if (number < 1000) {
    const remainder = number % 100;
    return `${SMALL_NUMBERS[Math.floor(number / 100)]} hundred${remainder ? ` ${integerToWords(remainder)}` : ""}`;
  }
  for (const [size, label] of [[1_000_000_000, "billion"], [1_000_000, "million"], [1000, "thousand"]] as const) {
    if (number >= size) {
      const remainder = number % size;
      return `${integerToWords(Math.floor(number / size))} ${label}${remainder ? ` ${integerToWords(remainder)}` : ""}`;
    }
  }
  return String(number);
}

export function formatOutboundMoneySpoken(amountCents: number, currency = "usd"): string {
  const normalizedCurrency = currency.toLowerCase();
  if (normalizedCurrency !== "usd") {
    return `${integerToWords(Math.floor(amountCents / 100))} ${normalizedCurrency.toUpperCase()}`;
  }
  const dollars = Math.floor(amountCents / 100);
  const cents = Math.abs(amountCents % 100);
  const dollarText = `${integerToWords(dollars)} ${dollars === 1 ? "dollar" : "dollars"}`;
  return cents ? `${dollarText} and ${integerToWords(cents)} ${cents === 1 ? "cent" : "cents"}` : dollarText;
}

export function formatOutboundInvoiceIdSpoken(value: string | null | undefined): string {
  const parts = String(value ?? "").trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!parts.length) return "invoice number unavailable";
  const spoken = parts.map((part, index) => {
    if (/^\d+$/.test(part)) return part.split("").map((digit) => SMALL_NUMBERS[Number(digit)]).join(" ");
    if (index === 0 && /^[A-Z]{2,4}$/.test(part)) return part.split("").join("-");
    return part.toLowerCase();
  });
  return `invoice ${spoken.join(", ")}`;
}

export function formatOutboundInvoiceCountSpoken(count: number): string {
  const normalized = Math.max(0, Math.trunc(count));
  return `${integerToWords(normalized)} open ${normalized === 1 ? "invoice" : "invoices"}`;
}

export function formatOutboundPhoneSpoken(value: string | null | undefined): string {
  const input = String(value ?? "").trim();
  const match = input.match(/^\+(\d)(\d{3})(\d{3})(\d{4})$/);
  if (!match) return input || "phone number unavailable";
  const speakDigits = (digits: string) => digits.split("").map((digit) => SMALL_NUMBERS[Number(digit)]).join(" ");
  return `plus ${speakDigits(match[1])}, ${speakDigits(match[2])}, ${speakDigits(match[3])}, ${speakDigits(match[4])}`;
}

export function normalizeOutboundDate(value: string | null | undefined): string | null {
  const input = String(value ?? "").trim();
  if (!input) return null;
  const parsed = /^\d{8}$/.test(input)
    ? DateTime.fromFormat(input, "yyyyLLdd", { zone: "utc" })
    : DateTime.fromISO(input.slice(0, 10), { zone: "utc" });
  return parsed.isValid ? parsed.toFormat("yyyy-LL-dd") : null;
}

export function formatOutboundDate(value: string | null | undefined, fallback = "Date unavailable"): string {
  const normalized = normalizeOutboundDate(value);
  if (!normalized) return fallback;
  return DateTime.fromISO(normalized, { zone: "utc" }).toFormat("LLLL d, yyyy");
}

export function formatOutboundDateTime(
  value: string | null | undefined,
  timezone = "America/New_York",
  fallback = "Time unavailable",
): string {
  const parsed = DateTime.fromISO(String(value ?? ""), { setZone: true }).setZone(timezone);
  return parsed.isValid ? parsed.toFormat("LLLL d, yyyy 'at' h:mm a ZZZZ") : fallback;
}
