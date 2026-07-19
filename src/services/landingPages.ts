import { parsePhoneNumberFromString } from "libphonenumber-js";
import { z } from "zod";
import { getSupabaseClient, isSupabaseConfigured } from "./supabase";

export const LANDING_VARIANTS = ["answer", "ready", "coverage"] as const;
export const LANDING_EVENT_NAMES = [
  "page_view",
  "form_start",
  "form_step_complete",
  "form_submit",
  "form_success",
  "form_error",
  "booking_click",
  "demo_click",
] as const;

export type LandingVariant = (typeof LANDING_VARIANTS)[number];
export type LandingEventName = (typeof LANDING_EVENT_NAMES)[number];

const routeByVariant: Record<LandingVariant, string> = {
  answer: "/answer/",
  ready: "/ready/",
  coverage: "/coverage/",
};

const optionalTrackingText = z
  .string()
  .trim()
  .max(160)
  .nullable()
  .optional()
  .default(null)
  .transform((value) => value || null);

const attributionSchema = {
  utm_source: optionalTrackingText,
  utm_medium: optionalTrackingText,
  utm_campaign: optionalTrackingText,
  utm_content: optionalTrackingText,
  utm_term: optionalTrackingText,
  referrer_host: z
    .string()
    .trim()
    .toLowerCase()
    .max(253)
    .nullable()
    .optional()
    .default(null)
    .transform((value) => value || null),
};

const eventMetadataSchema = z
  .object({
    target: z
      .enum(["hero_form", "nav_form", "booking", "demo", "form_next", "form_submit", "form_retry"])
      .optional(),
    step: z.number().int().min(1).max(2).optional(),
    error_code: z.enum(["validation", "network", "server", "storage"]).optional(),
  })
  .strict();

export const landingEventSchema = z
  .object({
    event_name: z.enum(LANDING_EVENT_NAMES),
    variant: z.enum(LANDING_VARIANTS),
    route: z.enum(["/answer/", "/ready/", "/coverage/"]),
    session_id: z.string().uuid(),
    page_load_id: z.string().uuid(),
    submission_id: z.string().uuid().nullable().optional().default(null),
    metadata: eventMetadataSchema.default({}),
    is_test: z.boolean().default(false),
    ...attributionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (routeByVariant[value.variant] !== value.route) {
      context.addIssue({ code: "custom", path: ["route"], message: "Route does not match variant" });
    }
  });

export const landingLeadSchema = z
  .object({
    variant: z.enum(LANDING_VARIANTS),
    route: z.enum(["/answer/", "/ready/", "/coverage/"]),
    session_id: z.string().uuid(),
    page_load_id: z.string().uuid(),
    submission_id: z.string().uuid(),
    interest: z.enum(["full_receptionist", "defined_coverage_gap", "explore_both"]),
    current_handling: z.enum(["owner_or_techs", "office_team", "answering_service", "voicemail_or_mix"]),
    coverage_gap: z.enum(["after_hours", "overflow", "lunch_weekends", "missed_or_unsure"]),
    call_volume_band: z.enum(["under_50", "50_150", "151_400", "400_plus", "unsure"]),
    full_name: z.string().trim().min(2).max(100),
    business_name: z.string().trim().min(2).max(140),
    email: z.string().trim().toLowerCase().email().max(200),
    phone: z.string().trim().min(7).max(30),
    started_at: z.string().datetime({ offset: true }),
    website: z.string().max(200).default(""),
    is_test: z.boolean().default(false),
    ...attributionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (routeByVariant[value.variant] !== value.route) {
      context.addIssue({ code: "custom", path: ["route"], message: "Route does not match variant" });
    }
  });

export type LandingEventInput = z.infer<typeof landingEventSchema>;
export type LandingLeadInput = z.infer<typeof landingLeadSchema>;

export class LandingStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LandingStorageError";
  }
}

function normalizedSource(input: {
  utm_source: string | null;
  referrer_host: string | null;
}): string {
  const source = input.utm_source || input.referrer_host?.replace(/^www\./, "") || "direct";
  return source.slice(0, 160).toLowerCase();
}

function normalizedPhone(input: string): string {
  const phone = parsePhoneNumberFromString(input, "US");
  if (!phone?.isValid()) {
    throw new Error("Enter a valid callback phone number");
  }
  return phone.number;
}

function landingClient() {
  const client = getSupabaseClient();
  if (!client) throw new LandingStorageError("Landing-page storage is not configured");
  return client;
}

function attributionRecord(input: LandingEventInput | LandingLeadInput) {
  return {
    source: normalizedSource(input),
    utm_source: input.utm_source,
    utm_medium: input.utm_medium,
    utm_campaign: input.utm_campaign,
    utm_content: input.utm_content,
    utm_term: input.utm_term,
    referrer_host: input.referrer_host,
  };
}

