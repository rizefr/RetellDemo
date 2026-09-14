import { env } from "../config/env";
import {
  getOutboundInvoiceContext,
  insertOutboundEvent,
  markOutboundPaymentLinkDelivered,
  updateOutboundCustomer,
} from "./outboundRepository";
import { resolveOutboundPaymentLink } from "./outboundPaymentProvider";
import { outboundBusinessRuntimeSettings } from "./outboundRuntimeSettings";
import { formatOutboundDate } from "./outboundFormatting";
import { createHash } from "node:crypto";
import { getSupabaseClient } from "./supabase";
import { previewOutboundEmail } from "./outboundEmailTemplates";

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
  subject?: string;
  html?: string;
  text?: string;
  replyTo?: string;
  idempotencyKey?: string;
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
        ...(message.idempotencyKey ? {"Idempotency-Key":message.idempotencyKey} : {}),
      },
      body: JSON.stringify({
        from: message.from,
        to: [message.to],
        subject: message.subject || `${message.businessName} invoice ${message.invoiceNumber}`,
        ...(message.html ? {html:message.html} : {}),
        ...(message.replyTo ? {reply_to:message.replyTo} : {}),
        text: message.text || [
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

export async function sendOutboundPaymentEmailForInvoice(invoiceId: string, confirmation?: {confirmedEmail:string;recipientConfirmed:boolean;requestKey:string;adminTest?:boolean}) {
  const context = await getOutboundInvoiceContext(invoiceId);
  const ids = {
    business_id: String(context.business.id),
    customer_id: String(context.customer.id),
    invoice_id: String(context.invoice.id),
  };
  const recipient = typeof context.customer.preferred_email === "string" && context.customer.preferred_email.trim()
    ? context.customer.preferred_email.trim()
    : typeof context.customer.email === "string"
      ? context.customer.email.trim()
      : "";
  if (!recipient) {
    await insertOutboundEvent({
      ...ids,
      event_type: "email_missing",
      source: confirmation?.adminTest ? "admin" : "retell_function",
      payload: { reason: "customer_email_missing" },
    });
    return {
      sent: false,
      status: "email_missing" as const,
      message_for_agent: "The email was not sent. Say the team will follow up with the secure link.",
    };
  }

  const runtime = outboundBusinessRuntimeSettings(context.business);
  if (!confirmation?.requestKey || !confirmation?.recipientConfirmed || confirmation.confirmedEmail.trim().toLowerCase() !== recipient.toLowerCase()) {
    return {sent:false,status:"email_confirmation_required",message_for_agent:"Read the email address slowly and obtain confirmation before sending. No email was sent."};
  }
  if (confirmation.adminTest && !runtime.testMode) throw new Error("Controlled email testing requires demo mode");
  if (context.customer.outreach_paused || Number(context.invoice.amount_due_cents)<=0 || !["unpaid","payment_link_sent"].includes(String(context.invoice.status))) {
    return {sent:false,status:"email_blocked",message_for_agent:"Do not send an email. This account requires review or is no longer outstanding."};
  }
  // The dedicated flow supplies the current, separately confirmed recipient.
  // An older invoice-level agreement cannot authorize a later call's delivery.
  const requestKey = confirmation.adminTest ? "controlled-pinnacle-demo-20260914" : `retell-email:${confirmation.requestKey}`;
  const recipientDigest = createHash("sha256").update(recipient.toLowerCase()).digest("hex");
  const eventSource = confirmation.adminTest ? "admin" : "retell_function";
  await insertOutboundEvent({
    ...ids,
    event_type: "email_recipient_confirmed",
    source: eventSource,
    external_event_id: `email_recipient_confirmed:${requestKey}`,
    payload: {
      confirmation_source: confirmation.adminTest ? "controlled_admin_test" : "signed_current_call",
      call_attempt_id: confirmation.adminTest ? null : confirmation.requestKey,
      recipient_confirmed: true,
      recipient_digest: recipientDigest,
    },
  });
  await insertOutboundEvent({
    ...ids, event_type: "email_requested", source: eventSource,
    external_event_id: `email_requested:${requestKey}`,
    payload: { recipient_on_file: true },
  });
  await updateOutboundCustomer(String(context.customer.id), { payment_contact_preference: "email" });
  if (
    runtime.testMode &&
    !runtime.emailTestRecipientAllowlist.map((value) => value.toLowerCase()).includes(recipient.toLowerCase())
  ) {
    await insertOutboundEvent({
      ...ids,
      event_type: "email_pending_manual",
      source: confirmation?.adminTest ? "admin" : "retell_function",
      payload: { reason: "test_recipient_not_allowlisted", provider: env.EMAIL_PROVIDER },
    });
    return {
      sent: false,
      status: "email_pending_manual" as const,
      message_for_agent: "The email was not sent. Say the team will follow up with the secure link.",
    };
  }

  if (!runtime.emailEffective) return {sent:false,status:"email_pending_manual",message_for_agent:"Email sending is unavailable. The team must follow up."};
  const client=getSupabaseClient(); if(!client) throw new Error("Email audit storage is unavailable");
  const existing=await client.from("outbound_email_deliveries").select("status,provider_message_id,invoice_id,business_id,recipient_digest").eq("request_key",requestKey).maybeSingle();
  if(existing.error) throw new Error("Email delivery status is unavailable");
  if(existing.data) {
    const sameDelivery = existing.data.invoice_id === invoiceId && existing.data.business_id === ids.business_id && existing.data.recipient_digest === recipientDigest;
    return {
      sent: sameDelivery && ["accepted","delivered"].includes(existing.data.status),
      status: "email_already_processed",
      provider_message_id: sameDelivery ? existing.data.provider_message_id : null,
      message_for_agent: sameDelivery
        ? "This delivery request was already processed. Do not send again."
        : "An earlier request used different delivery details. Do not send again or claim this recipient received an email. The team must review it.",
    };
  }
  const checkout = await resolveOutboundPaymentLink(invoiceId, "email_placeholder");
  const preview=await previewOutboundEmail(ids.business_id,invoiceId);
  if(!preview.send_ready) return {sent:false,status:"email_blocked",message_for_agent:"The message is not ready. The team must review the template and verified payment link.",block_reasons:preview.block_reasons};
  const ledger=await client.from("outbound_email_deliveries").insert({business_id:ids.business_id,invoice_id:invoiceId,template_id:preview.template_id,request_key:requestKey,status:"pending",recipient_digest:recipientDigest}).select("id").single();
  if(ledger.error) return {sent:false,status:"email_already_processing",message_for_agent:"Delivery is already processing or audit storage is unavailable. Do not retry or claim delivery."};
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
      subject:preview.subject,html:preview.html,text:preview.text,replyTo:preview.reply_to,idempotencyKey:requestKey,
    },
    { enabled, providerName: env.EMAIL_PROVIDER, provider: configuredProvider() },
  );
  const recorded=await client.from("outbound_email_deliveries").update({status:result.sent?"accepted":"unknown",provider_message_id:result.provider_message_id,updated_at:new Date().toISOString()}).eq("id",ledger.data.id);
  if(recorded.error) console.error("Collections email provider result requires audit reconciliation");
  if (result.sent) await markOutboundPaymentLinkDelivered(String(checkout.payment_link.id), "email");
  await insertOutboundEvent({
    ...ids,
    event_type: result.status,
    source: confirmation?.adminTest ? "admin" : "retell_function",
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
