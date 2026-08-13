import express from "express";
import { DateTime } from "luxon";
import { env } from "../config/env";
import {
  logOutcomeArgsSchema,
  retellToolEnvelopeSchema,
  scheduleFollowupArgsSchema,
  scheduleCallbackArgsSchema,
  inboundAccountLookupArgsSchema,
} from "../schemas/outboundSchemas";
import { buildBaselineFollowups, nextEligibleOutboundTime } from "../services/outboundFollowups";
import { applyOutcomePolicy } from "../services/outboundOutcomes";
import {
  getOutboundInvoiceContext,
  hasOutboundPaymentLinkAgreement,
  insertOutboundEvent,
  insertOutboundFollowups,
  recordOutboundOutcome,
  createOutboundCallbackTask,
  updateOutboundCustomer,
  updateOutboundInvoice,
  createOutboundCallAttempt,
  findInboundCollectionsCandidates,
  findOutboundCallAttempt,
  getOutboundBusinessSettings,
  nextOutboundAttemptNumber,
} from "../services/outboundRepository";
import {
  trustedInboundRetellBusinessMetadata,
  resolveTrustedRetellMetadata,
  verifyOutboundRetellSignature,
} from "../services/outboundRetell";
import { createOutboundCheckoutSession } from "../services/outboundStripe";
import { sendOutboundPaymentEmailForInvoice } from "../services/outboundEmail";
import { resolveOutboundCallback } from "../services/outboundCallbacks";
import { outboundBusinessRuntimeSettings } from "../services/outboundRuntimeSettings";
import { resolveOutboundExpectedPaymentDate } from "../services/outboundExpectedPaymentDate";
import { chooseInboundCollectionsMatch } from "../services/outboundInboundCollections";
import {
  formatOutboundDateSpoken,
  formatOutboundEmailSpokenSlow,
  formatOutboundInvoiceIdSpoken,
  formatOutboundMoneySpoken,
  formatOutboundNameSpoken,
  formatOutboundPhoneSpokenChunked,
} from "../services/outboundFormatting";

export const outboundRetellToolsRouter = express.Router();

function argsFromToolBody(body: Record<string, unknown>): Record<string, unknown> {
  if (body.args && typeof body.args === "object" && !Array.isArray(body.args)) {
    return body.args as Record<string, unknown>;
  }
  const { name: _name, call: _call, ...rootArgs } = body;
  return rootArgs;
}

async function trustedEnvelope(req: express.Request) {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  const signature = typeof req.headers["x-retell-signature"] === "string" ? req.headers["x-retell-signature"] : "";
  if (!(await verifyOutboundRetellSignature(raw, signature))) {
    throw Object.assign(new Error("Invalid Retell signature"), { status: 401 });
  }
  const parsedBody = JSON.parse(raw) as Record<string, unknown>;
  if (!parsedBody.call || typeof parsedBody.call !== "object" || Array.isArray(parsedBody.call)) {
    throw Object.assign(new Error("Missing trusted Retell call metadata"), { status: 422 });
  }
  const envelope = retellToolEnvelopeSchema.parse({ ...parsedBody, args: argsFromToolBody(parsedBody) });
  const metadata = await resolveTrustedRetellMetadata(envelope.call);
  if (!metadata) throw Object.assign(new Error("Missing trusted Retell call metadata"), { status: 422 });
  const context = await getOutboundInvoiceContext(metadata.invoiceId);
  if (context.customer.id !== metadata.customerId || context.business.id !== metadata.businessId) {
    throw Object.assign(new Error("Retell metadata does not match database records"), { status: 422 });
  }
  return { envelope, metadata, context };
}

function tool(handler: (req: express.Request) => Promise<Record<string, unknown>>) {
  return async (req: express.Request, res: express.Response) => {
    try {
      res.json(await handler(req));
    } catch (error) {
      const status =
        typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 400;
      res.status(status).json({ error: error instanceof Error ? error.message : "Retell tool failed" });
    }
  };
}

