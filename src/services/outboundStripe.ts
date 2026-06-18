export type OutboundStripeMetadataInput = {
  internalInvoiceId: string;
  invoiceId: string;
  customerId: string;
  businessId: string;
  businessName: string;
};

export function buildOutboundStripeMetadata(input: OutboundStripeMetadataInput): Record<string, string> {
  return {
    internal_invoice_id: input.internalInvoiceId,
    invoice_id: input.invoiceId,
    customer_id: input.customerId,
    business_id: input.businessId,
    business_name: input.businessName,
  };
}

type CheckoutSessionLike = {
  id?: unknown;
  amount_total?: unknown;
  currency?: unknown;
  payment_status?: unknown;
  payment_intent?: unknown;
  metadata?: unknown;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseCompletedCheckoutSession(
  session: CheckoutSessionLike,
  invoice: { amount_due_cents: number; currency: string },
):
  | {
      ok: true;
      value: {
        sessionId: string;
        paymentIntentId: string | null;
        internalInvoiceId: string;
        customerId: string;
        businessId: string;
        invoiceId: string;
      };
    }
  | { ok: false; reason: string } {
  const metadata = session.metadata;
  if (!metadata || typeof metadata !== "object") return { ok: false, reason: "missing_metadata" };
  const values = metadata as Record<string, unknown>;
  for (const key of ["internal_invoice_id", "customer_id", "business_id"]) {
    if (typeof values[key] !== "string" || !UUID_PATTERN.test(values[key])) {
      return { ok: false, reason: `invalid_${key}` };
    }
  }
  if (typeof values.invoice_id !== "string" || typeof values.business_name !== "string") {
    return { ok: false, reason: "incomplete_metadata" };
  }
  if (session.payment_status !== "paid") return { ok: false, reason: "session_not_paid" };
  if (session.amount_total !== invoice.amount_due_cents) return { ok: false, reason: "amount_mismatch" };
  if (session.currency !== invoice.currency) return { ok: false, reason: "currency_mismatch" };
  if (typeof session.id !== "string") return { ok: false, reason: "missing_session_id" };
  return {
    ok: true,
    value: {
      sessionId: session.id,
      paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
      internalInvoiceId: values.internal_invoice_id as string,
      customerId: values.customer_id as string,
      businessId: values.business_id as string,
      invoiceId: values.invoice_id,
    },
  };
}

type StripeClient = InstanceType<typeof Stripe>;
let stripeClient: StripeClient | null = null;

export function getOutboundStripeClient(): StripeClient {
  if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is required");
  stripeClient ??= new Stripe(env.STRIPE_SECRET_KEY);
  return stripeClient;
}

export async function createOutboundCheckoutSession(invoiceId: string, sentVia = "admin") {
  const context = await getOutboundInvoiceContext(invoiceId);
  const invoice = context.invoice;
  const customer = context.customer;
  const business = context.business;
  if (!["unpaid", "payment_link_sent"].includes(String(invoice.status))) {
    throw new Error("Checkout Sessions are only available for outstanding invoices");
  }

  const active = await getActiveOutboundPaymentLink(invoiceId);
  if (active?.url) return { reused: true, payment_link: active };

  const metadata = buildOutboundStripeMetadata({
    internalInvoiceId: String(invoice.id),
    invoiceId: String(invoice.invoice_id),
    customerId: String(customer.id),
    businessId: String(business.id),
    businessName: String(business.business_name),
  });
  const idempotencyKey = randomUUID();
  const record = await createOutboundPaymentLinkRecord({
    customer_id: customer.id,
    invoice_id: invoice.id,
    business_id: business.id,
    idempotency_key: idempotencyKey,
    amount_cents: invoice.amount_due_cents,
    currency: invoice.currency,
    status: "creating",
    sent_via: sentVia,
  });

  try {
    const baseUrl = env.APP_BASE_URL.replace(/\/$/, "");
    if (!baseUrl) throw new Error("APP_BASE_URL is required");
    const session = await getOutboundStripeClient().checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: String(invoice.currency),
              unit_amount: Number(invoice.amount_due_cents),
              product_data: {
                name: `${String(business.business_name)} invoice ${String(invoice.invoice_id)}`,
                description: String(invoice.service_description),
              },
            },
          },
        ],
        metadata,
        payment_intent_data: { metadata },
        customer_email: typeof customer.email === "string" && customer.email ? customer.email : undefined,
        success_url: `${baseUrl}/outbound/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/outbound/payment/cancelled`,
        expires_at: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
      },
      { idempotencyKey },
    );
    const saved = await updateOutboundPaymentLinkRecord(String(record.id), {
      stripe_checkout_session_id: session.id,
      url: session.url,
      status: "open",
      expires_at: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
    });
    await updateOutboundInvoice(invoiceId, { status: "payment_link_sent" });
    return { reused: false, payment_link: saved };
  } catch (error) {
    await updateOutboundPaymentLinkRecord(String(record.id), { status: "failed" });
    throw error;
  }
}
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { env } from "../config/env";
import {
  createOutboundPaymentLinkRecord,
  getActiveOutboundPaymentLink,
  getOutboundInvoiceContext,
  updateOutboundInvoice,
  updateOutboundPaymentLinkRecord,
} from "./outboundRepository";
