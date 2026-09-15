import crypto from "node:crypto";
import { z } from "zod";
import { getSupabaseClient } from "./supabase";
import { getOutboundBusinessSettings, insertOutboundEvent } from "./outboundRepository";

// An observation, not a live approval check. No environment flag enables sending.
export const SMS_CAMPAIGN_OBSERVATION = {
  phone_number: "+19842075346",
  status: "rejected",
  rejection_reason: "The campaign submission has been reviewed and rejected because a compliant privacy policy can not be verified.",
  observed_on: "2026-09-14",
  source: "Retell dashboard readback",
} as const;

export const smsConsentSchema = z.object({
  business_id: z.uuid(),
  customer_id: z.uuid(),
  phone_number: z.string().regex(/^\+[1-9]\d{7,14}$/),
  status: z.enum(["granted", "revoked"]),
  channel: z.literal("sms"),
  purpose: z.literal("invoice_follow_up"),
  source: z.enum(["written_opt_in", "web_form", "recorded_verbal", "customer_request"]),
  evidence: z.string().trim().min(20).max(2000),
  evidence_url: z.url().refine(value => {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password;
  }).optional(),
  captured_at: z.iso.datetime({ offset: true }),
  acknowledged: z.literal(true),
}).strict();

export function validateSmsConsent(value: unknown, now = new Date()) {
  const consent = smsConsentSchema.parse(value);
  if (new Date(consent.captured_at).valueOf() > now.valueOf()) throw new Error("Consent capture time cannot be in the future");
  return consent;
}

export function classifySmsInbound(text: string) {
  const normalized = text.trim().toLowerCase().replace(/[.!]+$/g, "").trim();
  if (/^(stop|stopall|unsubscribe|cancel|end|quit|please stop|stop (texting|messaging|contacting)( me)?)$/.test(normalized)) {
    return { action: "suppress", response_template: "stop", grants_consent: false, sends_reply: false } as const;
  }
  if (/^(help|info)$/.test(normalized)) return { action: "help_requested", response_template: "help", grants_consent: false, sends_reply: false } as const;
  if (/^(start|unstop|subscribe)$/.test(normalized)) return { action: "reconsent_review", response_template: null, grants_consent: false, sends_reply: false } as const;
  return { action: "review", response_template: null, grants_consent: false, sends_reply: false } as const;
}

export function smsSendDecision(input: { consent?: { status: string; phone_number: string; purpose: string }; phone_number: string; suppressed: boolean; campaign_approved?: boolean }) {
  const blockers = ["sms_sending_not_activated"];
  if (!input.campaign_approved) blockers.push("campaign_not_approved");
  if (input.suppressed) blockers.push("recipient_suppressed");
  if (!input.consent || input.consent.status !== "granted" || input.consent.phone_number !== input.phone_number || input.consent.purpose !== "invoice_follow_up") blockers.push("explicit_sms_consent_required");
  return { allowed: false as const, blockers };
}

export type SmsDeliveryState = "pending" | "accepted" | "sent" | "delivered" | "failed" | "undelivered";
export function nextSmsDeliveryState(current: SmsDeliveryState, incoming: SmsDeliveryState): SmsDeliveryState {
  if (current === "delivered") return current;
  if (incoming === "delivered") return incoming;
  if (["failed", "undelivered"].includes(current)) return current;
  if (["failed", "undelivered"].includes(incoming)) return incoming;
  return ["pending", "accepted", "sent"].indexOf(incoming) >= ["pending", "accepted", "sent"].indexOf(current) ? incoming : current;
}

const providerEventSchema = z.object({
  event_id: z.string().min(1).max(200),
  business_id: z.uuid(),
  phone_number: z.string().regex(/^\+[1-9]\d{7,14}$/),
  timestamp: z.iso.datetime({ offset: true }),
  type: z.enum(["inbound", "accepted", "sent", "delivered", "failed", "undelivered"]),
}).strict();