outboundRetellToolsRouter.post(
  "/lookup-inbound-account",
  tool(async (req) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    const signature = typeof req.headers["x-retell-signature"] === "string" ? req.headers["x-retell-signature"] : "";
    if (!(await verifyOutboundRetellSignature(raw, signature))) {
      throw Object.assign(new Error("Invalid Retell signature"), { status: 401 });
    }
    const parsedBody = JSON.parse(raw) as Record<string, unknown>;
    const envelope = retellToolEnvelopeSchema.parse({ ...parsedBody, args: argsFromToolBody(parsedBody) });
    const inbound = trustedInboundRetellBusinessMetadata(envelope.call);
    if (!inbound) throw Object.assign(new Error("Missing trusted inbound Retell metadata"), { status: 422 });
    const business = await getOutboundBusinessSettings(inbound.businessId);
    if (String(business.inbound_retell_agent_id || "") !== inbound.agentId) {
      throw Object.assign(new Error("Inbound Retell agent does not match business configuration"), { status: 422 });
    }
    const args = inboundAccountLookupArgsSchema.parse(envelope.args);
    const fromNumber = String(envelope.call.from_number || "");
    const toNumber = String(envelope.call.to_number || "");
    const candidates = await findInboundCollectionsCandidates({
      businessId: inbound.businessId,
      firstName: args.first_name,
      lastName: args.last_name,
      callingPhoneNumber: fromNumber,
      accountCompanyName: args.account_company_name,
      email: args.email,
    });
    const match = chooseInboundCollectionsMatch(candidates, {
      firstName: args.first_name,
      lastName: args.last_name,
      callingPhoneNumber: fromNumber,
      accountCompanyName: args.account_company_name,
      email: args.email,
      invoiceId: args.invoice_id,
    });
    if (match.status !== "verified") {
      await insertOutboundEvent({
        business_id: inbound.businessId,
        event_type: "inbound_account_lookup_unverified",
        source: "retell_function",
        payload: {
          status: match.status,
          call_id: inbound.callId,
          supplied_last_name: Boolean(args.last_name),
          supplied_company: Boolean(args.account_company_name),
          supplied_email: Boolean(args.email),
          supplied_invoice_id: Boolean(args.invoice_id),
        },
      });
      return {
        status: match.status,
        verified: false,
        message_for_agent:
          match.status === "not_found"
            ? "Ask once for the spelling of the caller's first and last name. Do not disclose invoice details."
            : "Ask for exactly one safe corroborator: company/account name, invoice number, or email on the account. Do not disclose invoice details.",
      };
    }

    const context = await getOutboundInvoiceContext(match.candidate.invoiceId);
    if (
      String(context.business.id) !== inbound.businessId ||
      String(context.customer.id) !== match.candidate.customerId
    ) {
      throw Object.assign(new Error("Verified inbound match does not map to the configured business"), { status: 422 });
    }
    let attempt = await findOutboundCallAttempt(inbound.callId);
    if (!attempt) {
      const attemptNumber = await nextOutboundAttemptNumber(match.candidate.invoiceId);
      const started = Number(envelope.call.start_timestamp);
      attempt = await createOutboundCallAttempt({
        business_id: inbound.businessId,
        customer_id: match.candidate.customerId,
        invoice_id: match.candidate.invoiceId,
        retell_call_id: inbound.callId,
        attempt_number: attemptNumber,
        direction: "inbound",
        from_number: fromNumber,
        to_number: toNumber,
        status: "ongoing",
        started_at: Number.isFinite(started) && started > 0 ? new Date(started).toISOString() : new Date().toISOString(),
      });
    }
    await insertOutboundEvent({
      business_id: inbound.businessId,
      customer_id: match.candidate.customerId,
      invoice_id: match.candidate.invoiceId,
      event_type: "inbound_account_verified",
      source: "retell_function",
      external_event_id: `inbound_account_verified:${inbound.callId}`,
      payload: { call_attempt_id: attempt.id, verification: "name_plus_trusted_corroborator" },
    });
    const inspectionDate = String(context.invoice.inspection_date || context.invoice.original_due_date || "");
    const email = String(context.customer.preferred_email || context.customer.email || "");
    return {
      status: "verified",
      verified: true,
      call_attempt_id: attempt.id,
      customer_first_name: String(context.customer.first_name || ""),
      customer_first_name_spoken: formatOutboundNameSpoken(String(context.customer.first_name || "")),
      customer_last_name: String(context.customer.last_name || ""),
      customer_last_name_spoken: formatOutboundNameSpoken(String(context.customer.last_name || "")),
      account_company_name: String(context.customer.account_company_name || ""),
      account_company_name_spoken: formatOutboundNameSpoken(String(context.customer.account_company_name || "")),
      inspection_type: String(context.invoice.inspection_type || context.business.default_inspection_type || "Category 1"),
      inspection_date_spoken: formatOutboundDateSpoken(inspectionDate),
      original_due_date_spoken: formatOutboundDateSpoken(String(context.invoice.original_due_date || "")),
      amount_due_spoken: formatOutboundMoneySpoken(
        Number(context.invoice.amount_due_cents || 0),
        String(context.invoice.currency || "usd"),
      ),
      invoice_id_spoken: formatOutboundInvoiceIdSpoken(String(context.invoice.invoice_id || "")),
      customer_email_spoken_slow: formatOutboundEmailSpokenSlow(email),
      customer_phone_spoken_chunked: formatOutboundPhoneSpokenChunked(String(context.customer.phone_number || "")),
      payment_provider: String(context.business.payment_provider || "stripe"),
      expected_payment_date_spoken: formatOutboundDateSpoken(String(context.invoice.expected_payment_date || ""), ""),
      message_for_agent: "The caller is verified. Continue with the invoice-received question without restarting the introduction.",
    };
  }),
);

