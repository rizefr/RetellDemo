import express from "express";
import { env } from "../config/env";
import {
  logOutcomeArgsSchema,
  retellToolEnvelopeSchema,
  scheduleFollowupArgsSchema,
} from "../schemas/outboundSchemas";
import { buildBaselineFollowups } from "../services/outboundFollowups";
import { applyOutcomePolicy } from "../services/outboundOutcomes";
import {
  getOutboundInvoiceContext,
  hasOutboundPaymentLinkAgreement,
  insertOutboundEvent,
  insertOutboundFollowups,
  recordOutboundOutcome,
} from "../services/outboundRepository";
import { trustedRetellMetadata, verifyOutboundRetellSignature } from "../services/outboundRetell";
import { createOutboundCheckoutSession } from "../services/outboundStripe";

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
  const envelope = retellToolEnvelopeSchema.parse({ ...parsedBody, args: argsFromToolBody(parsedBody) });
  const metadata = trustedRetellMetadata(envelope.call);
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
    const { metadata } = await trustedEnvelope(req);
    const agreed = await hasOutboundPaymentLinkAgreement(metadata.invoiceId);
    if (!agreed) {
      return {
        sent: false,
        status: "blocked_no_payment_link_agreement",
        message_for_agent: "Do not send or claim a text. The callee has not agreed to receive a payment link.",
      };
    }
    await insertOutboundEvent({
      business_id: metadata.businessId,
      customer_id: metadata.customerId,
      invoice_id: metadata.invoiceId,
      event_type: "sms_pending_manual",
      source: "retell_function",
      payload: {
        reason: env.OUTBOUND_RETELL_SMS_ENABLED
          ? "SMS provider path is not verified for this outbound number/chat agent"
          : "OUTBOUND_RETELL_SMS_ENABLED is false",
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
    const tasks = await insertOutboundFollowups(
      {
        businessId: metadata.businessId,
        customerId: metadata.customerId,
        invoiceId: metadata.invoiceId,
      },
      buildBaselineFollowups(new Date().toISOString(), String(context.customer.timezone), 1).map((task) => ({
        ...task,
        reason: `${task.reason}:${args.reason}`,
      })),
    );
    return { scheduled: true, task_count: tasks.length };
  }),
);
