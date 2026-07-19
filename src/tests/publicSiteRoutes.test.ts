import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";

const app = createApp();

describe("public site routes", () => {
  it.each(["/ai-seo", "/ai-seo/"])("permanently redirects %s to the homepage", async (path) => {
    const response = await request(app).get(path);

    expect(response.status).toBe(301);
    expect(response.headers.location).toBe("/");
  });

  it.each([
    ["/", "Your Unpaid Invoices Never Get"],
    ["/collections/", "Elixis Collect"],
    ["/demo/", "Every Call Answered. Every Lead Captured."],
    ["/booking/", "Start with an AI Audit"],
    ["/about/", "Elijah Raykhman"],
    ["/answer/", "Pest-control calls don’t wait for office hours"],
    ["/ready/", "make it answer to your standards"],
    ["/coverage/", "Give every coverage gap a clear next step"],
  ])("serves %s with its current page content", async (path, expectedText) => {
    const response = await request(app).get(path);

    expect(response.status).toBe(200);
    expect(response.text).toContain(expectedText);
  });

  it.each([
    ["/answer/", "answer", "/answer/"],
    ["/ready/", "ready", "/ready/"],
    ["/coverage/", "coverage", "/coverage/"],
  ])("serves an accessible, noindex experiment shell at %s", async (path, variant, route) => {
    const response = await request(app).get(path);
    const h1Count = response.text.match(/<h1(?:\s|>)/g)?.length ?? 0;

    expect(response.status).toBe(200);
    expect(h1Count).toBe(1);
    expect(response.text).toContain('name="robots" content="noindex,follow,noarchive"');
    expect(response.text).toContain(`data-variant="${variant}"`);
    expect(response.text).toContain(`data-route="${route}"`);
    expect(response.text).toContain("data-lead-form");
    expect(response.text).toContain('autocomplete="organization"');
    expect(response.text).toContain('href="/"');
    expect(response.text).not.toContain("Every Call Answered. Every Lead Captured.");
    expect(response.text).not.toContain("a fraction of");
  });

  it("keeps the founder page to a single semantic H1", async () => {
    const response = await request(app).get("/about/");
    const h1Count = response.text.match(/<h1(?:\s|>)/g)?.length ?? 0;

    expect(h1Count).toBe(1);
  });

  it("places the booking calendar before the clarification section and removes the old audit cards", async () => {
    const response = await request(app).get("/booking/");
    const calendarIndex = response.text.indexOf('id="cal-inline"');
    const clarificationIndex = response.text.indexOf("What we will clarify");

    expect(calendarIndex).toBeGreaterThan(-1);
    expect(clarificationIndex).toBeGreaterThan(calendarIndex);
    expect(response.text).not.toContain("Find the workflow with the clearest payoff");
    expect(response.text).not.toContain("Define what stays human");
    expect(response.text).not.toContain("Pressure-test fit, cost, and complexity");
  });

  it("keeps gated pages protected while public pages remain available", async () => {
    const [backend, inbound, outbound] = await Promise.all([
      request(app).get("/backend"),
      request(app).get("/inbound"),
      request(app).get("/outbound"),
    ]);

    expect(backend.status).toBe(401);
    expect(inbound.status).toBe(401);
    expect(outbound.status).toBe(401);
  });

  it.each([
    ["/backend/backend.css?v=20260710", "text/css"],
    ["/backend/backend.js?v=20260710", "text/javascript"],
    ["/inbound/inbound.css?v=20260710", "text/css"],
    ["/inbound/inbound.js?v=20260710", "text/javascript"],
    ["/outbound/outbound.css?v=20260710", "text/css"],
    ["/outbound/outbound.js?v=20260710", "text/javascript"],
    ["/lp/landing.css?v=20260719", "text/css"],
    ["/lp/landing.js?v=20260719", "text/javascript"],
  ])("serves %s directly as a versioned static asset", async (path, contentType) => {
    const response = await request(app).get(path);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain(contentType);
  });

  it("keeps the public coverage route in Vercel deployment bundles", () => {
    const ignoreRules = fs
      .readFileSync(path.resolve(process.cwd(), ".vercelignore"), "utf8")
      .split("\n")
      .map((rule) => rule.trim())
      .filter(Boolean);

    expect(ignoreRules).toContain("/coverage/");
    expect(ignoreRules).not.toContain("coverage/");
  });
});
