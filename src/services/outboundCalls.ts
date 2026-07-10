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
  getOutboundDemoCallAuthorization,
  touchOutboundDemoCallAuthorization,
} from "./outboundRepository";
import {
  formatOutboundDate,
  formatOutboundDateSpoken,
  formatOutboundDateTime,
  formatOutboundEmailSpoken,
  formatOutboundEmailSpokenPhonetic,
  formatOutboundEmailSpokenSlow,
  formatOutboundInvoiceCountSpoken,
  formatOutboundInvoiceIdSpoken,
  formatOutboundMoneySpoken,
  formatOutboundNameSpoken,
  formatOutboundPhoneSpoken,
  formatOutboundPhoneSpokenChunked,
} from "./outboundFormatting";
import { outboundBusinessRuntimeSettings } from "./outboundRuntimeSettings";
import { resolveOutboundAgentVariant, type OutboundAgentVariant } from "./outboundAgentVariant";

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

export function outboundAiDisclosureInstruction(policy: unknown, businessName = "Elixis Elevator Systems"): string {
  const safeBusinessName = businessName.trim() || "Elixis Elevator Systems";
  if (policy === "opening") {
    return "Disclose naturally near the opening that you are an AI voice assistant.";
  }
  if (policy === "on_request" || !policy) {
    return "Do not mention or volunteer AI status unless the person explicitly asks whether you are AI, automated, or a robot. If asked, answer honestly.";
  }
  return `After confirming identity, say only once: "I'm a virtual assistant helping ${safeBusinessName} with invoice follow-up." Then continue naturally into the inspection invoice details. If asked whether you are AI or a robot, answer honestly.`;
}

function demoCallMode(value: unknown): string {
  return ["first_reminder", "follow_up", "callback_followup", "scam_recovery", "service_issue"].includes(String(value))
    ? String(value)
    : "first_reminder";
}

async function activeDemoAuthorization(id: string | undefined, businessId: string, now: Date) {
  if (!id) return null;
  const authorization = await getOutboundDemoCallAuthorization(id);
  if (String(authorization.business_id) !== businessId) throw new Error("Demo call authorization does not match business");
  if (authorization.revoked_at) throw new Error("Demo call authorization has been revoked");
  if (new Date(String(authorization.expires_at)).getTime() <= now.getTime()) {
    throw new Error("Demo call authorization has expired");
  }
  return authorization;
}

export async function inspectOutboundCallEligibility(
  invoiceId: string,
  now = new Date(),
  afterHoursOverride?: AfterHoursOverrideRequest,
  demoCallAuthorizationId?: string,
) {
  const context = await getOutboundInvoiceContext(invoiceId);
  const runtime = outboundBusinessRuntimeSettings(context.business);
  const demoAuthorization = await activeDemoAuthorization(
    demoCallAuthorizationId,
    String(context.business.id),
    now,
  );
  if (demoAuthorization) {
    if (!runtime.testMode) {
      return {
        context,
        eligible: false as const,
        reason: "demo_call_requires_test_mode",
        override_used: false,
        demo_call_authorization: demoAuthorization,
        effective_phone_number: String(demoAuthorization.phone_number),
      };
    }
    if (runtime.maxBatchSize !== 1) {
      return {
        context,
        eligible: false as const,
        reason: "demo_call_requires_batch_size_one",
        override_used: false,
        demo_call_authorization: demoAuthorization,
        effective_phone_number: String(demoAuthorization.phone_number),
      };
    }
  }
  const effectivePhoneNumber = String(demoAuthorization?.phone_number || context.customer.phone_number);
  const effectiveAllowlist = demoAuthorization
    ? Array.from(new Set([...runtime.allowlist, String(demoAuthorization.phone_number)]))
    : runtime.allowlist;
  const result = evaluateOutboundCallEligibility({
    now,
    timezone: String(context.customer.timezone || context.business.default_timezone || "America/New_York"),
    phoneNumber: effectivePhoneNumber,
    invoiceStatus: String(context.invoice.status),
    outreachPaused: Boolean(context.customer.outreach_paused),
    hasActiveCall: Boolean(context.activeCall),
    testMode: runtime.testMode,
    allowlist: effectiveAllowlist,
  });
  if (!result.eligible && result.reason === "outside_calling_window" && afterHoursOverride) {
    const override = evaluateAfterHoursTestOverride({
      overrideConfigured: runtime.allowAfterHoursTestOverride,
      testMode: runtime.testMode,
      maxBatchSize: runtime.maxBatchSize,
      phoneNumber: effectivePhoneNumber,
      allowlist: effectiveAllowlist,
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
        demo_call_authorization: demoAuthorization,
        effective_phone_number: effectivePhoneNumber,
      };
    }
    return {
      context,
      ...result,
      override_used: false,
      override_block_reason: override.reason,
      demo_call_authorization: demoAuthorization,
      effective_phone_number: effectivePhoneNumber,
    };
  }
  return { context, ...result, override_used: false, demo_call_authorization: demoAuthorization, effective_phone_number: effectivePhoneNumber };
}

