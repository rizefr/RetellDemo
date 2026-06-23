import { describe, expect, it } from "vitest";
import {
  formatOutboundDate,
  formatOutboundInvoiceCountSpoken,
  formatOutboundInvoiceIdSpoken,
  formatOutboundMoneySpoken,
  formatOutboundPhoneSpoken,
  normalizeOutboundDate,
} from "../services/outboundFormatting";
import { resolveOutboundCallback } from "../services/outboundCallbacks";
import {
  PRODUCTION_MODE_CONFIRMATION,
  BATCH_LIMIT_CONFIRMATION,
  validateOutboundBusinessSettingsPatch,
} from "../services/outboundBusinessSettings";
import { parseOutboundCsv } from "../services/outboundCsv";
import { businessCsvTemplate, customerCsvTemplate } from "../services/outboundTemplates";
import { parseOutboundBusinessCsv } from "../services/outboundBusinessCsv";
import { outboundAiDisclosureInstruction } from "../services/outboundCalls";

describe("outbound natural date formatting", () => {
  it("normalizes compact and ISO dates without changing the calendar day", () => {
    expect(normalizeOutboundDate("20260520")).toBe("2026-05-20");
    expect(normalizeOutboundDate("2026-05-20")).toBe("2026-05-20");
    expect(formatOutboundDate("20260520")).toBe("May 20, 2026");
    expect(formatOutboundDate("2026-05-20")).toBe("May 20, 2026");
  });

  it("returns an explicit fallback for invalid dates", () => {
    expect(normalizeOutboundDate("20261340")).toBeNull();
    expect(formatOutboundDate("not-a-date")).toBe("Date unavailable");
  });
});

describe("outbound speech-safe invoice formatting", () => {
  it("spells dollar and cent amounts without exposing symbols or cents storage", () => {
    expect(formatOutboundMoneySpoken(15000, "usd")).toBe("one hundred fifty dollars");
    expect(formatOutboundMoneySpoken(15025, "usd")).toBe("one hundred fifty dollars and twenty-five cents");
    expect(formatOutboundMoneySpoken(124050, "usd")).toBe(
      "one thousand two hundred forty dollars and fifty cents",
    );
  });

  it("separates invoice identifiers from payment amounts", () => {
    expect(formatOutboundInvoiceIdSpoken("ELV-2026-002")).toBe("invoice E-L-V, two zero two six, zero zero two");
    expect(formatOutboundInvoiceIdSpoken("ELV-TEST-OWN-NUMBER")).toBe(
      "invoice E-L-V, test, own, number",
    );
  });

  it("uses natural singular and plural open-invoice counts", () => {
    expect(formatOutboundInvoiceCountSpoken(1)).toBe("one open invoice");
    expect(formatOutboundInvoiceCountSpoken(3)).toBe("three open invoices");
  });

  it("formats phone numbers for spoken confirmation", () => {
    expect(formatOutboundPhoneSpoken("+13475850249")).toBe("plus one, three four seven, five eight five, zero two four nine");
  });
});

describe("outbound AI disclosure instruction", () => {
  it("turns each configured policy into one unambiguous per-call instruction", () => {
    expect(outboundAiDisclosureInstruction("on_request")).toContain("Do not mention or volunteer AI status");
    expect(outboundAiDisclosureInstruction("opening")).toContain("near the opening");
    expect(outboundAiDisclosureInstruction("after_identity")).toContain("after the elevator operation check");
    expect(outboundAiDisclosureInstruction("after_identity")).toContain("only once");
    expect(outboundAiDisclosureInstruction("after_identity")).toContain("virtual assistant");
    expect(outboundAiDisclosureInstruction("after_identity")).not.toContain("AI assistant helping Elixis Elevator Systems follow up on service accounts. Then continue");
  });
});

