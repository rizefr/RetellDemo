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
    ["/answer/", "A pest receptionist that knows what happens next"],
    ["/nevermiss/", "You can’t answer from a crawl space"],
    ["/pestline/", "Built around pest calls"],
    ["/hear/", "Put the receptionist through a pest call"],
  ])("serves %s with its current page content", async (path, expectedText) => {
    const response = await request(app).get(path);

    expect(response.status).toBe(200);
    expect(response.text).toContain(expectedText);
  });

  it.each([
    ["/answer/", "answer", "/answer/"],
    ["/nevermiss/", "nevermiss", "/nevermiss/"],
    ["/pestline/", "pestline", "/pestline/"],
  ])("serves an accessible, noindex experiment shell at %s", async (path, variant, route) => {
    const response = await request(app).get(path);
    const h1Count = response.text.match(/<h1(?:\s|>)/g)?.length ?? 0;

    expect(response.status).toBe(200);
    expect(h1Count).toBe(1);
    expect(response.text).toContain('name="robots" content="noindex,nofollow,noarchive"');
    expect(response.text).toContain(`data-variant="${variant}"`);
    expect(response.text).toContain(`data-route="${route}"`);
    expect(response.text).toContain("data-lead-form");
    expect(response.text).toContain('autocomplete="organization"');
    expect(response.text).not.toContain('href="/"');
    expect(response.text).not.toContain("Every Call Answered. Every Lead Captured.");
    expect(response.text).not.toContain("a fraction of");
  });

  it("serves the noindex demonstration funnel without a lead form or escape navigation", async () => {
    const response = await request(app).get("/hear/");

    expect(response.status).toBe(200);
    expect(response.text).toContain('data-variant="hear"');
    expect(response.text).toContain('data-live-demo');
    expect(response.text).not.toContain("data-lead-form");
    expect(response.text).not.toContain('href="/"');
  });

  it.each([
    ["answer.elixis.agency", "answer", "A pest receptionist that knows what happens next"],
    ["nevermiss.elixis.agency", "nevermiss", "You can’t answer from a crawl space"],
    ["pestline.elixis.agency", "pestline", "Built around pest calls"],
    ["hear.elixis.agency", "hear", "Put the receptionist through a pest call"],
  ])("maps the exact experiment host %s to its root funnel", async (host, variant, expectedText) => {
    const response = await request(app).get("/").set("Host", host);

    expect(response.status).toBe(200);
    expect(response.headers["x-robots-tag"]).toContain("noindex");
    expect(response.text).toContain(`data-variant="${variant}"`);
    expect(response.text).toContain(expectedText);
  });

  it("does not let an untrusted forwarded host select an experiment", async () => {
    const response = await request(app)
      .get("/")
      .set("Host", "elixis.agency")
      .set("X-Forwarded-Host", "hear.elixis.agency");

    expect(response.status).toBe(200);
    expect(response.text).not.toContain('data-variant="hear"');
  });

  it("keeps preview plumbing paths private in Vercel Production while exact hosts remain routable", async () => {
    const priorVercelEnv = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "production";

    try {
      const [answerPath, hearPath, answerHost] = await Promise.all([
        request(app).get("/answer/"),
        request(app).get("/hear/"),
        request(app).get("/").set("Host", "answer.elixis.agency"),
      ]);

      expect(answerPath.status).toBe(404);
      expect(hearPath.status).toBe(404);
      expect(answerHost.status).toBe(200);
      expect(answerHost.text).toContain('data-variant="answer"');
    } finally {
      if (priorVercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = priorVercelEnv;
    }
  });

  it.each(["/ready/", "/coverage/"])("returns 404 for superseded preview route %s", async (path) => {
    const response = await request(app).get(path);
    expect(response.status).toBe(404);
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
    ["/lp/landing.css?v=20260725", "text/css"],
    ["/lp/landing.js?v=20260725", "text/javascript"],
  ])("serves %s directly as a versioned static asset", async (path, contentType) => {
    const response = await request(app).get(path);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain(contentType);
  });

  it("does not broadly exclude the four preview page directories from Vercel bundles", () => {
    const ignoreRules = fs
      .readFileSync(path.resolve(process.cwd(), ".vercelignore"), "utf8")
      .split("\n")
      .map((rule) => rule.trim())
      .filter(Boolean);

    expect(ignoreRules).not.toContain("answer/");
    expect(ignoreRules).not.toContain("nevermiss/");
    expect(ignoreRules).not.toContain("pestline/");
    expect(ignoreRules).not.toContain("hear/");
  });
});
