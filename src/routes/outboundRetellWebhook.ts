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
} from "../services/outboundRepository";
import { trustedRetellMetadata, verifyOutboundRetellSignature } from "../services/outboundRetell";

export const outboundRetellWebhookRouter = express.Router();

function automaticOutcome(call: Record<string, unknown>): OutboundOutcome | null {
  if (call.disconnection_reason === "voicemail_reached") return "voicemail_detected_no_message";
  if (["dial_no_answer", "dial_busy", "user_declined"].includes(String(call.disconnection_reason))) return "no_answer";
  return null;
}

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
    const metadata = trustedRetellMetadata(call);
    if (!metadata || !callId) {
      res.status(422).json({ error: "Retell call metadata is missing trusted outbound IDs" });
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
      if (payload.event === "call_ended") await completeOutboundCallbackForAttempt(String(attempt.id));
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

    const outcome = automaticOutcome(call);
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
