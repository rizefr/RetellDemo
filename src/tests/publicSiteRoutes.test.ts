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
  ])("serves %s with its current page content", async (path, expectedText) => {
    const response = await request(app).get(path);

    expect(response.status).toBe(200);
    expect(response.text).toContain(expectedText);
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

  it("caches versioned static bundles without applying long-lived caching to HTML", async () => {
    const [styles, script, homepage] = await Promise.all([
      request(app).get("/styles.css?v=elixis-performance-20260709"),
      request(app).get("/site.js?v=elixis-performance-20260709"),
      request(app).get("/"),
    ]);

    expect(styles.headers["cache-control"]).toBe("public, max-age=604800, stale-while-revalidate=86400");
    expect(script.headers["cache-control"]).toBe("public, max-age=604800, stale-while-revalidate=86400");
    expect(homepage.headers["cache-control"]).not.toContain("max-age=604800");
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
});