outboundRetellToolsRouter.post(
  "/log-outcome",
  tool(async (req) => {
    const { envelope, metadata } = await trustedEnvelope(req);
    const args = logOutcomeArgsSchema.parse(envelope.args);
    const policy = applyOutcomePolicy(args.outcome);
    await recordOutboundOutcome({
      callAttemptId: metadata.callAttemptId,
      invoiceId: metadata.invoiceId,
      customerId: metadata.customerId,
      outcome: args.outcome,
      notes: args.notes,
      pauseOutreach: policy.pauseOutreach,
      invoiceStatus: policy.invoiceStatus,
    });
    if (args.outcome === "responsible_party_update_requested") {
      await updateOutboundCustomer(metadata.customerId, {
        responsible_party_name: args.responsible_party_name || null,
        responsible_party_phone: args.responsible_party_phone || null,
        responsible_party_email: args.responsible_party_email || null,
        responsible_party_note: args.notes || null,
        contact_update_note: args.notes || null,
      });
    }
    if (args.outcome === "named_contact_requested") {
      await updateOutboundCustomer(metadata.customerId, {
        named_contact_requested: args.named_contact_name || args.notes || null,
        contact_update_note: args.notes || null,
      });
    }
    if ([
      "service_issue_reported",
      "mail_check_requested",
      "mail_instructions_requested",
      "responsible_party_update_requested",
      "named_contact_requested",
    ].includes(args.outcome)) {
      const context = await getOutboundInvoiceContext(metadata.invoiceId);
      await insertOutboundFollowups(
        { businessId: metadata.businessId, customerId: metadata.customerId, invoiceId: metadata.invoiceId },
        [{
          task_type: "manual_review",
          scheduled_for: nextEligibleOutboundTime(new Date().toISOString(), 1, String(context.customer.timezone)),
          status: "pending",
          attempt_number: 1,
          reason: args.outcome,
        }],
      );
    }
    return { logged: true, outcome: args.outcome, outreach_paused: policy.pauseOutreach };
  }),
);

outboundRetellToolsRouter.post(
  "/create-payment-link",
  tool(async (req) => {
    const { metadata } = await trustedEnvelope(req);
    const result = await createOutboundCheckoutSession(metadata.invoiceId, "manual");
    return { created: !result.reused, reused: result.reused, url: result.payment_link.url };
  }),
);

