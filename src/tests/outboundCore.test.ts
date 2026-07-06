import { describe, expect, it } from "vitest";
import {
  AFTER_HOURS_TEST_CONFIRMATION,
  evaluateAfterHoursTestOverride,
  evaluateOutboundCallEligibility,
  isWithinOutboundCallingWindow,
  validateBatchMode,
} from "../services/outboundEligibility";
import { buildBaselineFollowups, nextEligibleOutboundTime } from "../services/outboundFollowups";
import { parseOutboundCsv } from "../services/outboundCsv";
import { buildOutboundStripeMetadata } from "../services/outboundStripe";
import { OUTBOUND_OUTCOMES, applyOutcomePolicy } from "../services/outboundOutcomes";

describe("outbound calling safety", () => {
  it("allows weekdays from 10:00 through 15:59 in the recipient timezone", () => {
    expect(isWithinOutboundCallingWindow(new Date("2026-06-08T14:00:00Z"), "America/New_York")).toBe(true);
    expect(isWithinOutboundCallingWindow(new Date("2026-06-08T19:59:00Z"), "America/New_York")).toBe(true);
    expect(isWithinOutboundCallingWindow(new Date("2026-06-08T20:00:00Z"), "America/New_York")).toBe(false);
  });

  it("handles DST and rejects weekends", () => {
    expect(isWithinOutboundCallingWindow(new Date("2026-01-12T15:00:00Z"), "America/New_York")).toBe(true);
    expect(isWithinOutboundCallingWindow(new Date("2026-06-13T15:00:00Z"), "America/New_York")).toBe(false);
  });

  it("blocks paused, paid, active, and non-allowlisted test calls", () => {
    const base = {
      now: new Date("2026-06-08T15:00:00Z"),
      timezone: "America/New_York",
      phoneNumber: "+12125550101",
      invoiceStatus: "unpaid",
      outreachPaused: false,
      hasActiveCall: false,
      testMode: true,
      allowlist: ["+12125550101"],
    };

    expect(evaluateOutboundCallEligibility(base).eligible).toBe(true);
    expect(evaluateOutboundCallEligibility({ ...base, outreachPaused: true }).reason).toBe("outreach_paused");
    expect(evaluateOutboundCallEligibility({ ...base, invoiceStatus: "paid" }).reason).toBe("invoice_not_outstanding");
    expect(evaluateOutboundCallEligibility({ ...base, hasActiveCall: true }).reason).toBe("active_call_exists");
    expect(evaluateOutboundCallEligibility({ ...base, allowlist: [] }).reason).toBe("test_number_not_allowlisted");
  });

  it("requires the real batch confirmation gate", () => {
    expect(validateBatchMode({ mode: "dry_run", testMode: true, confirmation: "" }).allowed).toBe(true);
    expect(validateBatchMode({ mode: "test", testMode: true, confirmation: "" }).allowed).toBe(true);
    expect(validateBatchMode({ mode: "real", testMode: true, confirmation: "START_REAL_OUTBOUND_BATCH" }).allowed).toBe(
      false,
    );
    expect(
      validateBatchMode({ mode: "real", testMode: false, confirmation: "START_REAL_OUTBOUND_BATCH" }).allowed,
    ).toBe(true);
  });

  it("keeps after-hours calls blocked unless every self-test override gate passes", () => {
    const base = {
      overrideConfigured: true,
      testMode: true,
      maxBatchSize: 1,
      phoneNumber: "+13475850249",
      allowlist: ["+13475850249"],
      acknowledged: true,
      confirmation: AFTER_HOURS_TEST_CONFIRMATION,
      reason: "self_test",
    };

    expect(evaluateAfterHoursTestOverride(base)).toEqual({ allowed: true, reason: "after_hours_self_test" });
    expect(evaluateAfterHoursTestOverride({ ...base, overrideConfigured: false }).allowed).toBe(false);
    expect(evaluateAfterHoursTestOverride({ ...base, testMode: false }).allowed).toBe(false);
    expect(evaluateAfterHoursTestOverride({ ...base, maxBatchSize: 2 }).allowed).toBe(false);
    expect(evaluateAfterHoursTestOverride({ ...base, allowlist: [] }).reason).toBe("test_number_not_allowlisted");
    expect(evaluateAfterHoursTestOverride({ ...base, acknowledged: false }).allowed).toBe(false);
    expect(evaluateAfterHoursTestOverride({ ...base, confirmation: "wrong" }).allowed).toBe(false);
  });
});

