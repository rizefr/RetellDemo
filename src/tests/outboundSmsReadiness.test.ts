import { describe, expect, it, vi } from "vitest";
import { classifySmsInbound, nextSmsDeliveryState, smsSendDecision, validateSmsConsent, validateSmsProviderEvent } from "../services/outboundSmsReadiness";

const businessId = "00000000-0000-4000-8000-000000000001";
const now = new Date("2026-09-14T14:00:00Z");
const consent = { business_id: businessId, customer_id: "00000000-0000-4000-8000-000000000002", phone_number: "+13475850249", channel: "sms", purpose: "invoice_follow_up", status: "granted", source: "web_form", evidence: "Explicit invoice follow-up SMS consent captured on the customer web form.", captured_at: "2026-09-14T13:00:00Z", acknowledged: true };

describe("SMS readiness without activation", () => {
  it("never grants consent from imported phone numbers, ambiguous channels or missing evidence", () => {
    expect(validateSmsConsent(consent, now).source).toBe("web_form");
    expect(() => validateSmsConsent({ ...consent, source: "quickbooks" }, now)).toThrow();
    expect(() => validateSmsConsent({ ...consent, channel: "phone_call" }, now)).toThrow();
    expect(() => validateSmsConsent({ ...consent, evidence: "" }, now)).toThrow();
    expect(() => validateSmsConsent({ ...consent, acknowledged: false }, now)).toThrow();
    expect(() => validateSmsConsent({ ...consent, captured_at: "2026-09-15T13:00:00Z" }, now)).toThrow();
  });

  it("requires trusted evidence URLs without URL credentials", () => {
    expect(() => validateSmsConsent({ ...consent, evidence_url: "javascript:alert(1)" }, now)).toThrow();
    expect(() => validateSmsConsent({ ...consent, evidence_url: "https://secret@example.com/evidence" }, now)).toThrow();
  });

  it("classifies STOP, HELP and reconsent without sending or clearing a suppression", () => {
    for (const text of ["STOP", "stopall", "UNSUBSCRIBE", "Please stop.", "stop texting me"]) expect(classifySmsInbound(text).action).toBe("suppress");
    expect(classifySmsInbound("HELP")).toMatchObject({ action: "help_requested", sends_reply: false });
    expect(classifySmsInbound("START")).toMatchObject({ action: "reconsent_review", grants_consent: false });
    expect(classifySmsInbound("don't stop").action).toBe("review");
  });

  it("keeps sending hard-disabled even with claimed campaign approval and valid consent", () => {
    const decision = smsSendDecision({ consent, phone_number: consent.phone_number, suppressed: false, campaign_approved: true });
    expect(decision).toEqual({ allowed: false, blockers: ["sms_sending_not_activated"] });
    expect(smsSendDecision({ consent, phone_number: "+15555550123", suppressed: true }).blockers).toEqual(expect.arrayContaining(["recipient_suppressed", "explicit_sms_consent_required", "campaign_not_approved"]));
  });

  it("rejects unsigned, stale, future and cross-business normalized provider events", async () => {
    const event = { event_id: "event-1", business_id: businessId, phone_number: consent.phone_number, timestamp: now.toISOString(), type: "delivered" };
    const verifier = vi.fn(() => true);
    const input = { raw_body: JSON.stringify(event), signature: "verified-fixture", business_id: businessId, verify_signature: verifier, now };
    expect((await validateSmsProviderEvent(input)).body_hash).toMatch(/^[a-f0-9]{64}$/);
    await expect(validateSmsProviderEvent({ ...input, signature: "" })).rejects.toThrow("signature");
    await expect(validateSmsProviderEvent({ ...input, verify_signature: () => false })).rejects.toThrow("signature");
    await expect(validateSmsProviderEvent({ ...input, business_id: "00000000-0000-4000-8000-000000000099" })).rejects.toThrow("binding");
    await expect(validateSmsProviderEvent({ ...input, now: new Date("2026-09-14T14:06:00Z") })).rejects.toThrow("timestamp");
    await expect(validateSmsProviderEvent({ ...input, now: new Date("2026-09-14T13:58:00Z") })).rejects.toThrow("timestamp");
    expect(verifier).toHaveBeenCalledWith(input.raw_body, input.signature);
  });

  it("does not downgrade delivered messages or resurrect failed messages on late receipts", () => {
    expect(nextSmsDeliveryState("delivered", "sent")).toBe("delivered");
    expect(nextSmsDeliveryState("failed", "accepted")).toBe("failed");
    expect(nextSmsDeliveryState("sent", "delivered")).toBe("delivered");
    expect(nextSmsDeliveryState("pending", "undelivered")).toBe("undelivered");
  });
});
