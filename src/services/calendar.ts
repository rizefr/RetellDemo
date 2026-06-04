import { env } from "../config/env";
import {
  BookAppointmentInput,
  CheckAvailabilityInput,
} from "../schemas/toolSchemas";
import { normalizeUSPhone } from "./phone";
import { insertRecord } from "./supabase";

export interface AvailabilityResult {
  success?: boolean;
  enabled: boolean;
  provider: "none" | "mock" | "calcom";
  available: boolean;
  slots: string[];
  message_for_agent: string;
  config_status?: string;
}

export interface BookingResult {
  success?: boolean;
  enabled: boolean;
  provider: "none" | "mock" | "calcom";
  confirmed: boolean;
  booking_id: string | null;
  confirmed_datetime: string | null;
  message_for_agent: string;
  config_status?: string;
  dry_run?: boolean;
  selected_datetime_utc?: string | null;
  calcom_error?: SanitizedCalComError;
  request_summary?: Record<string, unknown>;
}

export interface CalendarAdapter {
  checkAvailability(input: CheckAvailabilityInput): Promise<AvailabilityResult>;
  bookAppointment(input: BookAppointmentInput): Promise<BookingResult>;
}

export interface CalComRuntimeConfig {
  apiKey: string;
  eventTypeId: string;
  username: string;
  eventSlug: string;
  bookingUrl: string;
  placeholderEmail: string;
  source: "env_event_type_id" | "env_username_slug" | "booking_url" | "missing";
}

export interface CandidateCalComConfigStatus {
  usable: boolean;
  status: "ready" | "missing_api_key" | "missing_event_identifier";
  config: CalComRuntimeConfig;
  message: string;
}

export interface SanitizedCalComError {
  http_status?: number;
  status?: string;
  code?: string;
  message?: string;
  path?: string;
  issues?: unknown;
}

function emptyCalComConfig(source: CalComRuntimeConfig["source"] = "missing"): CalComRuntimeConfig {
  return {
    apiKey: env.CALCOM_API_KEY,
    eventTypeId: "",
    username: "",
    eventSlug: "",
    bookingUrl: env.BOOKING_URL,
    placeholderEmail: env.BOOKING_PLACEHOLDER_EMAIL,
    source,
  };
}

export function parseCalComBookingUrl(url: string): { username: string; eventSlug: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "cal.com" && !parsed.hostname.endsWith(".cal.com")) return null;
    const [username, eventSlug] = parsed.pathname.split("/").filter(Boolean);
    if (!username || !eventSlug) return null;
    return { username, eventSlug };
  } catch {
    return null;
  }
}

function envCalComConfig(): CalComRuntimeConfig {
  if (env.CALCOM_EVENT_TYPE_ID) {
    return {
      ...emptyCalComConfig("env_event_type_id"),
      eventTypeId: env.CALCOM_EVENT_TYPE_ID,
    };
  }
  if (env.CALCOM_USERNAME && env.CALCOM_EVENT_SLUG) {
    return {
      ...emptyCalComConfig("env_username_slug"),
      username: env.CALCOM_USERNAME,
      eventSlug: env.CALCOM_EVENT_SLUG,
    };
  }
  return emptyCalComConfig();
}

export function candidateCalComConfigFromEnv(): CandidateCalComConfigStatus {
  if (!env.CALCOM_API_KEY) {
    return {
      usable: false,
      status: "missing_api_key",
      config: emptyCalComConfig(),
      message: "CALCOM_API_KEY is missing. Candidate phone booking cannot use real Cal.com.",
    };
  }

  const configured = envCalComConfig();
  if (configured.eventTypeId || (configured.username && configured.eventSlug)) {
    return {
      usable: true,
      status: "ready",
      config: configured,
      message: `Candidate Cal.com config uses ${configured.source}.`,
    };
  }

  const parsed = parseCalComBookingUrl(env.BOOKING_URL);
  if (parsed) {
    return {
      usable: true,
      status: "ready",
      config: {
        ...emptyCalComConfig("booking_url"),
        username: parsed.username,
        eventSlug: parsed.eventSlug,
      },
      message: "Candidate Cal.com config was derived from BOOKING_URL.",
    };
  }

  return {
    usable: false,
    status: "missing_event_identifier",
    config: emptyCalComConfig(),
    message:
      "Cal.com API key is set, but no event type ID, username/slug, or parseable Cal.com BOOKING_URL is configured.",
  };
}

