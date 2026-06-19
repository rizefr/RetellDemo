import { env } from "../config/env";
import { DateTime } from "luxon";
import { getRetellClient } from "../retell/retellClient";
import {
  evaluateAfterHoursTestOverride,
  evaluateOutboundCallEligibility,
  isWithinOutboundCallingWindow,
  normalizeOutboundTimezone,
} from "./outboundEligibility";
import {
  createOutboundCallAttempt,
  getOutboundInvoiceContext,
  nextOutboundAttemptNumber,
  insertOutboundEvent,
  updateOutboundCallAttempt,
} from "./outboundRepository";

export type AfterHoursOverrideRequest = {
  acknowledged: true;
  confirmation: string;
  reason: "self_test";
};

export function outboundAllowlist(): string[] {
  return env.OUTBOUND_TEST_PHONE_ALLOWLIST.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function money(amountCents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(
    amountCents / 100,
  );
}

export async function inspectOutboundCallEligibility(
  invoiceId: string,
  now = new Date(),
  afterHoursOverride?: AfterHoursOverrideRequest,
) {
  const context = await getOutboundInvoiceContext(invoiceId);
  const result = evaluateOutboundCallEligibility({
    now,
    timezone: String(context.customer.timezone || context.business.default_timezone || "America/New_York"),
    phoneNumber: String(context.customer.phone_number),
    invoiceStatus: String(context.invoice.status),
    outreachPaused: Boolean(context.customer.outreach_paused),
    hasActiveCall: Boolean(context.activeCall),
    testMode: env.OUTBOUND_TEST_MODE,
    allowlist: outboundAllowlist(),
  });
  if (!result.eligible && result.reason === "outside_calling_window" && afterHoursOverride) {
    const phoneNumber = String(context.customer.phone_number);
    const override = evaluateAfterHoursTestOverride({
      overrideConfigured: env.OUTBOUND_ALLOW_AFTER_HOURS_TEST_OVERRIDE,
      testMode: env.OUTBOUND_TEST_MODE,
      maxBatchSize: env.OUTBOUND_MAX_BATCH_SIZE,
      phoneNumber,
      allowlist: outboundAllowlist(),
      acknowledged: afterHoursOverride.acknowledged,
      confirmation: afterHoursOverride.confirmation,
      reason: afterHoursOverride.reason,
    });
    if (override.allowed) {
      return {
        context,
        eligible: true as const,
        reason: "after_hours_self_test" as const,
        override_used: true,
      };
    }
    return { context, ...result, override_used: false, override_block_reason: override.reason };
  }
  return { context, ...result, override_used: false };
}

export async function describeOutboundCallPreflight(
  invoiceId: string,
  now = new Date(),
  afterHoursOverride?: AfterHoursOverrideRequest,
) {
  const eligibility = await inspectOutboundCallEligibility(invoiceId, now, afterHoursOverride);
  const timezone = normalizeOutboundTimezone(
    String(eligibility.context.customer.timezone || eligibility.context.business.default_timezone || ""),
  );
  const phoneNumber = String(eligibility.context.customer.phone_number);
  const allowlist = outboundAllowlist();
  return {
    eligible: eligibility.eligible,
    reason: eligibility.reason,
    timezone,
    recipient_local_time: DateTime.fromJSDate(now, { zone: timezone }).toISO(),
    within_calling_window: isWithinOutboundCallingWindow(now, timezone),
    test_mode: env.OUTBOUND_TEST_MODE,
    allowlisted: !env.OUTBOUND_TEST_MODE || allowlist.includes(phoneNumber),
    phone_valid: /^\+[1-9]\d{7,14}$/.test(phoneNumber),
    outreach_paused: Boolean(eligibility.context.customer.outreach_paused),
    invoice_status: String(eligibility.context.invoice.status),
    active_call: Boolean(eligibility.context.activeCall),
    calling_window: "Monday-Friday, 10:00-16:00 recipient local time",
    after_hours_override_enabled: env.OUTBOUND_ALLOW_AFTER_HOURS_TEST_OVERRIDE,
    after_hours_override_used: eligibility.override_used,
    after_hours_override_block_reason:
      "override_block_reason" in eligibility ? eligibility.override_block_reason : null,
  };
}

export async function startOutboundCall(
  invoiceId: string,
  afterHoursOverride?: AfterHoursOverrideRequest,
  now = new Date(),
) {
  if (!env.OUTBOUND_RETELL_AGENT_ID) throw new Error("OUTBOUND_RETELL_AGENT_ID is required");
  if (!env.RETELL_FROM_NUMBER) throw new Error("RETELL_FROM_NUMBER is required");
  const eligibility = await inspectOutboundCallEligibility(invoiceId, now, afterHoursOverride);
  if (!eligibility.eligible) throw new Error(`Outbound call blocked: ${eligibility.reason}`);

  const { context } = eligibility;
  if (eligibility.override_used && afterHoursOverride) {
    await insertOutboundEvent({
      business_id: String(context.business.id),
      customer_id: String(context.customer.id),
      invoice_id: String(context.invoice.id),
      event_type: "after_hours_test_override_authorized",
      source: "admin",
      payload: {
        phone_number: String(context.customer.phone_number),
        reason: afterHoursOverride.reason,
        confirmation: afterHoursOverride.confirmation,
        authorized_at: new Date().toISOString(),
        test_mode: env.OUTBOUND_TEST_MODE,
      },
    });
  }
  const attemptNumber = await nextOutboundAttemptNumber(invoiceId);
  const attempt = await createOutboundCallAttempt({
    customer_id: context.customer.id,
    invoice_id: context.invoice.id,
    business_id: context.business.id,
    attempt_number: attemptNumber,
    direction: "outbound",
    from_number: env.RETELL_FROM_NUMBER,
    to_number: context.customer.phone_number,
    status: "starting",
    started_at: new Date().toISOString(),
  });
  const metadata = {
    business_id: String(context.business.id),
    customer_id: String(context.customer.id),
    invoice_id: String(context.invoice.id),
    invoice_number: String(context.invoice.invoice_id),
    call_attempt_id: String(attempt.id),
  };
  const dynamicVariables = {
    business_name: String(context.business.business_name),
    customer_first_name: String(context.customer.first_name),
    customer_last_name: String(context.customer.last_name),
    amount_due: money(Number(context.invoice.amount_due_cents), String(context.invoice.currency)),
    original_due_date: String(context.invoice.original_due_date),
    service_description: String(context.invoice.service_description),
    invoice_id: String(context.invoice.invoice_id),
    payment_link: String(context.paymentLink?.url ?? ""),
    attempt_number: String(attemptNumber),
    business_callback_number: String(context.business.callback_number || env.BUSINESS_CALLBACK_NUMBER || ""),
    human_transfer_number: String(context.business.human_transfer_number || env.HUMAN_TRANSFER_NUMBER || ""),
    timezone: String(context.customer.timezone || context.business.default_timezone || "America/New_York"),
  };

  try {
    const call = await getRetellClient().call.createPhoneCall({
      from_number: env.RETELL_FROM_NUMBER,
      to_number: String(context.customer.phone_number),
      override_agent_id: env.OUTBOUND_RETELL_AGENT_ID,
      metadata,
      retell_llm_dynamic_variables: dynamicVariables,
    });
    await updateOutboundCallAttempt(String(attempt.id), {
      retell_call_id: call.call_id,
      status: call.call_status,
    });
    return {
      call_id: call.call_id,
      status: call.call_status,
      attempt_id: attempt.id,
      after_hours_override_used: eligibility.override_used,
    };
  } catch (error) {
    await updateOutboundCallAttempt(String(attempt.id), {
      status: "error",
      ended_at: new Date().toISOString(),
      notes: error instanceof Error ? error.message.slice(0, 1000) : "Retell call creation failed",
    });
    throw error;
  }
}