export async function recordLandingEvent(input: LandingEventInput): Promise<void> {
  const client = landingClient();
  const { error } = await client.from("landing_page_events").insert({
    event_name: input.event_name,
    variant: input.variant,
    route: input.route,
    session_id: input.session_id,
    page_load_id: input.page_load_id,
    submission_id: input.submission_id,
    metadata: input.metadata,
    is_test: input.is_test,
    ...attributionRecord(input),
  });

  if (error && error.code !== "23505") {
    throw new LandingStorageError(`Landing-page event write failed: ${error.message}`);
  }
}

export async function recordLandingLead(input: LandingLeadInput): Promise<{ id: string; duplicate: boolean }> {
  const client = landingClient();
  const phone = normalizedPhone(input.phone);
  const record = {
    variant: input.variant,
    route: input.route,
    session_id: input.session_id,
    page_load_id: input.page_load_id,
    submission_id: input.submission_id,
    interest: input.interest,
    current_handling: input.current_handling,
    coverage_gap: input.coverage_gap,
    call_volume_band: input.call_volume_band,
    full_name: input.full_name,
    business_name: input.business_name,
    email: input.email,
    phone,
    is_test: input.is_test || input.email.endsWith(".invalid"),
    ...attributionRecord(input),
  };

  const inserted = await client.from("landing_page_leads").insert(record).select("id").single();
  let leadId = String(inserted.data?.id ?? "");
  let duplicate = false;

  if (inserted.error?.code === "23505") {
    const existing = await client
      .from("landing_page_leads")
      .select("id")
      .eq("submission_id", input.submission_id)
      .maybeSingle();
    if (existing.error || !existing.data?.id) {
      throw new LandingStorageError("Landing-page lead idempotency check failed");
    }
    leadId = String(existing.data.id);
    duplicate = true;
  } else if (inserted.error || !leadId) {
    throw new LandingStorageError(`Landing-page lead write failed: ${inserted.error?.message || "missing id"}`);
  }

  try {
    await recordLandingEvent({
      event_name: "form_success",
      variant: input.variant,
      route: input.route,
      session_id: input.session_id,
      page_load_id: input.page_load_id,
      submission_id: input.submission_id,
      metadata: { target: "form_submit", step: 2 },
      is_test: record.is_test,
      utm_source: input.utm_source,
      utm_medium: input.utm_medium,
      utm_campaign: input.utm_campaign,
      utm_content: input.utm_content,
      utm_term: input.utm_term,
      referrer_host: input.referrer_host,
    });
  } catch (error) {
    console.error("Landing-page lead persisted but success event did not", {
      submission_id: input.submission_id,
      error: error instanceof Error ? error.message : "unknown error",
    });
  }

  return { id: leadId, duplicate };
}

type LandingEventRow = {
  id: string;
  created_at: string;
  event_name: LandingEventName;
  variant: LandingVariant;
  route: string;
  session_id: string;
  submission_id: string | null;
  source: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  referrer_host: string | null;
  metadata: Record<string, unknown> | null;
  is_test: boolean;
};

type LandingLeadRow = {
  id: string;
  created_at: string;
  variant: LandingVariant;
  route: string;
  session_id: string;
  submission_id: string;
  interest: string;
  current_handling: string;
  coverage_gap: string;
  call_volume_band: string;
  full_name: string;
  business_name: string;
  email: string;
  phone: string;
  source: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  referrer_host: string | null;
  status: string;
  is_test: boolean;
};

