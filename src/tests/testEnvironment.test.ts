import { afterEach, describe, expect, it, vi } from "vitest";

describe("test environment isolation", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) delete process.env[key];
    });
    Object.assign(process.env, originalEnv);
    vi.resetModules();
  });

  it("does not load provider credentials from .env while running tests", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.RETELL_API_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    vi.resetModules();

    const { env } = await import("../config/env");

    expect(env.SUPABASE_URL).toBe("");
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe("");
    expect(env.RETELL_API_KEY).toBe("");
    expect((env as unknown as { STRIPE_SECRET_KEY?: string }).STRIPE_SECRET_KEY ?? "").toBe("");
  });
});
