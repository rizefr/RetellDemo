import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { sign } from "retell-sdk";

describe("Retell webhook verification", () => {
  it("rejects invalid signatures and does not store as trusted", async () => {
    vi.resetModules();
    process.env.RETELL_WEBHOOK_SECRET_OR_API_KEY = "test_secret";
    process.env.ALLOW_UNVERIFIED_WEBHOOKS = "false";
    const { createApp } = await import("../app");

    const response = await request(createApp())
      .post("/retell/webhook")
      .set("Content-Type", "application/json")
      .set("X-Retell-Signature", "bad")
      .send(JSON.stringify({ event: "call_started", call: { call_id: "call_1" } }));

    expect(response.status).toBe(401);
  });

  it("accepts a valid Retell signature over the raw request body", async () => {
    vi.resetModules();
    process.env.RETELL_WEBHOOK_SECRET_OR_API_KEY = "test_secret";
    process.env.ALLOW_UNVERIFIED_WEBHOOKS = "false";
    const { createApp } = await import("../app");
    const rawBody = JSON.stringify({ event: "call_started", call: { call_id: "call_1" } });
    const signature = await sign(rawBody, "test_secret");

    const response = await request(createApp())
      .post("/retell/webhook")
      .set("Content-Type", "application/json")
      .set("X-Retell-Signature", signature)
      .send(rawBody);

    expect(response.status).toBe(200);
    expect(response.body.received).toBe(true);
    expect(response.body.event_type).toBe("call_started");
  });
});
