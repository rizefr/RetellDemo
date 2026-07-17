import { DateTime } from "luxon";
import { normalizeOutboundTimezone } from "./outboundEligibility";
import { formatOutboundDateSpoken, normalizeOutboundDate } from "./outboundFormatting";

export type OutboundExpectedPaymentDateResolution =
  | {
      ok: true;
      expectedPaymentDate: string;
      expectedPaymentDateSpoken: string;
      timezone: string;
    }
  | {
      ok: false;
      reason: "expected_payment_date_ambiguous" | "expected_payment_date_in_past";
      message: string;
      timezone: string;
    };

const WEEKDAYS: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

function parseExpectedPaymentDate(reference: DateTime, phrase: string): DateTime | null {
  const value = phrase.trim().toLowerCase().replace(/\s+/g, " ");
  if (value === "today") return reference.startOf("day");
  if (value === "tomorrow") return reference.plus({ days: 1 }).startOf("day");

  const weekdayMatch = value.match(/^(?:next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
  if (weekdayMatch) {
    const target = WEEKDAYS[weekdayMatch[1]];
    let days = target - reference.weekday;
    if (days <= 0) days += 7;
    return reference.plus({ days }).startOf("day");
  }

  const normalized = normalizeOutboundDate(value);
  if (normalized) return DateTime.fromISO(normalized, { zone: reference.zoneName || "UTC" }).startOf("day");

  const withoutOrdinals = value.replace(/(\d+)(st|nd|rd|th)\b/g, "$1");
  for (const format of ["LLLL d, yyyy", "LLL d, yyyy", "M/d/yyyy"]) {
    const parsed = DateTime.fromFormat(withoutOrdinals, format, { zone: reference.zoneName || "UTC", locale: "en" });
    if (parsed.isValid) return parsed.startOf("day");
  }

  for (const format of ["LLLL d", "LLL d", "M/d"]) {
    let parsed = DateTime.fromFormat(withoutOrdinals, format, {
      zone: reference.zoneName || "UTC",
      locale: "en",
    }).set({ year: reference.year });
    if (!parsed.isValid) continue;
    if (parsed.startOf("day") < reference.startOf("day")) parsed = parsed.plus({ years: 1 });
    return parsed.startOf("day");
  }

  return null;
}

export function resolveOutboundExpectedPaymentDate(input: {
  datePhrase: string;
  timezone?: string | null;
  referenceTime?: Date;
}): OutboundExpectedPaymentDateResolution {
  const timezone = normalizeOutboundTimezone(input.timezone);
  const reference = DateTime.fromJSDate(input.referenceTime ?? new Date(), { zone: timezone });
  const expected = parseExpectedPaymentDate(reference, input.datePhrase);
  if (!expected) {
    return {
      ok: false,
      reason: "expected_payment_date_ambiguous",
      message: "Ask for a specific date, such as Friday or July 20.",
      timezone,
    };
  }
  if (expected.startOf("day") < reference.startOf("day")) {
    return {
      ok: false,
      reason: "expected_payment_date_in_past",
      message: "Ask for a future expected payment date.",
      timezone,
    };
  }
  const expectedPaymentDate = expected.toFormat("yyyy-LL-dd");
  return {
    ok: true,
    expectedPaymentDate,
    expectedPaymentDateSpoken: formatOutboundDateSpoken(expectedPaymentDate),
    timezone,
  };
}