function dateWindow(preferredDate: string): { start: string; end: string } {
  if (preferredDate.includes("T")) {
    const start = new Date(preferredDate);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  const dateOnly = preferredDate.trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    return { start: `${dateOnly}T00:00:00Z`, end: `${dateOnly}T23:59:59Z` };
  }

  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 1);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function combinedAddress(input: BookAppointmentInput): string {
  const explicit = input.property_address?.trim();
  if (explicit) return explicit;
  return [
    input.property_street,
    input.property_city,
    input.property_state,
    input.property_zip,
  ]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
}

export function calComUtcStart(selectedDatetime: string): string | null {
  const parsed = new Date(selectedDatetime);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function sanitizeCalComError(httpStatus: number, json: unknown): SanitizedCalComError {
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const nested = body.error && typeof body.error === "object" ? (body.error as Record<string, unknown>) : {};
  const message =
    typeof nested.message === "string"
      ? nested.message
      : typeof body.message === "string"
        ? body.message
        : typeof body.error === "string"
          ? body.error
          : undefined;
  return {
    http_status: httpStatus,
    status: typeof body.status === "string" ? body.status : undefined,
    code: typeof nested.code === "string" ? nested.code : typeof body.code === "string" ? body.code : undefined,
    message,
    path: typeof body.path === "string" ? body.path : undefined,
    issues: nested.issues ?? body.issues ?? nested.details ?? body.details,
  };
}

class NoneCalendarAdapter implements CalendarAdapter {
  async checkAvailability(): Promise<AvailabilityResult> {
    return {
      enabled: false,
      provider: "none",
      available: false,
      slots: [],
      message_for_agent:
        "Live phone booking is not enabled. Take the request, create a lead, and offer the booking link by SMS.",
    };
  }

  async bookAppointment(input: BookAppointmentInput): Promise<BookingResult> {
    await storeBookingRequest(input, {
      enabled: false,
      provider: "none",
      confirmed: false,
      booking_id: null,
      confirmed_datetime: null,
      message_for_agent: "Calendar booking is disabled; appointment is not confirmed.",
    });
    return {
      enabled: false,
      provider: "none",
      confirmed: false,
      booking_id: null,
      confirmed_datetime: null,
      message_for_agent:
        "Calendar booking is disabled. Do not confirm the appointment; say the team will confirm the requested time.",
    };
  }
}

class MockCalendarAdapter implements CalendarAdapter {
  async checkAvailability(input: CheckAvailabilityInput): Promise<AvailabilityResult> {
    const date = input.preferred_date;
    return {
      enabled: true,
      provider: "mock",
      available: true,
      slots: [`${date}T09:00:00-05:00`, `${date}T11:30:00-05:00`, `${date}T14:00:00-05:00`],
      message_for_agent:
        "Mock calendar returned three test slots. Label these as test availability if discussing internally.",
    };
  }

  async bookAppointment(input: BookAppointmentInput): Promise<BookingResult> {
    const result = {
      enabled: true,
      provider: "mock" as const,
      confirmed: true,
      booking_id: `mock_${Buffer.from(input.selected_datetime).toString("hex").slice(0, 10)}`,
      confirmed_datetime: input.selected_datetime,
      message_for_agent:
        "Mock booking confirmed for testing only. In a real call, only use mock mode for demos.",
    };
    await storeBookingRequest(input, result);
    return result;
  }
}

class CalComCalendarAdapter implements CalendarAdapter {
  constructor(private readonly config: CalComRuntimeConfig = envCalComConfig()) {}

  async checkAvailability(input: CheckAvailabilityInput): Promise<AvailabilityResult> {
    if (!this.config.apiKey || (!this.config.eventTypeId && !(this.config.username && this.config.eventSlug))) {
      return {
        success: true,
        enabled: false,
        provider: "calcom",
        available: false,
        slots: [],
        config_status: "missing_calcom_config",
        message_for_agent:
          "Cal.com is selected but credentials or event identifiers are missing. Do not confirm an appointment.",
      };
    }

    const window = dateWindow(input.preferred_date);
    const params = new URLSearchParams({
      start: window.start,
      end: window.end,
      timeZone: input.timezone,
      format: "range",
    });
    if (this.config.eventTypeId) params.set("eventTypeId", this.config.eventTypeId);
    if (this.config.username && this.config.eventSlug) {
      params.set("username", this.config.username);
      params.set("eventTypeSlug", this.config.eventSlug);
    }

    const response = await fetch(`https://api.cal.com/v2/slots?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "cal-api-version": "2024-09-04",
      },
    });
    const json = (await response.json()) as { status?: string; data?: Record<string, Array<{ start?: string }>> };
    if (!response.ok || json.status === "error") {
      return {
        success: false,
        enabled: true,
        provider: "calcom",
        available: false,
        slots: [],
        config_status: `calcom_http_${response.status}`,
        message_for_agent:
          "Cal.com availability lookup failed. Do not confirm a slot; offer SMS booking or team follow-up.",
      };
    }

    const slots = Object.values(json.data ?? {})
      .flat()
      .map((slot) => slot.start)
      .filter((slot): slot is string => Boolean(slot))
      .slice(0, 3);
    return {
      success: true,
      enabled: true,
      provider: "calcom",
      available: slots.length > 0,
      slots,
      config_status: this.config.source,
      message_for_agent:
        slots.length > 0
          ? "Cal.com returned available slots. Offer these options."
          : "Cal.com returned no slots. Offer SMS booking or team follow-up.",
    };
  }

  async bookAppointment(input: BookAppointmentInput): Promise<BookingResult> {
    if (!this.config.apiKey || (!this.config.eventTypeId && !(this.config.username && this.config.eventSlug))) {
      const result = {
        success: true,
        enabled: false,
        provider: "calcom" as const,
        confirmed: false,
        booking_id: null,
        confirmed_datetime: null,
        config_status: "missing_calcom_config",
        message_for_agent: "Cal.com credentials are incomplete. Do not confirm the appointment.",
      };
      await storeBookingRequest(input, result);
      return result;
    }

    const startUtc = calComUtcStart(input.selected_datetime);
    if (!startUtc) {
      const result = {
        success: false,
        enabled: true,
        provider: "calcom" as const,
        confirmed: false,
        booking_id: null,
        confirmed_datetime: null,
        selected_datetime_utc: null,
        config_status: "invalid_selected_datetime",
        message_for_agent:
          "The selected time could not be converted for Cal.com. Do not confirm the booking; offer follow-up.",
      };
      await storeBookingRequest(input, result, result);
      return result;
    }

    const serviceAddress = combinedAddress(input);
    const normalizedPhone = normalizeUSPhone(input.caller_phone);
    const normalizedAlternate = input.alternate_phone ? normalizeUSPhone(input.alternate_phone) : null;
    const attendeeEmail = input.email || this.config.placeholderEmail || env.BOOKING_PLACEHOLDER_EMAIL;
    const requestSummary = {
      start: startUtc,
      event_identifier: this.config.eventTypeId
        ? { eventTypeId: Number(this.config.eventTypeId) }
        : { username: this.config.username, eventTypeSlug: this.config.eventSlug },
      attendee: {
        name: input.caller_name,
        email: attendeeEmail,
        phoneNumber: normalizedPhone,
        timeZone: input.timezone,
      },
      service_address_present: Boolean(serviceAddress),
      pest_issue: input.pest_issue,
      dry_run: input.dry_run,
    };

    if (input.dry_run) {
      const result = {
        success: true,
        enabled: true,
        provider: "calcom" as const,
        confirmed: false,
        booking_id: null,
        confirmed_datetime: null,
        dry_run: true,
        selected_datetime_utc: startUtc,
        config_status: this.config.source,
        request_summary: requestSummary,
        message_for_agent:
          "Cal.com booking dry run passed request-shape validation. No real booking was created; do not confirm the appointment.",
      };
      await storeBookingRequest(input, result, result);
      return result;
    }

    if (!serviceAddress) {
      const result = {
        success: false,
        enabled: true,
        provider: "calcom" as const,
        confirmed: false,
        booking_id: null,
        confirmed_datetime: null,
        selected_datetime_utc: startUtc,
        config_status: "missing_property_address",
        request_summary: requestSummary,
        message_for_agent:
          "A property address is needed for this Cal.com event before booking. Do not confirm the appointment; save the request and say the team can confirm the address and time.",
      };
      await storeBookingRequest(input, result, result);
      return result;
    }

    const body: Record<string, unknown> = {
      start: startUtc,
      attendee: {
        name: input.caller_name,
        email: attendeeEmail,
        phoneNumber: normalizedPhone,
        timeZone: input.timezone,
        language: "en",
      },
      metadata: {
        source: "retell_pest_control_demo",
        caller_phone: normalizedPhone,
        alternate_phone: normalizedAlternate,
        pest_issue: input.pest_issue,
        property_address: serviceAddress,
        property_street: input.property_street ?? null,
        property_city: input.property_city ?? null,
        property_state: input.property_state ?? null,
        property_zip: input.property_zip ?? null,
      },
      location: {
        type: "address",
        address: serviceAddress,
      },
      bookingFieldsResponses: {
        name: input.caller_name,
        email: attendeeEmail,
        phone: normalizedPhone,
        alternatePhone: normalizedAlternate ?? "",
        pestIssue: input.pest_issue,
        propertyAddress: serviceAddress,
        propertyStreet: input.property_street ?? "",
        propertyCity: input.property_city ?? "",
        propertyState: input.property_state ?? "",
        propertyZip: input.property_zip ?? "",
        location: serviceAddress,
        notes: input.notes,
      },
    };
    if (this.config.eventTypeId) body.eventTypeId = Number(this.config.eventTypeId);
    if (this.config.username && this.config.eventSlug) {
      body.username = this.config.username;
      body.eventTypeSlug = this.config.eventSlug;
    }

    const response = await fetch("https://api.cal.com/v2/bookings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "cal-api-version": "2026-02-25",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as {
      status?: string;
      data?: { uid?: string; id?: number | string; start?: string };
    };
    const confirmed = response.ok && json.status === "success";
    const result = {
      success: response.ok,
      enabled: true,
      provider: "calcom" as const,
      confirmed,
      booking_id: confirmed ? String(json.data?.uid ?? json.data?.id ?? "") : null,
      confirmed_datetime: confirmed ? json.data?.start ?? startUtc : null,
      selected_datetime_utc: startUtc,
      config_status: this.config.source,
      request_summary: requestSummary,
      calcom_error: confirmed ? undefined : sanitizeCalComError(response.status, json),
      message_for_agent: confirmed
        ? "Cal.com confirmed the booking. You may confirm the appointment details."
        : "Cal.com did not confirm the booking. Do not promise the appointment; offer follow-up.",
    };
    await storeBookingRequest(input, result, json as Record<string, unknown>);
    return result;
  }
}

async function storeBookingRequest(
  input: BookAppointmentInput,
  result: BookingResult,
  providerResponse: Record<string, unknown> = {},
) {
  const insert = await insertRecord("booking_requests", {
    lead_id: input.lead_id ?? null,
    caller_name: input.caller_name,
    caller_phone: normalizeUSPhone(input.caller_phone),
    pest_issue: input.pest_issue,
    preferred_datetime: input.selected_datetime,
    confirmed_datetime: result.confirmed_datetime,
    booking_status: result.confirmed ? "confirmed" : "requested",
    calendar_provider: result.provider,
    provider_booking_id: result.booking_id,
    provider_response: providerResponse,
  });
  if (insert.error) console.error("Failed to persist booking request", { error: insert.error });
}

export function getCalendarAdapter(provider = env.CALENDAR_PROVIDER): CalendarAdapter {
  if (provider === "mock") return new MockCalendarAdapter();
  if (provider === "calcom") return new CalComCalendarAdapter();
  return new NoneCalendarAdapter();
}

export function getCandidateCalendarAdapter(): CalendarAdapter {
  return new CalComCalendarAdapter(candidateCalComConfigFromEnv().config);
}
