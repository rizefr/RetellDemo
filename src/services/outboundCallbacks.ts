import { DateTime } from "luxon";
import { normalizeOutboundDate } from "./outboundFormatting";
import { normalizeOutboundTimezone } from "./outboundEligibility";

export type OutboundCallbackResolution =
  | { ok: true; scheduledFor: string; scheduledForSpoken: string; timezone: string }
  | { ok: false; reason: string; message: string; timezone: string };

const WEEKDAYS: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

function callbackDate(reference: DateTime, phrase: string): DateTime | null {
  const value = phrase.trim().toLowerCase();
  if (value === "today") return reference.startOf("day");
  if (value === "tomorrow") return reference.plus({ days: 1 }).startOf("day");
  if (value in WEEKDAYS) {
    const target = WEEKDAYS[value];
    let days = target - reference.weekday;
    if (days <= 0) days += 7;
    return reference.plus({ days }).startOf("day");
  }
  const normalized = normalizeOutboundDate(value);
  return normalized ? DateTime.fromISO(normalized, { zone: reference.zoneName || "UTC" }) : null;
}

function parseClock(value: string): { hour: number; minute: number } | null {
  const parsed = DateTime.fromFormat(value, "HH:mm", { zone: "utc" });
  return parsed.isValid ? { hour: parsed.hour, minute: parsed.minute } : null;
}

function callbackTime(
  phrase: string,
  rules: { morning_time?: string; afternoon_time?: string },
): { hour: number; minute: number } | null {
  const value = phrase.trim().toLowerCase().replace(/\s+/g, " ");
  if (value === "morning") return parseClock(rules.morning_time || "10:00");
  if (value === "afternoon") return parseClock(rules.afternoon_time || "14:00");
  const twelveHour = DateTime.fromFormat(value.toUpperCase(), "h:mm a", { zone: "utc" });
  if (twelveHour.isValid) return { hour: twelveHour.hour, minute: twelveHour.minute };
  const shortTwelveHour = DateTime.fromFormat(value.toUpperCase(), "h a", { zone: "utc" });
  if (shortTwelveHour.isValid) return { hour: shortTwelveHour.hour, minute: 0 };
  const twentyFourHour = DateTime.fromFormat(value, "H:mm", { zone: "utc" });
  return twentyFourHour.isValid ? { hour: twentyFourHour.hour, minute: twentyFourHour.minute } : null;
}

export function resolveOutboundCallback(input: {
  datePhrase: string;
  timePhrase: string;
  timezone?: string | null;
  referenceTime?: Date;
  rules?: { weekday_start?: string; weekday_end?: string; morning_time?: string; afternoon_time?: string };
}): OutboundCallbackResolution {
  const timezone = normalizeOutboundTimezone(input.timezone);
  const reference = DateTime.fromJSDate(input.referenceTime ?? new Date(), { zone: timezone });
  const date = callbackDate(reference, input.datePhrase);
  const rules = input.rules ?? {};
  const time = callbackTime(input.timePhrase, rules);
  if (!date || !time) {
    return {
      ok: false,
      reason: "callback_time_ambiguous",
      message: "Ask for a specific weekday or date and a specific time.",
      timezone,
    };
  }
  const scheduled = date.set(time);
  if (scheduled.weekday > 5) {
    return {
      ok: false,
      reason: "callback_weekend_not_allowed",
      message: "Callbacks are available Monday through Friday.",
      timezone,
    };
  }
  const start = parseClock(rules.weekday_start || "10:00") ?? { hour: 10, minute: 0 };
  const end = parseClock(rules.weekday_end || "16:00") ?? { hour: 16, minute: 0 };
  const minutes = scheduled.hour * 60 + scheduled.minute;
  if (minutes < start.hour * 60 + start.minute || minutes >= end.hour * 60 + end.minute) {
    return {
      ok: false,
      reason: "callback_outside_calling_window",
      message: "Ask for a time between 10:00 AM and 4:00 PM local time.",
      timezone,
    };
  }
  if (scheduled <= reference) {
    return {
      ok: false,
      reason: "callback_time_in_past",
      message: "Ask for a future callback date and time.",
      timezone,
    };
  }
  return {
    ok: true,
    scheduledFor: scheduled.toUTC().toISO() as string,
    scheduledForSpoken: scheduled.toFormat("LLLL d, yyyy 'at' h:mm a ZZZZ"),
    timezone,
  };
}
