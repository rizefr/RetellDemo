import express from "express";
import { buildOutboundCallAttemptPatch } from "../services/outboundCallAnalysis";
import { buildBaselineFollowups } from "../services/outboundFollowups";
import { applyOutcomePolicy, type OutboundOutcome } from "../services/outboundOutcomes";
import {
  findOutboundCallAttempt,
  getOutboundInvoiceContext,
  insertOutboundEvent,
  insertOutboundFollowups,
  recordOutboundOutcome,
  updateOutboundCallAttempt,
  completeOutboundCallbackForAttempt,
  getOutboundBusinessByCallbackNumber,
} from "../services/outboundRepository";
import { formatOutboundNameSpoken } from "../services/outboundFormatting";
import {
  resolveTrustedRetellMetadata,
  verifiedInboundRetellBusinessMetadata,
  verifyOutboundRetellSignature,
} from "../services/outboundRetell";

export const outboundRetellWebhookRouter = express.Router();

function automaticOutcome(call: Record<string, unknown>): OutboundOutcome | null {
  if (call.disconnection_reason === "voicemail_reached") return "voicemail_message_left";
  if (["dial_no_answer", "dial_busy", "user_declined"].includes(String(call.disconnection_reason))) return "no_answer";
  return null;
}

outboundRetellWebhookRouter.post("/inbound-call", async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  const signature = typeof req.headers["x-retell-signature"] === "string" ? req.headers["x-retell-signature"] : "";
  if (!(await verifyOutboundRetellSignature(raw, signature))) {
    res.status(401).json({ error: "Invalid Retell signature" });
    return;
  }
  try {
    const payload = JSON.parse(raw) as {
      event?: string;
      call_inbound?: { from_number?: unknown; to_number?: unknown };
    };
    if (payload.event !== "call_inbound") {
      res.status(422).json({ error: "Expected call_inbound event" });
      return;
    }
    const fromNumber = String(payload.call_inbound?.from_number || "");
    const toNumber = String(payload.call_inbound?.to_number || "");
    if (!/^\+[1-9]\d{7,14}$/.test(fromNumber) || !/^\+[1-9]\d{7,14}$/.test(toNumber)) {
      res.status(422).json({ error: "Inbound phone numbers must use E.164 format" });
      return;
    }
    const business = await getOutboundBusinessByCallbackNumber(toNumber);
    const inboundAgentId = String(business.inbound_retell_agent_id || "");
    if (!inboundAgentId || !business.inbound_retell_conversation_flow_id) {
      res.status(503).json({ error: "Inbound collections agent is not configured for this number" });
      return;
    }
    await insertOutboundEvent({
      business_id: String(business.id),
      event_type: "inbound_call_routed",
      source: "retell_inbound_webhook",
      payload: { from_number: fromNumber, to_number: toNumber },
    });
    const businessName = String(business.business_name || "Elixis Elevator Systems");
    res.json({
      call_inbound: {
        override_agent_id: inboundAgentId,
        override_agent_version: "latest_published",
        dynamic_variables: {
          business_name: businessName,
          business_name_spoken: formatOutboundNameSpoken(businessName),
          agent_display_name: String(business.agent_display_name || "Paul"),
          business_callback_number: toNumber,
        },
        metadata: {
          business_id: String(business.id),
          direction: "inbound_collections",
        },
      },
    });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number"
      ? error.status
      : 400;
    res.status(status).json({ error: error instanceof Error ? error.message : "Inbound Retell routing failed" });
  }
});

outboundRetellWebhookRouter.post("/", async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  const signature = typeof req.headers["x-retell-signature"] === "string" ? req.headers["x-retell-signature"] : "";
  if (!(await verifyOutboundRetellSignature(raw, signature))) {
    res.status(401).json({ error: "Invalid Retell signature" });
    return;
  }

  try {
    const payload = JSON.parse(raw) as {
      event?: string;
      call?: Record<string, unknown>;
      transcript_with_tool_calls?: unknown[];
    };
    const call: Record<string, unknown> = {
      ...(payload.call ?? {}),
      ...(Array.isArray(payload.transcript_with_tool_calls)
        ? { transcript_with_tool_calls: payload.transcript_with_tool_calls }
        : {}),
    };
    const callId = typeof call.call_id === "string" ? call.call_id : "";
    const metadata = await resolveTrustedRetellMetadata(call);
    if (!callId) {
      res.status(422).json({ error: "Retell call ID is missing" });
      return;
    }
    if (!metadata) {
      const inbound = await verifiedInboundRetellBusinessMetadata(call);
      if (!inbound) {
        res.status(422).json({ error: "Retell call metadata is missing trusted collections IDs" });
        return;
      }
      await insertOutboundEvent({
        business_id: inbound.businessId,
        event_type: payload.event ?? "retell_webhook",
        source: "retell",
        external_event_id: ["call_started", "call_ended", "call_analyzed"].includes(payload.event ?? "")
          ? `${payload.event}:${callId}`
          : null,
        payload,
      });
      res.json({ received: true, event_type: payload.event ?? "unknown", identity_pending: true });
      return;
    }
    const attempt = await findOutboundCallAttempt(callId);
    if (attempt) {
      const context = await getOutboundInvoiceContext(metadata.invoiceId);
      const patch = buildOutboundCallAttemptPatch(call, {
        serviceDescription: String(context.invoice.service_description),
        invoiceNumber: String(context.invoice.invoice_id),
      });
      if (Object.keys(patch).length) await updateOutboundCallAttempt(String(attempt.id), patch);
      if (payload.event === "call_ended" && attempt.direction === "outbound") {
        await completeOutboundCallbackForAttempt(String(attempt.id));
      }
    }
    await insertOutboundEvent({
      business_id: metadata.businessId,
      customer_id: metadata.customerId,
      invoice_id: metadata.invoiceId,
      event_type: payload.event ?? "retell_webhook",
      source: "retell",
      external_event_id: ["call_started", "call_ended", "call_analyzed"].includes(payload.event ?? "")
        ? `${payload.event}:${callId}`
        : null,
      payload,
    });

    const outcome = attempt?.direction === "inbound" ? null : automaticOutcome(call);
    if (outcome) {
      const policy = applyOutcomePolicy(outcome);
      await recordOutboundOutcome({
        callAttemptId: metadata.callAttemptId,
        invoiceId: metadata.invoiceId,
        customerId: metadata.customerId,
        outcome,
        notes: String(call.disconnection_reason ?? ""),
        pauseOutreach: policy.pauseOutreach,
        invoiceStatus: policy.invoiceStatus,
      });
      if (policy.scheduleFollowups) {
        const context = await getOutboundInvoiceContext(metadata.invoiceId);
        if (context.invoice.status !== "paid" && !context.customer.outreach_paused) {
          await insertOutboundFollowups(
            {
              businessId: metadata.businessId,
              customerId: metadata.customerId,
              invoiceId: metadata.invoiceId,
            },
            buildBaselineFollowups(
              new Date().toISOString(),
              String(context.customer.timezone),
              Number(attempt?.attempt_number ?? 1),
            ),
          );
        }
      }
    }
    res.json({ received: true, event_type: payload.event ?? "unknown" });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Retell webhook failed" });
  }
});
