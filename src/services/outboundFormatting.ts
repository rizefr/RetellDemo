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
  const usMatch = input.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  const speakDigits = (digits: string) => digits.split("").map((digit) => SMALL_NUMBERS[Number(digit)]).join(" ");
  if (usMatch) return `${speakDigits(usMatch[1])}, ${speakDigits(usMatch[2])}, ${speakDigits(usMatch[3])}`;
  const digits = input.replace(/\D/g, "");
  return digits ? speakDigits(digits) : "phone number unavailable";
}

export function formatOutboundPhoneSpokenChunked(value: string | null | undefined): string {
  const input = String(value ?? "").trim();
  const usMatch = input.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  const speakDigits = (digits: string) => digits.split("").map((digit) => SMALL_NUMBERS[Number(digit)]).join(" ");
  if (usMatch) {
    return `area code ${speakDigits(usMatch[1])}, then ${speakDigits(usMatch[2])}, then ${speakDigits(usMatch[3])}`;
  }
  const digits = input.replace(/\D/g, "");
  return digits ? speakDigits(digits) : "phone number unavailable";
}

export function formatOutboundEmailSpoken(value: string | null | undefined): string {
  const input = String(value ?? "").trim().toLowerCase();
  if (!input) return "email unavailable";
  return input
    .replace(/@/g, " at ")
    .replace(/\./g, " dot ")
    .replace(/\+/g, " plus ")
    .replace(/_/g, " underscore ")
    .replace(/-/g, " dash ")
    .replace(/\s+/g, " ")
    .trim();
}

function spellEmailLocalToken(token: string): string {
  if (!token) return "";
  if (/^\d+$/.test(token)) return token.split("").map((digit) => SMALL_NUMBERS[Number(digit)]).join("-");
  if (/^[a-z]+$/.test(token)) {
    if (token.endsWith("agency") && token.length > "agency".length) {
      const prefix = token.slice(0, -"agency".length);
      return `${prefix.split("").join("-")} agency`;
    }
    return token.split("").join("-");
  }
  return token;
}

export function formatOutboundEmailSpokenSlow(value: string | null | undefined): string {
  const input = String(value ?? "").trim().toLowerCase();
  if (!input) return "email unavailable";
  const [local, domain = ""] = input.split("@");
  const spokenLocal = local
    .split(/([._+-])/)
    .filter(Boolean)
    .map((part) => {
      if (part === ".") return "dot";
      if (part === "_") return "underscore";
      if (part === "+") return "plus";
      if (part === "-") return "dash";
      return spellEmailLocalToken(part);
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const spokenDomain = domain
    .replace(/\./g, " dot ")
    .replace(/-/g, " dash ")
    .replace(/\s+/g, " ")
    .trim();
  return [spokenLocal || "email", spokenDomain ? `at ${spokenDomain}` : ""].filter(Boolean).join(" ");
}

const PHONETIC_ALPHABET: Record<string, string> = {
  a: "Alpha",
  b: "Bravo",
  c: "Charlie",
  d: "Delta",
  e: "Echo",
  f: "Foxtrot",
  g: "Golf",
  h: "Hotel",
  i: "India",
  j: "Juliet",
  k: "Kilo",
  l: "Lima",
  m: "Mike",
  n: "November",
  o: "Oscar",
  p: "Papa",
  q: "Quebec",
  r: "Romeo",
  s: "Sierra",
  t: "Tango",
  u: "Uniform",
  v: "Victor",
  w: "Whiskey",
  x: "X-ray",
  y: "Yankee",
  z: "Zulu",
};

function spellPhoneticToken(token: string): string {
  if (!token) return "";
  if (/^\d+$/.test(token)) return token.split("").map((digit) => SMALL_NUMBERS[Number(digit)]).join(", ");
  if (/^[a-z]+$/.test(token)) {
    if (token.endsWith("agency") && token.length > "agency".length) {
      const prefix = token.slice(0, -"agency".length);
      return [spellPhoneticToken(prefix), "agency"].filter(Boolean).join(", ");
    }
    return token
      .split("")
      .map((letter) => `${letter} as in ${PHONETIC_ALPHABET[letter] || letter.toUpperCase()}`)
      .join(", ");
  }
  return token;
}

export function formatOutboundEmailSpokenPhonetic(value: string | null | undefined): string {
  const input = String(value ?? "").trim().toLowerCase();
  if (!input) return "email unavailable";
  const [local, domain = ""] = input.split("@");
  const spokenLocal = local
    .split(/([._+-])/)
    .filter(Boolean)
    .map((part) => {
      if (part === ".") return "dot";
      if (part === "_") return "underscore";
      if (part === "+") return "plus";
      if (part === "-") return "dash";
      return spellPhoneticToken(part);
    })
    .join(", ")
    .replace(/\s+/g, " ")
    .trim();
  const spokenDomain = domain
    .replace(/\./g, " dot ")
    .replace(/-/g, " dash ")
    .replace(/\s+/g, " ")
    .trim();
  return [spokenLocal || "email", spokenDomain ? `at ${spokenDomain}` : ""].filter(Boolean).join(", ");
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

export function formatOutboundYearSpoken(value: number | string | null | undefined): string {
  const year = Number(value);
  if (!Number.isInteger(year)) return "";
  if (year >= 2000 && year <= 2099) {
    const suffix = year - 2000;
    if (suffix === 0) return "two thousand";
    if (suffix < 10) return `twenty oh ${SMALL_NUMBERS[suffix]}`;
    return `twenty ${integerToWords(suffix)}`;
  }
  return integerToWords(year);
}

export function formatOutboundDateSpoken(value: string | null | undefined, fallback = "date unavailable"): string {
  const normalized = normalizeOutboundDate(value);
  if (!normalized) return fallback;
  const parsed = DateTime.fromISO(normalized, { zone: "utc" });
  return `${parsed.toFormat("LLLL d")}, ${formatOutboundYearSpoken(parsed.year)}`;
}

export function formatOutboundDateTime(
  value: string | null | undefined,
  timezone = "America/New_York",
  fallback = "Time unavailable",
): string {
  const parsed = DateTime.fromISO(String(value ?? ""), { setZone: true }).setZone(timezone);
  return parsed.isValid ? parsed.toFormat("LLLL d, yyyy 'at' h:mm a ZZZZ") : fallback;
}