outboundRetellToolsRouter.post(
  "/send-payment-sms",
  tool(async (req) => {
    const { metadata, context } = await trustedEnvelope(req);
    const agreed = await hasOutboundPaymentLinkAgreement(metadata.invoiceId);
    if (!agreed) {
      return {
        sent: false,
        status: "blocked_no_payment_link_agreement",
        message_for_agent: "Do not send or claim a text. The callee has not agreed to receive a payment link.",
      };
    }
    const runtime = outboundBusinessRuntimeSettings(context.business);
    await updateOutboundCustomer(metadata.customerId, { payment_contact_preference: "sms" });
    await insertOutboundEvent({
      business_id: metadata.businessId,
      customer_id: metadata.customerId,
      invoice_id: metadata.invoiceId,
      event_type: "sms_pending_manual",
      source: "retell_function",
      payload: {
        reason: runtime.smsEffective
          ? "SMS provider path is not implemented for this demo"
          : runtime.smsProviderReady
            ? "Business SMS setting is disabled"
            : "Retell SMS capability is not configured",
      },
    });
    return {
      sent: false,
      status: "sms_pending_manual",
      message_for_agent: "The text was not sent. Say the team will follow up; do not claim SMS success.",
    };
  }),
);

outboundRetellToolsRouter.post(
  "/schedule-callback",
  tool(async (req) => {
    const { envelope, metadata, context } = await trustedEnvelope(req);
    const args = scheduleCallbackArgsSchema.parse(envelope.args);
    if (context.invoice.status === "paid" || context.customer.outreach_paused) {
      return {
        scheduled: false,
        needs_confirmation: false,
        reason: context.invoice.status === "paid" ? "invoice_paid" : "outreach_paused",
        message_for_agent: "Do not schedule another callback. Say the team will review the account.",
      };
    }
    const started = Number(envelope.call.start_timestamp);
    const resolution = resolveOutboundCallback({
      datePhrase: args.date_phrase,
      timePhrase: args.time_phrase,
      timezone: String(context.customer.timezone || context.business.default_timezone || "America/New_York"),
      referenceTime: Number.isFinite(started) && started > 0 ? new Date(started) : new Date(),
      rules:
        context.business.callback_rules && typeof context.business.callback_rules === "object"
          ? (context.business.callback_rules as Record<string, string>)
          : undefined,
    });
    if (!resolution.ok) {
      return {
        scheduled: false,
        needs_confirmation: true,
        reason: resolution.reason,
        message_for_agent: resolution.message,
      };
    }
    if (!args.confirmed) {
      return {
        scheduled: false,
        needs_confirmation: true,
        scheduled_for: resolution.scheduledFor,
        scheduled_for_spoken: resolution.scheduledForSpoken,
        message_for_agent: `Ask the caller to confirm ${resolution.scheduledForSpoken}.`,
      };
    }
    if (!args.confirmation_text.trim()) {
      return {
        scheduled: false,
        needs_confirmation: true,
        scheduled_for_spoken: resolution.scheduledForSpoken,
        message_for_agent: "Repeat the callback date and time and obtain confirmation before storing it.",
      };
    }
    const task = await createOutboundCallbackTask({
      businessId: metadata.businessId,
      customerId: metadata.customerId,
      invoiceId: metadata.invoiceId,
      scheduledFor: resolution.scheduledFor,
      timezone: resolution.timezone,
      reason: args.reason,
      confirmationText: args.confirmation_text,
      sourceCallAttemptId: metadata.callAttemptId,
      sourceRetellCallId: String(envelope.call.call_id || ""),
    });
    const policy = applyOutcomePolicy("callback_scheduled");
    await recordOutboundOutcome({
      callAttemptId: metadata.callAttemptId,
      invoiceId: metadata.invoiceId,
      customerId: metadata.customerId,
      outcome: "callback_scheduled",
      notes: `${args.reason}: ${resolution.scheduledForSpoken}`,
      pauseOutreach: policy.pauseOutreach,
      invoiceStatus: policy.invoiceStatus,
    });
    await insertOutboundEvent({
      business_id: metadata.businessId,
      customer_id: metadata.customerId,
      invoice_id: metadata.invoiceId,
      event_type: "callback_scheduled",
      source: "retell_function",
      payload: { task_id: task.id, scheduled_for: resolution.scheduledFor, timezone: resolution.timezone },
    });
    return {
      scheduled: true,
      needs_confirmation: false,
      task_id: task.id,
      scheduled_for: resolution.scheduledFor,
      scheduled_for_spoken: resolution.scheduledForSpoken,
      message_for_agent: `Confirm the callback for ${resolution.scheduledForSpoken}, then end the call.`,
    };
  }),
);