describe("outbound follow-up schedule", () => {
  it("normalizes weekend follow-ups to the next weekday at 10 AM local time", () => {
    const scheduled = nextEligibleOutboundTime("2026-06-11T15:00:00Z", 2, "America/New_York");
    expect(scheduled).toBe("2026-06-15T14:00:00.000Z");
  });

  it("creates Day 2, Day 7, and Day 14 foundation tasks", () => {
    const tasks = buildBaselineFollowups("2026-06-08T15:00:00Z", "America/New_York", 1);
    expect(tasks.map((task) => [task.task_type, task.attempt_number])).toEqual([
      ["call", 2],
      ["email_placeholder", 2],
      ["final_reminder_placeholder", 3],
      ["manual_review", 4],
    ]);
  });
});

describe("outbound CSV conversion", () => {
  it("converts dollar amounts to cents and validates E.164 phone numbers", () => {
    const csv = [
      "customer_id,first_name,last_name,phone_number,email,mailing_address,timezone,amount_due,original_due_date,service_description,invoice_id,business_name,status,outreach_paused,notes",
      'C-1,Ana,Lopez,+12125550101,ana@example.test,"1 Test St",America/New_York,1250.75,2026-05-01,Annual elevator inspection,INV-1,Demo Elevator Inspections,unpaid,false,Test customer',
    ].join("\n");

    const result = parseOutboundCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows[0].amount_due_cents).toBe(125075);
    expect(result.rows[0].phone_number).toBe("+12125550101");
  });

  it("reports invalid rows without treating them as importable", () => {
    const csv = [
      "customer_id,first_name,last_name,phone_number,email,mailing_address,timezone,amount_due,original_due_date,service_description,invoice_id,business_name,status,outreach_paused,notes",
      "C-2,Bad,Phone,2125550101,,,,10.00,2026-05-01,Inspection,INV-2,Demo Elevator Inspections,unpaid,false,",
    ].join("\n");
    const result = parseOutboundCsv(csv);
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0].message).toContain("E.164");
  });
});

describe("Stripe metadata and outcome policies", () => {
  it("maps every required invoice identity field into Stripe metadata", () => {
    expect(
      buildOutboundStripeMetadata({
        internalInvoiceId: "invoice-row",
        invoiceId: "INV-100",
        customerId: "customer-row",
        businessId: "business-row",
        businessName: "Demo Elevator Inspections",
      }),
    ).toEqual({
      internal_invoice_id: "invoice-row",
      invoice_id: "INV-100",
      customer_id: "customer-row",
      business_id: "business-row",
      business_name: "Demo Elevator Inspections",
    });
  });

  it("defines and handles every required outcome", () => {
    expect(OUTBOUND_OUTCOMES).toContain("confirmed_payment_link_requested");
    expect(OUTBOUND_OUTCOMES).toContain("attorney_represented");
    expect(OUTBOUND_OUTCOMES).toContain("sms_pending_manual");
    expect(OUTBOUND_OUTCOMES).toContain("email_requested");
    expect(OUTBOUND_OUTCOMES).toContain("email_sent");
    expect(OUTBOUND_OUTCOMES).toContain("email_pending_manual");
    expect(OUTBOUND_OUTCOMES).toContain("email_failed");
    expect(OUTBOUND_OUTCOMES).toContain("email_missing");
    for (const outcome of OUTBOUND_OUTCOMES) {
      expect(applyOutcomePolicy(outcome)).toBeDefined();
    }
    expect(applyOutcomePolicy("do_not_contact").pauseOutreach).toBe(true);
    expect(applyOutcomePolicy("dispute").invoiceStatus).toBe("disputed");
    expect(applyOutcomePolicy("no_answer").scheduleFollowups).toBe(true);
  });
});
