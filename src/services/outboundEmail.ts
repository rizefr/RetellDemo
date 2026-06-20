export type OutboundPaymentEmail = {
  to: string;
  from: string;
  businessName: string;
  invoiceNumber: string;
  serviceDescription: string;
  amount: string;
  paymentUrl: string;
  callbackNumber: string;
  dueDate: string;
};

export interface OutboundEmailProvider {
  send(message: OutboundPaymentEmail): Promise<{ id: string }>;
}

export type OutboundEmailDeliveryResult = {
  sent: boolean;
  status: "email_sent" | "email_pending_manual" | "email_failed";
  provider_message_id: string | null;
};

export async function deliverOutboundPaymentEmail(
  message: OutboundPaymentEmail,
  options: { enabled: boolean; providerName: "none" | "resend"; provider: OutboundEmailProvider },
): Promise<OutboundEmailDeliveryResult> {
  if (!options.enabled || options.providerName === "none") {
    return { sent: false, status: "email_pending_manual", provider_message_id: null };
  }
  try {
    const result = await options.provider.send(message);
    return { sent: true, status: "email_sent", provider_message_id: result.id };
  } catch {
    return { sent: false, status: "email_failed", provider_message_id: null };
  }
}

export class ResendOutboundEmailProvider implements OutboundEmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: OutboundPaymentEmail): Promise<{ id: string }> {
    const response = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: message.from,
        to: [message.to],
        subject: `${message.businessName} invoice ${message.invoiceNumber}`,
        text: [
          `${message.businessName} invoice ${message.invoiceNumber}`,
          `Service: ${message.serviceDescription}`,
          `Amount: ${message.amount}`,
          `Original due date: ${message.dueDate}`,
          `Secure payment link: ${message.paymentUrl}`,
          message.callbackNumber ? `Questions: ${message.callbackNumber}` : "",
          "Payment is completed through the secure link, not by phone.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      }),
    });
    if (!response.ok) throw new Error(`Email provider request failed (${response.status})`);
    const body = (await response.json()) as { id?: unknown };
    if (typeof body.id !== "string") throw new Error("Email provider did not return a message ID");
    return { id: body.id };
  }
}

function money(amountCents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountCents / 100);
}

function configuredProvider(): OutboundEmailProvider {
  if (env.EMAIL_PROVIDER === "resend" && env.EMAIL_PROVIDER_API_KEY) {
    return new ResendOutboundEmailProvider(env.EMAIL_PROVIDER_API_KEY);
  }
  return { send: async () => { throw new Error("Email provider is not configured"); } };
}

export async function sendOutboundPaymentEmailForInvoice(invoiceId: string) {
  const context = await getOutboundInvoiceContext(invoiceId);
  const ids = {
    business_id: String(context.business.id),
    customer_id: String(context.customer.id),
    invoice_id: String(context.invoice.id),
  };
  const agreed = await hasOutboundPaymentLinkAgreement(invoiceId);
  if (!agreed) {
    return {
      sent: false,
      status: "blocked_no_payment_link_agreement" as const,
      message_for_agent: "Do not send or claim an email. The callee has not agreed to receive a payment link.",
    };
  }

  await insertOutboundEvent({
    ...ids,
    event_type: "email_requested",
    source: "retell_function",
    payload: { recipient_on_file: Boolean(context.customer.email) },
  });
  const recipient = typeof context.customer.email === "string" ? context.customer.email.trim() : "";
  if (!recipient) {
    await insertOutboundEvent({
      ...ids,
      event_type: "email_missing",
      source: "retell_function",
      payload: { reason: "customer_email_missing" },
    });
    return {
      sent: false,
      status: "email_missing" as const,
      message_for_agent: "The email was not sent. Say the team will follow up with the secure link.",
    };
  }

  const runtime = outboundBusinessRuntimeSettings(context.business);
  await updateOutboundCustomer(String(context.customer.id), { payment_contact_preference: "email" });
  if (
    runtime.testMode &&
    !runtime.emailTestRecipientAllowlist.map((value) => value.toLowerCase()).includes(recipient.toLowerCase())
  ) {
    await insertOutboundEvent({
      ...ids,
      event_type: "email_pending_manual",
      source: "retell_function",
      payload: { reason: "test_recipient_not_allowlisted", provider: env.EMAIL_PROVIDER },
    });
    return {
      sent: false,
      status: "email_pending_manual" as const,
      message_for_agent: "The email was not sent. Say the team will follow up with the secure link.",
    };
  }

  const checkout = await createOutboundCheckoutSession(invoiceId, "email_placeholder");
  const enabled = runtime.emailEffective;
  const result = await deliverOutboundPaymentEmail(
    {
      to: recipient,
      from: runtime.emailFrom,
      businessName: String(context.business.business_name),
      invoiceNumber: String(context.invoice.invoice_id),
      serviceDescription: String(context.invoice.service_description),
      amount: money(Number(context.invoice.amount_due_cents), String(context.invoice.currency)),
      paymentUrl: String(checkout.payment_link.url),
      callbackNumber: String(context.business.callback_number || env.BUSINESS_CALLBACK_NUMBER || ""),
      dueDate: formatOutboundDate(String(context.invoice.original_due_date || "")),
    },
    { enabled, providerName: env.EMAIL_PROVIDER, provider: configuredProvider() },
  );
  if (result.sent) await markOutboundPaymentLinkDelivered(String(checkout.payment_link.id), "email");
  await insertOutboundEvent({
    ...ids,
    event_type: result.status,
    source: "retell_function",
    payload: {
      reason: result.sent ? "provider_accepted" : enabled ? "provider_failed" : "email_sending_disabled",
      provider: env.EMAIL_PROVIDER,
      provider_message_id: result.provider_message_id,
    },
  });
  return {
    ...result,
    message_for_agent: result.sent
      ? "The secure payment link was sent to the email on file."
      : "The email was not sent. Say the team will follow up with the secure link.",
  };
}
import { env } from "../config/env";
import {
  getOutboundInvoiceContext,
  hasOutboundPaymentLinkAgreement,
  insertOutboundEvent,
  markOutboundPaymentLinkDelivered,
  updateOutboundCustomer,
} from "./outboundRepository";
import { createOutboundCheckoutSession } from "./outboundStripe";
import { outboundBusinessRuntimeSettings } from "./outboundRuntimeSettings";
import { formatOutboundDate } from "./outboundFormatting";
