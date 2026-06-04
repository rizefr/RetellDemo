import { env } from "../config/env";

export interface CalComDiscoveryResult {
  booking_url: string;
  source: "env" | "calcom" | "none";
  status: "configured" | "verified_from_calcom" | "missing" | "error";
  inspected_event_types: number;
  warnings: string[];
  manual_steps: string[];
}

type FetchLike = typeof fetch;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringAt(source: Record<string, unknown> | null, keys: string[]): string {
  if (!source) return "";
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function nestedRecord(source: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  return asRecord(source?.[key]);
}

function eventArray(json: unknown): Record<string, unknown>[] {
  const root = asRecord(json);
  if (!root) return [];
  const data = root.data;
  if (Array.isArray(data)) return data.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item));
  const dataRecord = asRecord(data);
  for (const key of ["eventTypes", "items", "data"]) {
    const value = dataRecord?.[key] ?? root[key];
    if (Array.isArray(value)) {
      return value.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item));
    }
  }
  return [];
}

function directBookingUrl(eventType: Record<string, unknown>): string {
  return stringAt(eventType, ["bookingUrl", "booking_url", "schedulingUrl", "scheduling_url", "url"]);
}

function usernameFor(eventType: Record<string, unknown>): string {
  const direct = stringAt(eventType, ["username", "userName"]);
  if (direct) return direct;
  const owner = nestedRecord(eventType, "owner") ?? nestedRecord(eventType, "user") ?? nestedRecord(eventType, "profile");
  return stringAt(owner, ["username", "userName", "slug"]);
}

function urlFromEventType(eventType: Record<string, unknown>): string {
  const direct = directBookingUrl(eventType);
  if (direct.startsWith("https://cal.com/")) return direct;
  const slug = stringAt(eventType, ["slug"]);
  const username = usernameFor(eventType);
  if (username && slug) return `https://cal.com/${username}/${slug}`;
  return "";
}

export async function discoverCalComBookingUrl(fetchImpl: FetchLike = fetch): Promise<CalComDiscoveryResult> {
  const manual_steps = [
    "In Cal.com, create an event type for pest-control appointments.",
    "Set appointment length, availability, buffers, location/phone-call details, and required fields.",
    "Copy the event booking URL into BOOKING_URL, or set CALCOM_EVENT_TYPE_ID plus CALCOM_USERNAME/CALCOM_EVENT_SLUG.",
    "Set CALENDAR_PROVIDER=none until live booking is ready, or CALENDAR_PROVIDER=mock for test-only booking.",
    "Rerun npm run setup:retell and test phone-booking fallback before enabling real booking.",
  ];

  if (env.BOOKING_URL) {
    return {
      booking_url: env.BOOKING_URL,
      source: "env",
      status: "configured",
      inspected_event_types: 0,
      warnings: [],
      manual_steps,
    };
  }

  if (!env.CALCOM_API_KEY) {
    return {
      booking_url: "",
      source: "none",
      status: "missing",
      inspected_event_types: 0,
      warnings: ["BOOKING_URL is missing and CALCOM_API_KEY is not set. Booking link delivery will stay in safe fallback mode."],
      manual_steps,
    };
  }

  try {
    const response = await fetchImpl("https://api.cal.com/v2/event-types", {
      headers: {
        Authorization: `Bearer ${env.CALCOM_API_KEY}`,
        "cal-api-version": "2024-06-14",
      },
    });
    const json = (await response.json()) as unknown;
    if (!response.ok) {
      return {
        booking_url: "",
        source: "none",
        status: "error",
        inspected_event_types: 0,
        warnings: [`Cal.com event-type lookup failed with HTTP ${response.status}. No event type was created.`],
        manual_steps,
      };
    }

    const eventTypes = eventArray(json);
    const verified = eventTypes.map(urlFromEventType).find(Boolean) ?? "";
    return {
      booking_url: verified,
      source: verified ? "calcom" : "none",
      status: verified ? "verified_from_calcom" : "missing",
      inspected_event_types: eventTypes.length,
      warnings: verified
        ? []
        : [
            "Cal.com API key is set, but no event type with a verified username/slug or booking URL was found. No event type was created.",
          ],
      manual_steps,
    };
  } catch (error) {
    return {
      booking_url: "",
      source: "none",
      status: "error",
      inspected_event_types: 0,
      warnings: [`Cal.com event-type lookup failed: ${error instanceof Error ? error.message : String(error)}`],
      manual_steps,
    };
  }
}