function percentage(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function emptyVariant(variant: LandingVariant) {
  return {
    variant,
    route: routeByVariant[variant],
    page_views: 0,
    unique_sessions: 0,
    form_starts: 0,
    submissions: 0,
    booking_clicks: 0,
    demo_clicks: 0,
    view_to_submit_rate: null as number | null,
    start_to_submit_rate: null as number | null,
    booking_click_rate: null as number | null,
  };
}

export function buildLandingDashboard(
  allEvents: LandingEventRow[],
  allLeads: LandingLeadRow[],
  options: {
    rangeDays: number;
    includeTest: boolean;
    eventsError?: string | null;
    leadsError?: string | null;
    eventCap?: number;
    leadCap?: number;
  },
) {
  const testEvents = allEvents.filter((event) => event.is_test).length;
  const testLeads = allLeads.filter((lead) => lead.is_test).length;
  const events = options.includeTest ? allEvents : allEvents.filter((event) => !event.is_test);
  const leads = options.includeTest ? allLeads : allLeads.filter((lead) => !lead.is_test);

  const variants = LANDING_VARIANTS.map((variant) => {
    const variantEvents = events.filter((event) => event.variant === variant);
    const pageViews = variantEvents.filter((event) => event.event_name === "page_view");
    const formStarts = variantEvents.filter((event) => event.event_name === "form_start").length;
    const submissions = leads.filter((lead) => lead.variant === variant).length;
    const bookingClicks = variantEvents.filter((event) => event.event_name === "booking_click").length;
    const demoClicks = variantEvents.filter((event) => event.event_name === "demo_click").length;

    return {
      ...emptyVariant(variant),
      page_views: pageViews.length,
      unique_sessions: new Set(pageViews.map((event) => event.session_id)).size,
      form_starts: formStarts,
      submissions,
      booking_clicks: bookingClicks,
      demo_clicks: demoClicks,
      view_to_submit_rate: percentage(submissions, pageViews.length),
      start_to_submit_rate: percentage(submissions, formStarts),
      booking_click_rate: percentage(bookingClicks, pageViews.length),
    };
  });

  type SourceRow = {
    source: string;
    medium: string;
    campaign: string;
    page_views: number;
    submissions: number;
  };
  const sourceMap = new Map<string, SourceRow>();
  const sourceRow = (item: LandingEventRow | LandingLeadRow) => {
    const source = item.source || "direct";
    const medium = item.utm_medium || "—";
    const campaign = item.utm_campaign || "—";
    const key = `${source}\u0000${medium}\u0000${campaign}`;
    if (!sourceMap.has(key)) sourceMap.set(key, { source, medium, campaign, page_views: 0, submissions: 0 });
    return sourceMap.get(key)!;
  };
  events
    .filter((event) => event.event_name === "page_view")
    .forEach((event) => {
      sourceRow(event).page_views += 1;
    });
  leads.forEach((lead) => {
    sourceRow(lead).submissions += 1;
  });

  const eventCounts = Object.fromEntries(
    LANDING_EVENT_NAMES.map((eventName) => [
      eventName,
      events.filter((event) => event.event_name === eventName).length,
    ]),
  );
  const pageViews = eventCounts.page_view ?? 0;
  const missingUtmViews = events.filter(
    (event) => event.event_name === "page_view" && !event.utm_source && !event.utm_medium && !event.utm_campaign,
  ).length;
  const latestEventAt = events[0]?.created_at ?? null;
  const latestLeadAt = leads[0]?.created_at ?? null;

  return {
    available: !options.eventsError && !options.leadsError,
    checked_at: new Date().toISOString(),
    range_days: options.rangeDays,
    include_test: options.includeTest,
    variants,
    totals: {
      page_views: variants.reduce((sum, item) => sum + item.page_views, 0),
      unique_session_estimates: new Set(
        events.filter((event) => event.event_name === "page_view").map((event) => event.session_id),
      ).size,
      form_starts: variants.reduce((sum, item) => sum + item.form_starts, 0),
      submissions: leads.length,
      booking_clicks: variants.reduce((sum, item) => sum + item.booking_clicks, 0),
      demo_clicks: variants.reduce((sum, item) => sum + item.demo_clicks, 0),
      view_to_submit_rate: percentage(leads.length, pageViews),
    },
    sources: [...sourceMap.values()].sort(
      (left, right) => right.submissions - left.submissions || right.page_views - left.page_views,
    ),
    recent_events: events.slice(0, 40),
    recent_leads: leads.slice(0, 30),
    diagnostics: {
      supabase_configured: isSupabaseConfigured(),
      events_table_reachable: !options.eventsError,
      leads_table_reachable: !options.leadsError,
      events_error: options.eventsError || null,
      leads_error: options.leadsError || null,
      latest_event_at: latestEventAt,
      latest_lead_at: latestLeadAt,
      event_counts: eventCounts,
      successful_event_lead_delta: (eventCounts.form_success ?? 0) - leads.length,
      missing_utm_page_view_rate: percentage(missingUtmViews, pageViews),
      test_events_excluded: options.includeTest ? 0 : testEvents,
      test_leads_excluded: options.includeTest ? 0 : testLeads,
      event_data_cap_reached: allEvents.length >= (options.eventCap ?? 10_000),
      lead_data_cap_reached: allLeads.length >= (options.leadCap ?? 5_000),
      privacy: {
        cookies: "none",
        session_estimate: "random UUID in sessionStorage",
        fingerprinting: "none",
        raw_ip_stored: false,
        user_agent_stored: false,
        fbclid_stored: false,
        privacy_signal_behavior: "nonessential events are skipped; submitted lead requests still persist",
      },
    },
  };
}

export async function getLandingDashboard(rangeDays = 30, includeTest = false) {
  const client = getSupabaseClient();
  if (!client) {
    return buildLandingDashboard([], [], {
      rangeDays,
      includeTest,
      eventsError: "Supabase is not configured",
      leadsError: "Supabase is not configured",
    });
  }

  const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString();
  const [eventsResult, leadsResult] = await Promise.all([
    client
      .from("landing_page_events")
      .select(
        "id,created_at,event_name,variant,route,session_id,submission_id,source,utm_source,utm_medium,utm_campaign,utm_content,utm_term,referrer_host,metadata,is_test",
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(10_000),
    client
      .from("landing_page_leads")
      .select(
        "id,created_at,variant,route,session_id,submission_id,interest,current_handling,coverage_gap,call_volume_band,full_name,business_name,email,phone,source,utm_source,utm_medium,utm_campaign,utm_content,utm_term,referrer_host,status,is_test",
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5_000),
  ]);

  return buildLandingDashboard(
    (eventsResult.data ?? []) as unknown as LandingEventRow[],
    (leadsResult.data ?? []) as unknown as LandingLeadRow[],
    {
      rangeDays,
      includeTest,
      eventsError: eventsResult.error?.message,
      leadsError: leadsResult.error?.message,
    },
  );
}
