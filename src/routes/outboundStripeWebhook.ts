import express from "express";
import { env } from "../config/env";
import {
  getOutboundInvoiceForPayment,
  markOutboundInvoicePaid,
} from "../services/outboundRepository";
import {
  getOutboundStripeClient,
  parseCompletedCheckoutSession,
} from "../services/outboundStripe";

export const outboundStripeWebhookRouter = express.Router();

outboundStripeWebhookRouter.post("/", async (req, res) => {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    res.status(503).json({ error: "STRIPE_WEBHOOK_SECRET is not configured" });
    return;
  }
  const signature = req.headers["stripe-signature"];
  if (typeof signature !== "string" || !Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: "Missing Stripe signature or raw body" });
    return;
  }

  try {
    const event = getOutboundStripeClient().webhooks.constructEvent(req.body, signature, env.STRIPE_WEBHOOK_SECRET);
    if (event.type !== "checkout.session.completed") {
      res.json({ received: true, ignored: true });
      return;
    }
    const session = event.data.object;
    const internalInvoiceId = session.metadata?.internal_invoice_id;
    if (!internalInvoiceId) {
      res.status(422).json({ error: "Checkout Session is missing internal invoice metadata" });
      return;
    }
    const invoice = await getOutboundInvoiceForPayment(internalInvoiceId);
    const parsed = parseCompletedCheckoutSession(session, {
      amount_due_cents: Number(invoice.amount_due_cents),
      currency: String(invoice.currency),
    });
    if (!parsed.ok) {
      res.status(422).json({ error: parsed.reason });
      return;
    }
    if (
      parsed.value.customerId !== invoice.customer_id ||
      parsed.value.businessId !== invoice.business_id ||
      parsed.value.invoiceId !== invoice.invoice_id
    ) {
      res.status(422).json({ error: "Checkout metadata does not match the invoice record" });
      return;
    }
    await markOutboundInvoicePaid({
      externalEventId: event.id,
      invoiceId: parsed.value.internalInvoiceId,
      checkoutSessionId: parsed.value.sessionId,
      paymentIntentId: parsed.value.paymentIntentId,
      payload: event,
    });
    res.json({ received: true, paid: true });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Stripe webhook failed" });
  }
});