// This normalized adapter is deliberately not mounted. A future provider adapter
// must supply the documented raw-body verifier and a verified business binding.
export async function validateSmsProviderEvent(input: {
  raw_body: string; signature: string; business_id: string;
  verify_signature: (raw: string, signature: string) => boolean | Promise<boolean>;
  now?: Date;
}) {
  if (!input.signature || !(await input.verify_signature(input.raw_body, input.signature))) throw new Error("Invalid SMS provider signature");
  const event = providerEventSchema.parse(JSON.parse(input.raw_body));
  if (event.business_id !== input.business_id) throw new Error("SMS provider business binding mismatch");
  const age = (input.now || new Date()).valueOf() - new Date(event.timestamp).valueOf();
  if (age < -60_000 || age > 300_000) throw new Error("SMS provider event timestamp is outside the accepted window");
  return { ...event, body_hash: crypto.createHash("sha256").update(input.raw_body).digest("hex") };
}

function db() { const client = getSupabaseClient(); if (!client) throw new Error("SMS readiness storage unavailable"); return client; }

export async function recordOutboundSmsConsent(input: unknown) {
  const consent = validateSmsConsent(input);
  await getOutboundBusinessSettings(consent.business_id);
  const customer = await db().from("outbound_customers").select("id, business_id").eq("id", consent.customer_id).eq("business_id", consent.business_id).single();
  if (customer.error || !customer.data) throw new Error("Customer does not belong to the selected business");
  const { acknowledged: _acknowledged, ...record } = consent;
  // Append only. An opt-in never removes a previously recorded suppression.
  const saved = await db().from("outbound_sms_consents").insert(record).select("id,status,created_at").single();
  if (saved.error || !saved.data) throw new Error("SMS consent could not be stored");
  if (consent.status === "revoked") {
    const suppression = await db().from("outbound_sms_suppressions").upsert({ business_id: consent.business_id, phone_number: consent.phone_number, reason: "consent_revoked", consent_id: saved.data.id }, { onConflict: "business_id,phone_number" });
    if (suppression.error) throw new Error("Consent revocation stored; suppression requires review. Sending remains disabled");
  }
  await insertOutboundEvent({ business_id: consent.business_id, customer_id: consent.customer_id, source: "admin", event_type: "sms_consent_recorded", payload: { consent_id: saved.data.id, status: consent.status, purpose: consent.purpose, source: consent.source, sending_enabled: false } });
  return { consent: saved.data, sending_enabled: false, suppression_cleared: false };
}

export async function getOutboundSmsReadiness(businessId: string) {
  await getOutboundBusinessSettings(businessId);
  const [consents, suppressions, events] = await Promise.all([
    db().from("outbound_sms_consents").select("id", { count: "exact", head: true }).eq("business_id", businessId),
    db().from("outbound_sms_suppressions").select("id", { count: "exact", head: true }).eq("business_id", businessId),
    db().from("outbound_sms_provider_events").select("id,event_type,created_at").eq("business_id", businessId).order("created_at", { ascending: false }).limit(10),
  ]);
  const storageReady = !consents.error && !suppressions.error && !events.error;
  return {
    sending_enabled: false, campaign: SMS_CAMPAIGN_OBSERVATION, provider_webhook_connected: false,
    storage_ready: storageReady, consent_record_count: consents.count ?? null, suppression_count: suppressions.count ?? null,
    recent_delivery_events: events.data || [],
    blockers: ["explicit_activation_required", "campaign_rejected_privacy_policy_unverified", "provider_webhook_not_connected", ...(!storageReady ? ["readiness_storage_unavailable"] : [])],
    consent_rule: "Explicit SMS permission for invoice follow-up is required. QuickBooks phone numbers, email permission, and voice-call permission are not SMS consent.",
    templates: {
      reminder: "{{business_name}}: Invoice {{invoice_number}} has an outstanding balance of {{balance}}. Review the verified payment link: {{payment_url}}. Reply STOP to opt out or HELP for help.",
      stop: "You have opted out of {{business_name}} text messages. No further texts will be sent.",
      help: "For help with {{business_name}} invoices, contact {{verified_business_contact}}. Reply STOP to opt out.",
    },
    activation_checklist: ["Resolve the privacy-policy verification rejection and obtain a new approved campaign readback for the linked number", "Verify the opt-in wording and evidence", "Connect and test provider signature verification and replay protection", "Verify STOP suppression, HELP handling, and delivery receipts", "Obtain explicit activation approval"],
  };
}
