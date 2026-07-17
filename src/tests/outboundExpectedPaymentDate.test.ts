import { describe, expect, it } from "vitest";

describe("outbound expected payment date resolution", () => {
  it("resolves exact, relative, and weekday dates from the trusted call time", async () => {
    const module = await import("../services/outboundExpectedPaymentDate").catch(() => ({}));
    expect(module).toHaveProperty("resolveOutboundExpectedPaymentDate");
    const resolveOutboundExpectedPaymentDate = (
      module as typeof import("../services/outboundExpectedPaymentDate")
    ).resolveOutboundExpectedPaymentDate;
    const input = {
      timezone: "America/New_York",
      referenceTime: new Date("2026-07-16T14:00:00.000Z"),
    };

    expect(resolveOutboundExpectedPaymentDate({ ...input, datePhrase: "2026-07-20" })).toMatchObject({
      ok: true,
      expectedPaymentDate: "2026-07-20",
      expectedPaymentDateSpoken: "July twentieth, twenty twenty-six",
    });
    expect(resolveOutboundExpectedPaymentDate({ ...input, datePhrase: "tomorrow" })).toMatchObject({
      ok: true,
      expectedPaymentDate: "2026-07-17",
      expectedPaymentDateSpoken: "July seventeenth, twenty twenty-six",
    });
    expect(resolveOutboundExpectedPaymentDate({ ...input, datePhrase: "Friday" })).toMatchObject({
      ok: true,
      expectedPaymentDate: "2026-07-17",
    });
    expect(resolveOutboundExpectedPaymentDate({ ...input, datePhrase: "July 20" })).toMatchObject({
      ok: true,
      expectedPaymentDate: "2026-07-20",
      expectedPaymentDateSpoken: "July twentieth, twenty twenty-six",
    });
    expect(resolveOutboundExpectedPaymentDate({ ...input, datePhrase: "next Friday" })).toMatchObject({
      ok: true,
      expectedPaymentDate: "2026-07-17",
    });
  });

  it("requires clarification for ambiguous or past expected-payment dates", async () => {
    const module = await import("../services/outboundExpectedPaymentDate").catch(() => ({}));
    expect(module).toHaveProperty("resolveOutboundExpectedPaymentDate");
    const resolveOutboundExpectedPaymentDate = (
      module as typeof import("../services/outboundExpectedPaymentDate")
    ).resolveOutboundExpectedPaymentDate;
    const input = {
      timezone: "America/New_York",
      referenceTime: new Date("2026-07-16T14:00:00.000Z"),
    };

    expect(resolveOutboundExpectedPaymentDate({ ...input, datePhrase: "soon" })).toMatchObject({
      ok: false,
      reason: "expected_payment_date_ambiguous",
    });
    expect(resolveOutboundExpectedPaymentDate({ ...input, datePhrase: "2026-07-15" })).toMatchObject({
      ok: false,
      reason: "expected_payment_date_in_past",
    });
  });
});