export async function describeOutboundCallPreflight(
  invoiceId: string,
  now = new Date(),
  afterHoursOverride?: AfterHoursOverrideRequest,
  followupTaskId?: string,
  demoCallAuthorizationId?: string,
  agentVariant: OutboundAgentVariant = "conversation_flow",
) {
  const eligibility = await inspectOutboundCallEligibility(invoiceId, now, afterHoursOverride, demoCallAuthorizationId);
  const timezone = normalizeOutboundTimezone(
    String(eligibility.context.customer.timezone || eligibility.context.business.default_timezone || ""),
  );
  const phoneNumber = String(eligibility.effective_phone_number || eligibility.context.customer.phone_number);
  const runtime = outboundBusinessRuntimeSettings(eligibility.context.business);
  const allowlist = eligibility.demo_call_authorization
    ? Array.from(new Set([...runtime.allowlist, phoneNumber]))
    : runtime.allowlist;
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
  const selectedAgent = resolveOutboundAgentVariant(agentVariant);
  return {
    eligible: eligibility.eligible && callbackTaskEligible && selectedAgent.configured,
    reason: selectedAgent.reason || callbackTaskReason || eligibility.reason,
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
    demo_call_authorization_id: demoCallAuthorizationId || null,
    demo_call_mode: demoCallMode(eligibility.demo_call_authorization?.demo_call_mode || eligibility.context.invoice.demo_call_mode),
    destination_phone_number: phoneNumber,
    agent_variant: selectedAgent.variant,
    agent_label: selectedAgent.label,
    agent_configured: selectedAgent.configured,
  };
}

