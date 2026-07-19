import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const testEnv = vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.OUTBOUND_ADMIN_TOKEN = "landing-backend-token";
  process.env.SUPABASE_URL = "";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "";
  return {};
});

const landingMocks = vi.hoisted(() => ({
  recordEvent: vi.fn(async (_input: unknown) => undefined),
  recordLead: vi.fn(async (_input: unknown) => ({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", duplicate: false })),
  dashboard: vi.fn(async () => ({ available: true, variants: [], totals: {}, diagnostics: {} })),
}));

vi.mock("../services/landingPages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/landingPages")>();
  return {
    ...actual,
    recordLandingEvent: landingMocks.recordEvent,
    recordLandingLead: landingMocks.recordLead,
    getLandingDashboard: landingMocks.dashboard,
  };
});

import { createApp } from "../app";
import { LandingStorageError } from "../services/landingPages";
import { resetLandingRateLimitsForTests } from "../routes/landingApi";

const app = createApp();
const ids = {
  session_id: "11111111-1111-4111-8111-111111111111",
  page_load_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  submission_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};
const headers = { "Content-Type": "application/json", "X-Elixis-Form": "landing-v1" };

function validLead() {
  return {
    ...ids,
    variant: "ready",
    route: "/ready/",
    interest: "full_receptionist",
    current_handling: "office_team",
    coverage_gap: "overflow",
    call_volume_band: "50_150",
    full_name: "Safe Test",
    business_name: "Example Pest",
    email: "safe@example.invalid",
    phone: "+12125550199",
    started_at: new Date(Date.now() - 3_000).toISOString(),
    website: "",
    is_test: true,
  };
}

describe("landing-page API routes", () => {
  afterEach(() => {
    vi.clearAllMocks();
    landingMocks.recordEvent.mockResolvedValue(undefined);
    landingMocks.recordLead.mockResolvedValue({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", duplicate: false });
    resetLandingRateLimitsForTests();
  });

  it("records a fixed non-PII event payload", async () => {
    const response = await request(app)
      .post("/api/landing/events")
      .set(headers)
      .send({
        ...ids,
        submission_id: null,
        event_name: "page_view",
        variant: "ready",
        route: "/ready/",
        metadata: { target: "demo" },
        is_test: true,
      });

    expect(response.status).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(landingMocks.recordEvent).toHaveBeenCalledOnce();
    expect(JSON.stringify(landingMocks.recordEvent.mock.calls[0][0])).not.toContain("user_agent");
    expect(JSON.stringify(landingMocks.recordEvent.mock.calls[0][0])).not.toContain("ip_address");
  });

  it("blocks cross-site requests and arbitrary event metadata", async () => {
    const blocked = await request(app)
      .post("/api/landing/events")
      .set(headers)
      .set("Sec-Fetch-Site", "cross-site")
      .send({});
    expect(blocked.status).toBe(403);

    const metadata = await request(app)
      .post("/api/landing/events")
      .set(headers)
      .send({
        ...ids,
        submission_id: null,
        event_name: "form_start",
        variant: "ready",
        route: "/ready/",
        metadata: { email: "do-not-store@example.com" },
      });
    expect(metadata.status).toBe(422);
    expect(landingMocks.recordEvent).not.toHaveBeenCalled();
  });

  it("persists a valid lead, rejects implausibly fast submissions, and absorbs honeypot spam", async () => {
    const success = await request(app).post("/api/landing/leads").set(headers).send(validLead());
    expect(success.status).toBe(201);
    expect(success.body).toMatchObject({ submitted: true, duplicate: false, booking_url: "/booking/" });
    expect(landingMocks.recordLead).toHaveBeenCalledOnce();

    const fast = await request(app)
      .post("/api/landing/leads")
      .set(headers)
      .send({ ...validLead(), started_at: new Date().toISOString(), submission_id: crypto.randomUUID() });
    expect(fast.status).toBe(422);

    const bot = await request(app)
      .post("/api/landing/leads")
      .set(headers)
      .send({ ...validLead(), website: "https://spam.example", submission_id: crypto.randomUUID() });
    expect(bot.status).toBe(202);
    expect(landingMocks.recordLead).toHaveBeenCalledTimes(1);
  });

  it("returns a safe fallback when lead storage is unavailable", async () => {
    landingMocks.recordLead.mockRejectedValueOnce(new LandingStorageError("private provider detail"));
    const response = await request(app).post("/api/landing/leads").set(headers).send(validLead());
    expect(response.status).toBe(503);
    expect(response.body.error).toContain("booking link");
    expect(JSON.stringify(response.body)).not.toContain("private provider detail");
  });

  it("keeps the landing dashboard behind unified backend authentication", async () => {
    const blocked = await request(app).get("/api/backend/landing-pages");
    expect(blocked.status).toBe(401);

    const login = await request(app).post("/api/backend/auth/login").send({ token: "landing-backend-token" });
    const cookies = Array.isArray(login.headers["set-cookie"])
      ? login.headers["set-cookie"]
      : [login.headers["set-cookie"]].filter(Boolean);
    const allowed = await request(app)
      .get("/api/backend/landing-pages?range=7&include_test=true")
      .set("Cookie", cookies);
    expect(allowed.status).toBe(200);
    expect(landingMocks.dashboard).toHaveBeenCalledWith(7, true);
  });
});
