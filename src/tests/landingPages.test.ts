import { describe, expect, it } from "vitest";
import {
  buildLandingDashboard,
  landingEventSchema,
  landingLeadSchema,
} from "../services/landingPages";

const sessionOne = "11111111-1111-4111-8111-111111111111";
const sessionTwo = "22222222-2222-4222-8222-222222222222";
const pageOne = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const submissionOne = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    created_at: "2026-07-19T12:00:00.000Z",
    event_name: "page_view",
    variant: "ready",
    route: "/ready/",
    session_id: sessionOne,
    page_load_id: pageOne,
    submission_id: null,
    source: "facebook",
    utm_source: "facebook",
    utm_medium: "paid_social",
    utm_campaign: "pest_test_call",
    utm_content: null,
    utm_term: null,
    referrer_host: "facebook.com",
    metadata: {},
    is_test: false,
    ...overrides,
  };
}

function lead(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    created_at: "2026-07-19T12:05:00.000Z",
    variant: "ready",
    route: "/ready/",
    session_id: sessionOne,
    submission_id: submissionOne,
    interest: "full_receptionist",
    current_handling: "office_team",
    coverage_gap: "overflow",
    call_volume_band: "50_150",
    full_name: "Safe Test",
    business_name: "Example Pest",
    email: "safe@example.invalid",
    phone: "+12125550199",
    source: "facebook",
    utm_source: "facebook",
    utm_medium: "paid_social",
    utm_campaign: "pest_test_call",
    utm_content: null,
    utm_term: null,
    referrer_host: "facebook.com",
    status: "new",
    is_test: false,
    ...overrides,
  };
}

describe("landing-page analytics", () => {
  it("aggregates variant, session, funnel, booking, and source metrics", () => {
    const events = [
      event(),
      event({ id: crypto.randomUUID(), session_id: sessionTwo }),
      event({ id: crypto.randomUUID(), event_name: "form_start" }),
      event({ id: crypto.randomUUID(), event_name: "form_success", submission_id: submissionOne }),
      event({ id: crypto.randomUUID(), event_name: "booking_click" }),
      event({ id: crypto.randomUUID(), event_name: "demo_click" }),
    ];
    const dashboard = buildLandingDashboard(events as any, [lead()] as any, {
      rangeDays: 30,
      includeTest: false,
    });

    const ready = dashboard.variants.find((item) => item.variant === "ready");
    expect(ready).toMatchObject({
      route: "/ready/",
      page_views: 2,
      unique_sessions: 2,
      form_starts: 1,
      submissions: 1,
      booking_clicks: 1,
      demo_clicks: 1,
      view_to_submit_rate: 50,
      start_to_submit_rate: 100,
    });
    expect(dashboard.totals).toMatchObject({ page_views: 2, unique_session_estimates: 2, submissions: 1 });
    expect(dashboard.sources[0]).toMatchObject({
      source: "facebook",
      medium: "paid_social",
      campaign: "pest_test_call",
      page_views: 2,
      submissions: 1,
    });
    expect(dashboard.diagnostics.successful_event_lead_delta).toBe(0);
    expect(dashboard.diagnostics.privacy).toMatchObject({
      cookies: "none",
      fingerprinting: "none",
      raw_ip_stored: false,
      user_agent_stored: false,
      fbclid_stored: false,
    });
  });

  it("excludes flagged test rows by default and can include them explicitly", () => {
    const events = [event({ is_test: true })];
    const leads = [lead({ is_test: true })];
    const withoutTests = buildLandingDashboard(events as any, leads as any, {
      rangeDays: 7,
      includeTest: false,
    });
    const withTests = buildLandingDashboard(events as any, leads as any, {
      rangeDays: 7,
      includeTest: true,
    });

    expect(withoutTests.totals.page_views).toBe(0);
    expect(withoutTests.totals.submissions).toBe(0);
    expect(withoutTests.diagnostics.test_events_excluded).toBe(1);
    expect(withoutTests.diagnostics.test_leads_excluded).toBe(1);
    expect(withTests.totals.page_views).toBe(1);
    expect(withTests.totals.submissions).toBe(1);
  });

  it("accepts only fixed route/variant pairs and non-PII event metadata", () => {
    const valid = landingEventSchema.safeParse({
      event_name: "page_view",
      variant: "ready",
      route: "/ready/",
      session_id: sessionOne,
      page_load_id: pageOne,
      metadata: { target: "demo" },
    });
    const mismatched = landingEventSchema.safeParse({
      event_name: "page_view",
      variant: "ready",
      route: "/answer/",
      session_id: sessionOne,
      page_load_id: pageOne,
      metadata: {},
    });
    const piiMetadata = landingEventSchema.safeParse({
      event_name: "form_start",
      variant: "ready",
      route: "/ready/",
      session_id: sessionOne,
      page_load_id: pageOne,
      metadata: { email: "should-not-store@example.com" },
    });

    expect(valid.success).toBe(true);
    expect(mismatched.success).toBe(false);
    expect(piiMetadata.success).toBe(false);
  });

  it("validates the minimum lead qualification and contact shape", () => {
    const parsed = landingLeadSchema.safeParse({
      variant: "coverage",
      route: "/coverage/",
      session_id: sessionOne,
      page_load_id: pageOne,
      submission_id: submissionOne,
      interest: "defined_coverage_gap",
      current_handling: "office_team",
      coverage_gap: "after_hours",
      call_volume_band: "50_150",
      full_name: "Morgan Owner",
      business_name: "Morgan Pest Control",
      email: "morgan@example.com",
      phone: "+12125550199",
      started_at: "2026-07-19T12:00:00.000Z",
      website: "",
    });
    expect(parsed.success).toBe(true);
  });
});