export async function startOutboundCall(
  invoiceId: string,
  afterHoursOverride?: AfterHoursOverrideRequest,
  now = new Date(),
  followupTaskId?: string,
  demoCallAuthorizationId?: string,
  agentVariant: OutboundAgentVariant = "conversation_flow",
) {
  const selectedAgent = resolveOutboundAgentVariant(agentVariant);
  if (!selectedAgent.configured) throw new Error(selectedAgent.reason || "Retell agent is not configured");
  if (!env.RETELL_FROM_NUMBER) throw new Error("RETELL_FROM_NUMBER is required");
  const eligibility = await inspectOutboundCallEligibility(invoiceId, now, afterHoursOverride, demoCallAuthorizationId);
  if (!eligibility.eligible) throw new Error(`Outbound call blocked: ${eligibility.reason}`);

  const { context } = eligibility;
  const runtime = outboundBusinessRuntimeSettings(context.business);
  const effectivePhoneNumber = String(eligibility.effective_phone_number || context.customer.phone_number);
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
        destination_phone_number: effectivePhoneNumber,
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
    to_number: effectivePhoneNumber,
    status: "starting",
    started_at: new Date().toISOString(),
  });
  const metadata = {
    business_id: String(context.business.id),
    customer_id: String(context.customer.id),
    invoice_id: String(context.invoice.id),
    invoice_number: String(context.invoice.invoice_id),
    call_attempt_id: String(attempt.id),
    agent_variant: selectedAgent.variant,
    ...(demoCallAuthorizationId ? { demo_call_authorization_id: demoCallAuthorizationId } : {}),
  };
  const account = context.account ?? {
    openInvoiceCount: 1,
    totalAmountDueCents: Number(context.invoice.amount_due_cents),
    oldestInvoiceDate: context.invoice.original_due_date,
    mostRecentInvoiceDate: context.invoice.original_due_date,
    selectedInvoiceIsMostRecent: true,
    lastPaymentDate: null,
  };
  const selectedDemoMode = followupTask
    ? "callback_followup"
    : demoCallMode(eligibility.demo_call_authorization?.demo_call_mode || context.invoice.demo_call_mode);
  const preferredEmail = String(context.customer.preferred_email || context.customer.email || "");
  const preferredPaymentMethod = String(
    context.invoice.preferred_payment_method || context.customer.payment_contact_preference || "none",
  );
  const paymentProvider = String(context.business.payment_provider || "stripe");
  const quickBooksConnected =
    Boolean(context.business.quickbooks_connected) &&
    ["quickbooks", "quickbooks_payment_link_enabled"].includes(paymentProvider);
  const inspectionType = String(context.invoice.inspection_type || context.business.default_inspection_type || "Category 1");
  const inspectionDateRaw = String(context.invoice.inspection_date || context.invoice.original_due_date || "");
  const accountCompanyName =
    String(context.customer.account_company_name || "").trim() ||
    "the business account connected with this number";
  const businessName = String(context.business.business_name);
  const customerFirstName = String(context.customer.first_name);
  const customerLastName = String(context.customer.last_name);
  const daysAfterInspection = Number(context.business.days_after_inspection_first_call ?? 14);
  const veryOverdueThreshold = Number(context.business.very_overdue_threshold_days ?? 45);
  const dueDate = DateTime.fromISO(String(context.invoice.original_due_date || ""), { zone: "utc" });
  const overdueDays = dueDate.isValid ? Math.max(0, Math.floor((now.getTime() - dueDate.toJSDate().getTime()) / 86_400_000)) : 0;
  const dynamicVariables = {
    business_name: businessName,
    business_name_spoken: formatOutboundNameSpoken(businessName),
    account_company_name: accountCompanyName,
    account_company_name_spoken: formatOutboundNameSpoken(accountCompanyName),
    customer_first_name: customerFirstName,
    customer_first_name_spoken: formatOutboundNameSpoken(customerFirstName),
    customer_last_name: customerLastName,
    customer_last_name_spoken: formatOutboundNameSpoken(customerLastName),
    amount_due: money(Number(context.invoice.amount_due_cents), String(context.invoice.currency)),
    amount_due_spoken: formatOutboundMoneySpoken(
      Number(context.invoice.amount_due_cents),
      String(context.invoice.currency),
    ),
    original_due_date: String(context.invoice.original_due_date),
    original_due_date_spoken: formatOutboundDateSpoken(String(context.invoice.original_due_date)),
    original_due_date_display: formatOutboundDate(String(context.invoice.original_due_date)),
    inspection_date_spoken: formatOutboundDateSpoken(inspectionDateRaw),
    inspection_date_display: formatOutboundDate(inspectionDateRaw),
    service_description: String(context.invoice.service_description),
    invoice_id: String(context.invoice.invoice_id),
    invoice_id_spoken: formatOutboundInvoiceIdSpoken(String(context.invoice.invoice_id)),
    payment_link: String(context.paymentLink?.url ?? ""),
    attempt_number: String(attemptNumber),
    business_callback_number: String(context.business.callback_number || env.BUSINESS_CALLBACK_NUMBER || ""),
    human_transfer_number: String(context.business.human_transfer_number || env.HUMAN_TRANSFER_NUMBER || ""),
    timezone: String(context.customer.timezone || context.business.default_timezone || "America/New_York"),
    agent_display_name: String(context.business.agent_display_name || "Paul"),
    ai_disclosure_policy: String(context.business.ai_disclosure_policy || "on_request"),
    ai_disclosure_instruction: outboundAiDisclosureInstruction(
      context.business.ai_disclosure_policy || "on_request",
      String(context.business.business_name || ""),
    ),
    open_invoice_count: String(account.openInvoiceCount),
    open_invoice_count_spoken: formatOutboundInvoiceCountSpoken(Number(account.openInvoiceCount)),
    total_amount_due: money(Number(account.totalAmountDueCents), String(context.invoice.currency)),
    total_amount_due_spoken: formatOutboundMoneySpoken(
      Number(account.totalAmountDueCents),
      String(context.invoice.currency),
    ),
    call_purpose: selectedDemoMode,
    demo_call_mode: selectedDemoMode,
    callback_scheduled_for_spoken: followupTask
      ? formatOutboundDateTime(
          String(followupTask.scheduled_for || ""),
          String(followupTask.callback_timezone || context.customer.timezone || context.business.default_timezone),
          "the requested time",
        )
      : "",
    oldest_invoice_date_spoken: formatOutboundDateSpoken(String(account.oldestInvoiceDate || ""), ""),
    most_recent_invoice_date_spoken: formatOutboundDateSpoken(String(account.mostRecentInvoiceDate || ""), ""),
    selected_invoice_is_most_recent: String(account.selectedInvoiceIsMostRecent),
    last_payment_date_spoken: formatOutboundDateSpoken(
      String(account.lastPaymentDate || context.customer.imported_last_payment_date || "").slice(0, 10),
      "",
    ),
    previous_call_date_spoken: formatOutboundDateSpoken(String(context.invoice.previous_call_date || ""), ""),
    expected_payment_date_spoken: formatOutboundDateSpoken(String(context.invoice.expected_payment_date || ""), ""),
    inspection_type: inspectionType,
    days_after_inspection_first_call: String(daysAfterInspection),
    very_overdue_threshold_days: String(veryOverdueThreshold),
    very_overdue: String(overdueDays >= veryOverdueThreshold),
    followup_reason: String(context.invoice.followup_reason || ""),
    prior_concern_note: String(context.invoice.prior_concern_note || ""),
    preferred_payment_method: preferredPaymentMethod,
    customer_phone_spoken: formatOutboundPhoneSpoken(effectivePhoneNumber),
    customer_phone_spoken_chunked: formatOutboundPhoneSpokenChunked(effectivePhoneNumber),
    customer_email: preferredEmail,
    customer_email_display: preferredEmail,
    customer_email_spoken: formatOutboundEmailSpoken(preferredEmail),
    customer_email_spoken_slow: formatOutboundEmailSpokenSlow(preferredEmail),
    customer_email_spoken_phonetic: formatOutboundEmailSpokenPhonetic(preferredEmail),
    email_on_file: String(Boolean(preferredEmail)),
    mailing_instructions_available: String(Boolean(context.business.payment_mailing_instructions)),
    payment_mailing_instructions: String(context.business.payment_mailing_instructions || ""),
    payment_provider: paymentProvider,
    quickbooks_connected: String(quickBooksConnected),
    sms_effective: String(runtime.smsEffective),
    manual_payment_followup_required: String(
      paymentProvider === "manual" ||
        paymentProvider === "quickbooks_read_only" ||
        (["quickbooks", "quickbooks_payment_link_enabled"].includes(paymentProvider) && !quickBooksConnected),
    ),
  };

  try {
    const call = await getRetellClient().call.createPhoneCall({
      from_number: env.RETELL_FROM_NUMBER,
      to_number: effectivePhoneNumber,
      override_agent_id: selectedAgent.agentId,
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
    if (demoCallAuthorizationId) {
      await touchOutboundDemoCallAuthorization(demoCallAuthorizationId);
      await insertOutboundEvent({
        business_id: String(context.business.id),
        customer_id: String(context.customer.id),
        invoice_id: String(context.invoice.id),
        event_type: "demo_call_start_submitted",
        source: "admin",
        payload: {
          demo_call_authorization_id: demoCallAuthorizationId,
          destination_phone_number: effectivePhoneNumber,
          demo_call_mode: selectedDemoMode,
          agent_variant: selectedAgent.variant,
          agent_id: selectedAgent.agentId,
          call_id: call.call_id,
        },
      });
    }
    return {
      call_id: call.call_id,
      status: call.call_status,
      attempt_id: attempt.id,
      after_hours_override_used: eligibility.override_used,
      agent_variant: selectedAgent.variant,
      agent_label: selectedAgent.label,
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