describe("outbound callback resolution", () => {
  const base = {
    timezone: "America/New_York",
    referenceTime: new Date("2026-06-22T15:00:00.000Z"),
  };

  it("resolves tomorrow afternoon and returns a spoken confirmation", () => {
    expect(resolveOutboundCallback({ ...base, datePhrase: "tomorrow", timePhrase: "afternoon" })).toMatchObject({
      ok: true,
      scheduledFor: "2026-06-23T18:00:00.000Z",
      scheduledForSpoken: "June 23, 2026 at 2:00 PM EDT",
    });
  });

  it("resolves the next named weekday and exact time", () => {
    expect(resolveOutboundCallback({ ...base, datePhrase: "Friday", timePhrase: "11:30 AM" })).toMatchObject({
      ok: true,
      scheduledFor: "2026-06-26T15:30:00.000Z",
    });
  });

  it("rejects ambiguous, past, weekend, and outside-window requests", () => {
    expect(resolveOutboundCallback({ ...base, datePhrase: "sometime", timePhrase: "later" }).ok).toBe(false);
    expect(resolveOutboundCallback({ ...base, datePhrase: "today", timePhrase: "10:00 AM" })).toMatchObject({
      ok: false,
      reason: "callback_time_in_past",
    });
    expect(resolveOutboundCallback({ ...base, datePhrase: "Saturday", timePhrase: "morning" })).toMatchObject({
      ok: false,
      reason: "callback_weekend_not_allowed",
    });
    expect(resolveOutboundCallback({ ...base, datePhrase: "tomorrow", timePhrase: "6:00 PM" })).toMatchObject({
      ok: false,
      reason: "callback_outside_calling_window",
    });
  });
});

describe("outbound business setting safety", () => {
  it("requires exact confirmation to disable test mode", () => {
    expect(() => validateOutboundBusinessSettingsPatch({ test_mode: false }, {})).toThrow(PRODUCTION_MODE_CONFIRMATION);
    expect(
      validateOutboundBusinessSettingsPatch(
        { test_mode: false },
        { production_mode_confirmation: PRODUCTION_MODE_CONFIRMATION },
      ).test_mode,
    ).toBe(false);
  });

  it("requires exact confirmation to raise the batch limit and validates allowlist numbers", () => {
    expect(() => validateOutboundBusinessSettingsPatch({ max_batch_size: 2 }, {})).toThrow(BATCH_LIMIT_CONFIRMATION);
    expect(() =>
      validateOutboundBusinessSettingsPatch(
        { test_phone_allowlist: ["3475850249"] },
        {},
      ),
    ).toThrow("E.164");
    expect(
      validateOutboundBusinessSettingsPatch(
        { max_batch_size: 2, test_phone_allowlist: ["+13475850249"] },
        { batch_limit_confirmation: BATCH_LIMIT_CONFIRMATION },
      ),
    ).toMatchObject({ max_batch_size: 2, test_phone_allowlist: ["+13475850249"] });
  });
});

describe("extended customer CSV", () => {
  it("accepts compact dates and optional account context fields", () => {
    const csv = [
      "customer_id,first_name,last_name,phone_number,email,mailing_address,timezone,amount_due,original_due_date,service_description,invoice_id,business_name,status,outreach_paused,notes,last_payment_date,open_invoice_count,total_amount_due,payment_contact_preference,callback_preferred_time,payment_mailing_instructions",
      'C-1,Ana,Lopez,+13475850249,ana@example.test,"1 Test St",America/New_York,150.00,20260520,annual elevator inspection,ELV-1,Elixis Elevator Systems,unpaid,false,,20260415,2,300.00,email,2026-06-26 11:30 AM,"Mail to billing office"',
    ].join("\n");

    const result = parseOutboundCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      original_due_date: "2026-05-20",
      last_payment_date: "2026-04-15",
      open_invoice_count_hint: 2,
      total_amount_due_cents_hint: 30000,
      payment_contact_preference: "email",
      callback_preferred_time: "2026-06-26 11:30 AM",
      payment_mailing_instructions: "Mail to billing office",
    });
  });
});

describe("downloadable setup templates", () => {
  it("separates customer invoice data from business behavior settings", () => {
    const customers = customerCsvTemplate();
    const business = businessCsvTemplate();
    expect(customers).toContain("customer_id,first_name,last_name,phone_number");
    expect(customers).toContain("last_payment_date,open_invoice_count,total_amount_due");
    expect(business).toContain("business_name,industry,default_timezone,business_callback_number");
    expect(business).toContain("agent_display_name,ai_disclosure_policy,payment_mailing_instructions");
    expect(parseOutboundBusinessCsv(business).errors).toEqual([]);
    expect(parseOutboundBusinessCsv(business).rows[0]).toMatchObject({
      business_name: "Elixis Elevator Systems",
      agent_display_name: "Paul",
      ai_disclosure_policy: "after_identity",
    });
  });
});
