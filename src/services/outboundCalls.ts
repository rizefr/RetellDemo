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
  getOutboundFollowupTask,
  updateOutboundFollowupTask,
} from "./outboundRepository";
import { formatOutboundDate } from "./outboundFormatting";
import { outboundBusinessRuntimeSettings } from "./outboundRuntimeSettings";

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
  const runtime = outboundBusinessRuntimeSettings(context.business);
  const result = evaluateOutboundCallEligibility({
    now,
    timezone: String(context.customer.timezone || context.business.default_timezone || "America/New_York"),
    phoneNumber: String(context.customer.phone_number),
    invoiceStatus: String(context.invoice.status),
    outreachPaused: Boolean(context.customer.outreach_paused),
    hasActiveCall: Boolean(context.activeCall),
    testMode: runtime.testMode,
    allowlist: runtime.allowlist,
  });
  if (!result.eligible && result.reason === "outside_calling_window" && afterHoursOverride) {
    const phoneNumber = String(context.customer.phone_number);
    const override = evaluateAfterHoursTestOverride({
      overrideConfigured: runtime.allowAfterHoursTestOverride,
      testMode: runtime.testMode,
      maxBatchSize: runtime.maxBatchSize,
      phoneNumber,
      allowlist: runtime.allowlist,
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
  followupTaskId?: string,
) {
  const eligibility = await inspectOutboundCallEligibility(invoiceId, now, afterHoursOverride);
  const timezone = normalizeOutboundTimezone(
    String(eligibility.context.customer.timezone || eligibility.context.business.default_timezone || ""),
  );
  const phoneNumber = String(eligibility.context.customer.phone_number);
  const runtime = outboundBusinessRuntimeSettings(eligibility.context.business);
  const allowlist = runtime.allowlist;
  let callbackTaskEligible = true;
  let callbackTaskReason: string | null = null;
  if (followupTaskId) {
    const task = await getOutboundFollowupTask(followupTaskId);
    callbackTaskEligible =
      String(task.invoice_id) === String(eligibility.context.invoice.id) &&
      task.task_type === "callback" &&
      task.status === "pending";
    if (!callbackTaskEligible) callbackTaskReason = "callback_task_not_pending_for_invoice";
  }
  return {
    eligible: eligibility.eligible && callbackTaskEligible,
    reason: callbackTaskReason || eligibility.reason,
    timezone,
    recipient_local_time: DateTime.fromJSDate(now, { zone: timezone }).toISO(),
    within_calling_window: isWithinOutboundCallingWindow(now, timezone),
    test_mode: runtime.testMode,
    allowlisted: !runtime.testMode || allowlist.includes(phoneNumber),
    phone_valid: /^\+[1-9]\d{7,14}$/.test(phoneNumber),
    outreach_paused: Boolean(eligibility.context.customer.outreach_paused),
    invoice_status: String(eligibility.context.invoice.status),
    active_call: Boolean(eligibility.context.activeCall),
    calling_window: "Monday-Friday, 10:00-16:00 recipient local time",
    after_hours_override_enabled: runtime.allowAfterHoursTestOverride,
    after_hours_override_used: eligibility.override_used,
    after_hours_override_block_reason:
      "override_block_reason" in eligibility ? eligibility.override_block_reason : null,
    followup_task_id: followupTaskId || null,
  };
}

export async function startOutboundCall(
  invoiceId: string,
  afterHoursOverride?: AfterHoursOverrideRequest,
  now = new Date(),
  followupTaskId?: string,
) {
  if (!env.OUTBOUND_RETELL_AGENT_ID) throw new Error("OUTBOUND_RETELL_AGENT_ID is required");
  if (!env.RETELL_FROM_NUMBER) throw new Error("RETELL_FROM_NUMBER is required");
  const eligibility = await inspectOutboundCallEligibility(invoiceId, now, afterHoursOverride);
  if (!eligibility.eligible) throw new Error(`Outbound call blocked: ${eligibility.reason}`);

  const { context } = eligibility;
  const runtime = outboundBusinessRuntimeSettings(context.business);
  let followupTask: Record<string, unknown> | null = null;
  if (followupTaskId) {
    followupTask = await getOutboundFollowupTask(followupTaskId);
    if (String(followupTask.invoice_id) !== String(context.invoice.id) || followupTask.task_type !== "callback") {
      throw new Error("Callback task does not belong to the selected invoice");
    }
    if (followupTask.status !== "pending") throw new Error("Callback task is not pending");
  }
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
        test_mode: runtime.testMode,
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
  const account = context.account ?? {
    openInvoiceCount: 1,
    totalAmountDueCents: Number(context.invoice.amount_due_cents),
    oldestInvoiceDate: context.invoice.original_due_date,
    mostRecentInvoiceDate: context.invoice.original_due_date,
    selectedInvoiceIsMostRecent: true,
    lastPaymentDate: null,
  };
  const dynamicVariables = {
    business_name: String(context.business.business_name),
    customer_first_name: String(context.customer.first_name),
    customer_last_name: String(context.customer.last_name),
    amount_due: money(Number(context.invoice.amount_due_cents), String(context.invoice.currency)),
    original_due_date: String(context.invoice.original_due_date),
    original_due_date_spoken: formatOutboundDate(String(context.invoice.original_due_date)),
    service_description: String(context.invoice.service_description),
    invoice_id: String(context.invoice.invoice_id),
    payment_link: String(context.paymentLink?.url ?? ""),
    attempt_number: String(attemptNumber),
    business_callback_number: String(context.business.callback_number || env.BUSINESS_CALLBACK_NUMBER || ""),
    human_transfer_number: String(context.business.human_transfer_number || env.HUMAN_TRANSFER_NUMBER || ""),
    timezone: String(context.customer.timezone || context.business.default_timezone || "America/New_York"),
    agent_display_name: String(context.business.agent_display_name || "Paul"),
    ai_disclosure_policy: String(context.business.ai_disclosure_policy || "after_identity"),
    open_invoice_count: String(account.openInvoiceCount),
    total_amount_due: money(Number(account.totalAmountDueCents), String(context.invoice.currency)),
    oldest_invoice_date_spoken: formatOutboundDate(String(account.oldestInvoiceDate || ""), ""),
    most_recent_invoice_date_spoken: formatOutboundDate(String(account.mostRecentInvoiceDate || ""), ""),
    selected_invoice_is_most_recent: String(account.selectedInvoiceIsMostRecent),
    last_payment_date_spoken: formatOutboundDate(
      String(account.lastPaymentDate || context.customer.imported_last_payment_date || "").slice(0, 10),
      "",
    ),
    email_on_file: String(Boolean(context.customer.email)),
    mailing_instructions_available: String(Boolean(context.business.payment_mailing_instructions)),
    payment_mailing_instructions: String(context.business.payment_mailing_instructions || ""),
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
    if (followupTask) {
      await updateOutboundFollowupTask(String(followupTask.id), {
        status: "in_progress",
        source_call_attempt_id: attempt.id,
        source_retell_call_id: call.call_id,
      });
    }
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
