import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const testEnv = vi.hoisted(() => {
  const token = "backend-route-token";
  process.env.NODE_ENV = "test";
  process.env.OUTBOUND_ADMIN_TOKEN = token;
  process.env.INBOUND_ADMIN_TOKEN = "inbound-route-token";
  process.env.RETELL_API_KEY = "";
  process.env.SUPABASE_URL = "";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "super-secret-service-role";
  process.env.STRIPE_SECRET_KEY = "sk_test_secret_status";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_secret_status";
  process.env.GOOGLE_SHEET_ID = "sheet-secret-status";
  process.env.QUICKBOOKS_CLIENT_SECRET = "quickbooks-secret-status";
  process.env.APP_BASE_URL = "";
  process.env.PRODUCTION_BASE_URL = "";
  return { token };
});

import { createApp } from "../app";

const app = createApp();

function responseCookies(response: request.Response): string[] {
  const cookies = response.headers["set-cookie"];
  return Array.isArray(cookies) ? cookies : [cookies].filter(Boolean);
}

describe("unified backend routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires login, exchanges the outbound token for backend and outbound HttpOnly cookies, and loads the shell", async () => {
    const blocked = await request(app).get("/backend");
    expect(blocked.status).toBe(401);
    expect(blocked.text).toContain("Unified backend");
    expect(blocked.text).not.toContain(testEnv.token);

    const missing = await request(app).post("/api/backend/auth/login").send({ token: "" });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("Missing admin token");

    const wrong = await request(app).post("/api/backend/auth/login").send({ token: "wrong" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBe("Wrong admin token");

    const login = await request(app).post("/api/backend/auth/login").send({ token: testEnv.token });
    const loginCookies = responseCookies(login);
    expect(login.status).toBe(200);
    expect(loginCookies.join("\n")).toContain("backend_admin=");
    expect(loginCookies.join("\n")).toContain("outbound_admin=");
    expect(loginCookies.join("\n")).toContain("HttpOnly");

    const page = await request(app).get("/backend").set("Cookie", loginCookies);
    expect(page.status).toBe(200);
    expect(page.text).toContain("Outbound Collections");
    expect(page.text).toContain("Inbound Receptionist");
    expect(page.text).toContain("Landing Pages");

    const legacyOutbound = await request(app).get("/outbound").set("Cookie", loginCookies);
    expect(legacyOutbound.status).toBe(200);
    expect(legacyOutbound.text).toContain("Customers and invoices");
  });

  it("reports session and protected navigation without exposing the admin token", async () => {
    const anonymousSession = await request(app).get("/api/backend/session");
    expect(anonymousSession.status).toBe(200);
    expect(anonymousSession.body).toMatchObject({
      authenticated: false,
      token_configured: true,
      reason: "missing_credentials",
    });

    const login = await request(app).post("/api/backend/auth/login").send({ token: testEnv.token });
    const loginCookies = responseCookies(login);
    const session = await request(app).get("/api/backend/session").set("Cookie", loginCookies);
    expect(session.body).toMatchObject({ authenticated: true, reason: "authenticated" });
    expect(JSON.stringify(session.body)).not.toContain(testEnv.token);

    const nav = await request(app).get("/api/backend/navigation").set("Cookie", loginCookies);
    expect(nav.status).toBe(200);
    expect(nav.body.sections.map((item: { id: string }) => item.id)).toEqual([
      "overview",
      "outbound",
      "inbound",
      "landing-pages",
      "settings",
      "docs",
    ]);
    expect(nav.body.docs[0].href).toBe("/backend/docs/README_backend.md");

    const doc = await request(app).get("/backend/docs/README_backend.md").set("Cookie", loginCookies);
    expect(doc.status).toBe(200);
    expect(doc.text).toContain("# Unified Backend");
  });

  it("returns redacted backend status and keeps legacy inbound auth behavior separate", async () => {
    const blockedStatus = await request(app).get("/api/backend/status");
    expect(blockedStatus.status).toBe(401);

    const login = await request(app).post("/api/backend/auth/login").send({ token: testEnv.token });
    const loginCookies = responseCookies(login);
    const status = await request(app).get("/api/backend/status").set("Cookie", loginCookies);
    expect(status.status).toBe(200);
    expect(status.body.auth.backend_uses).toBe("OUTBOUND_ADMIN_TOKEN");
    expect(status.body.navigation.sections.some((item: { id: string }) => item.id === "inbound")).toBe(true);

    const body = JSON.stringify(status.body);
    expect(body).not.toContain(testEnv.token);
    expect(body).not.toContain("inbound-route-token");
    expect(body).not.toContain("super-secret-service-role");
    expect(body).not.toContain("sk_test_secret_status");
    expect(body).not.toContain("whsec_secret_status");
    expect(body).not.toContain("sheet-secret-status");
    expect(body).not.toContain("quickbooks-secret-status");

    const blockedInbound = await request(app).get("/inbound").set("Cookie", loginCookies);
    expect(blockedInbound.status).toBe(401);
    expect(blockedInbound.text).toContain("Inbound Admin Login");
  });
});
