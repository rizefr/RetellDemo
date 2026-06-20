import { DateTime } from "luxon";

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
