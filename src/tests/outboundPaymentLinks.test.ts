import { afterEach, describe, expect, it, vi } from "vitest";

describe("outbound payment session lifecycle", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("expires stale open sessions before a replacement can be created", async () => {
    const lte = vi.fn().mockResolvedValue({ data: null, error: null });
    const builder = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lte,
    };
    vi.doMock("../services/supabase", () => ({
      getSupabaseClient: () => ({ from: vi.fn().mockReturnValue(builder) }),
    }));
    const { expireStaleOutboundPaymentLinks } = await import("../services/outboundRepository");
    const now = new Date("2026-06-18T12:00:00.000Z");

    await expireStaleOutboundPaymentLinks("00000000-0000-4000-8000-000000000001", now);

    expect(builder.update).toHaveBeenCalledWith({ status: "expired" });
    expect(builder.eq).toHaveBeenNthCalledWith(1, "invoice_id", "00000000-0000-4000-8000-000000000001");
    expect(builder.eq).toHaveBeenNthCalledWith(2, "status", "open");
    expect(lte).toHaveBeenCalledWith("expires_at", "2026-06-18T12:00:00.000Z");
  });
});