outboundRetellToolsRouter.post(
  "/send-payment-email",
  tool(async (req) => {
    const { metadata } = await trustedEnvelope(req);
    return sendOutboundPaymentEmailForInvoice(metadata.invoiceId);
  }),
);

outboundRetellToolsRouter.post(
  "/request-human-transfer",
  tool(async (req) => {
    const { metadata, context } = await trustedEnvelope(req);
    const transferNumber = String(context.business.human_transfer_number || env.HUMAN_TRANSFER_NUMBER || "");
    if (!transferNumber) {
      await insertOutboundEvent({
        business_id: metadata.businessId,
        customer_id: metadata.customerId,
        invoice_id: metadata.invoiceId,
        event_type: "human_requested",
        source: "retell_function",
      });
      return { transfer_available: false, outcome: "human_requested" };
    }
    return { transfer_available: true, transfer_number: transferNumber };
  }),
);

outboundRetellToolsRouter.post(
  "/schedule-followup",
  tool(async (req) => {
    const { envelope, metadata, context } = await trustedEnvelope(req);
    const args = scheduleFollowupArgsSchema.parse(envelope.args);
    if (context.invoice.status === "paid" || context.customer.outreach_paused) {
      return { scheduled: false, reason: context.invoice.status === "paid" ? "invoice_paid" : "outreach_paused" };
    }
    let expectedPaymentDate: string | null = null;
    let expectedPaymentDateSpoken: string | null = null;
    let followupBase = new Date().toISOString();
    const timezone = String(context.customer.timezone || context.business.default_timezone || "America/New_York");
    if (args.expected_payment_date_phrase) {
      const started = Number(envelope.call.start_timestamp);
      const resolution = resolveOutboundExpectedPaymentDate({
        datePhrase: args.expected_payment_date_phrase,
        timezone,
        referenceTime: Number.isFinite(started) && started > 0 ? new Date(started) : new Date(),
      });
      if (!resolution.ok) {
        return {
          scheduled: false,
          needs_clarification: true,
          reason: resolution.reason,
          message_for_agent: resolution.message,
        };
      }
      expectedPaymentDate = resolution.expectedPaymentDate;
      expectedPaymentDateSpoken = resolution.expectedPaymentDateSpoken;
      followupBase = DateTime.fromISO(expectedPaymentDate, { zone: resolution.timezone })
        .set({ hour: 12 })
        .toUTC()
        .toISO() as string;
      await updateOutboundInvoice(metadata.invoiceId, { expected_payment_date: expectedPaymentDate });
      await insertOutboundEvent({
        business_id: metadata.businessId,
        customer_id: metadata.customerId,
        invoice_id: metadata.invoiceId,
        event_type: "expected_payment_date_recorded",
        source: "retell_function",
        payload: {
          expected_payment_date: expectedPaymentDate,
          timezone: resolution.timezone,
          call_attempt_id: metadata.callAttemptId || null,
        },
      });
    }
    const tasks = await insertOutboundFollowups(
      {
        businessId: metadata.businessId,
        customerId: metadata.customerId,
        invoiceId: metadata.invoiceId,
      },
      buildBaselineFollowups(followupBase, timezone, 1).map((task) => ({
        ...task,
        reason: `${task.reason}:${args.reason}`,
      })),
    );
    return {
      scheduled: true,
      needs_clarification: false,
      task_count: tasks.length,
      expected_payment_date: expectedPaymentDate,
      expected_payment_date_spoken: expectedPaymentDateSpoken,
    };
  }),
);
