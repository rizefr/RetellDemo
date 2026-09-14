import { validateQuickBooksPaymentUrl } from "./outboundQuickBooksSync";
import { z } from "zod";
import { getSupabaseClient } from "./supabase";
import { getOutboundInvoiceContext, getOutboundBusinessSettings, insertOutboundEvent } from "./outboundRepository";
import { outboundBusinessRuntimeSettings } from "./outboundRuntimeSettings";
import { invoicePaymentProvider } from "./outboundPaymentProvider";
import { formatOutboundDate } from "./outboundFormatting";

export const emailTemplateContentSchema = z.object({
  name: z.string().trim().min(1).max(100),
  subject: z.string().trim().min(1).max(180).refine(v => !/[\r\n]/.test(v)),
  preheader: z.string().trim().max(200),
  introduction: z.string().trim().min(1).max(1200),
  closing: z.string().trim().min(1).max(800),
}).strict();
export type EmailTemplateContent = z.infer<typeof emailTemplateContentSchema>;

export const PINNACLE_EMAIL_TEMPLATE: EmailTemplateContent = {
  name: "Pinnacle · Invoice follow-up",
  subject: "{{business_name}} invoice {{invoice_number}}",
  preheader: "Your invoice details and secure payment next step.",
  introduction: "We’re following up on the invoice below for services provided by {{business_name}}. Please review the current outstanding balance and let us know if you have any questions.",
  closing: "When can we expect the payment? Please reply with the date that works for you. If you have already paid or believe any details are incorrect, let us know so our team can review the account.",
};

export type EmailInvoiceVariables = {
  business_name: string; customer_name: string; invoice_number: string;
  service_description: string; inspection_date: string; invoice_date: string;
  due_date: string; balance: string; currency: string; payment_url: string;
  contact_phone: string; contact_email: string; pinnacle_brand: boolean; demo: boolean;
};

export function escapeEmailHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function safeEmailPaymentUrl(value: string): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
    return url.hostname === "checkout.stripe.com" ? url.href : validateQuickBooksPaymentUrl(value) || "";
  } catch { return ""; }
}

export function validatedPreviewPaymentUrl(invoice:Record<string,unknown>, business:Record<string,unknown>, link:Record<string,unknown>|null, now=new Date()):string {
  if(!link || link.invoice_id!==invoice.id || link.business_id!==business.id || link.status!=="open" || Number(link.amount_cents)!==Number(invoice.amount_due_cents) || String(link.currency).toLowerCase()!==String(invoice.currency).toLowerCase()) return "";
  const expires=Date.parse(String(link.expires_at || ""));
  if(!Number.isFinite(expires)||expires<=now.getTime()) return "";
  const source=invoicePaymentProvider(invoice,business);
  const url=safeEmailPaymentUrl(String(link.url || "")); if(!url) return "";
  if(source.startsWith("quickbooks")) {
    if(new URL(url).hostname==="checkout.stripe.com" || link.provider!=="quickbooks" || link.source_realm_id!==invoice.source_realm_id || link.provider_invoice_id!==invoice.provider_invoice_id) return "";
    const verified=Date.parse(String(invoice.source_verified_at || ""));
    if(!Number.isFinite(verified)||now.getTime()-verified>5*60*1000||verified>now.getTime()+60000) return "";
  } else if(source!=="stripe") return "";
  else if(new URL(url).hostname!=="checkout.stripe.com" || (link.provider && link.provider!=="stripe")) return "";
  return url;
}

export function renderOutboundEmailTemplate(content: EmailTemplateContent, v: EmailInvoiceVariables) {
  const interpolate = (text: string) => text.replace(/\{\{([a-z_]+)\}\}/g, (_, key: string) => {
    const value = v[key as keyof EmailInvoiceVariables];
    return typeof value === "string" ? value : "";
  });
  const subject = (v.demo ? "[Demo] " : "") + interpolate(content.subject).replace(/[\r\n]/g, " ");
  const preheader = interpolate(content.preheader);
  const introduction = interpolate(content.introduction);
  const closing = interpolate(content.closing);
  const paymentUrl = safeEmailPaymentUrl(v.payment_url);
  const h = escapeEmailHtml;
  const rows = [["Invoice", v.invoice_number], ["Service / inspection", v.service_description],
    ["Inspection date", v.inspection_date || "Not provided"], ["Invoice date", v.invoice_date || "Not provided"],
    ["Due date", v.due_date || "Not provided"]];
  const brand = v.pinnacle_brand
    ? '<img src="https://pinnacleelevatorsolutions.com/wp-content/uploads/2023/06/Logo-1.svg" width="224" alt="Pinnacle Elevator Solutions" style="display:block;max-width:100%;height:auto"><p style="font-size:16px;font-weight:bold;margin-bottom:0">Pinnacle Elevator Solutions</p>'
    : `<strong style="font-size:22px;color:#16653f">${h(v.business_name)}</strong>`;
  const contact = [v.contact_phone, v.contact_email].filter(Boolean).join(" · ");
  const text = [v.demo ? "CONTROLLED DEMO — no payment is requested for demo records." : "", subject,
    `Hello ${v.customer_name || "there"},`, introduction,
    ...rows.map(([label, value]) => `${label}: ${value}`), `Outstanding balance: ${v.balance} ${v.currency}`,
    paymentUrl ? `Review invoice and pay securely: ${paymentUrl}` : "A secure payment link is not available. Our team will provide the verified payment details.",
    closing, v.business_name, contact, "Payment details are entered only on the secure payment page, never by phone."].filter(Boolean).join("\n\n");
  const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(subject)}</title><style>@media only screen and (max-width:480px){.email-outer{padding:20px 10px!important}.email-padding{padding-left:20px!important;padding-right:20px!important}.email-detail{padding-left:14px!important;padding-right:14px!important}}</style></head>
<body style="margin:0;background:#f2f5f3;color:#302c2c;font-family:Montserrat,Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${h(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="email-outer" align="center" style="padding:32px 12px">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #dbe5de;border-radius:12px">
<tr><td class="email-padding" style="padding:36px 32px;border-bottom:4px solid #108650">${brand}</td></tr>
<tr><td class="email-padding" style="padding:36px 32px">
${v.demo ? '<p style="margin:0 0 28px;background:#fff4db;padding:14px 16px;color:#5e4509;font-size:12px;line-height:1.6">CONTROLLED DEMO · No payment is requested for demo records.</p>' : ''}
<p style="margin:0 0 12px;font-size:12px;letter-spacing:1px;color:#16653f;font-weight:bold;line-height:1.5">INVOICE FOLLOW-UP</p>
<h1 style="font-size:27px;line-height:1.3;margin:0 0 28px">Your invoice, in one place.</h1>
<p style="font-size:15px;line-height:1.7;margin:0 0 16px">Hello ${h(v.customer_name || "there")},</p>
<p style="font-size:15px;line-height:1.7;margin:0">${h(introduction)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:28px 0 32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f7f4;border-radius:8px">
${rows.map(([label, value])=>`<tr><td class="email-detail" style="padding:14px 18px;font-size:12px;line-height:1.6;color:#526259;width:34%;vertical-align:top">${h(label)}</td><td class="email-detail" style="padding:14px 18px;font-size:14px;line-height:1.6;vertical-align:top;word-break:break-word">${h(value)}</td></tr>`).join("")}
<tr><td class="email-detail" colspan="2" style="padding:24px 18px;border-top:1px solid #dbe5de"><span style="font-size:12px;line-height:1.6;color:#526259">OUTSTANDING BALANCE</span><br><strong style="font-size:30px;line-height:1.6">${h(v.balance)}</strong> <span style="font-size:12px">${h(v.currency)}</span></td></tr>
</table></td></tr></table>
${paymentUrl ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#108650;border-radius:6px"><a href="${h(paymentUrl)}" style="display:inline-block;padding:17px 26px;color:white;text-decoration:none;font-size:15px;line-height:1.5;font-weight:bold">Review invoice &amp; pay securely</a></td></tr></table>` : '<p style="margin:0;padding:18px;border:1px solid #dbe5de;font-size:14px;line-height:1.7">A secure payment link is not available. Our team will provide the verified payment details.</p>'}
<p style="font-size:15px;line-height:1.7;margin:32px 0 24px">${h(closing)}</p>
<p style="font-size:15px;line-height:1.7;margin:0">${h(v.business_name)}<br>${h(contact)}</p>
</td></tr>
<tr><td class="email-padding" style="padding:24px 32px;background:#f3f7f4;color:#526259;font-size:11px;line-height:1.8">Payment details are entered only on the secure payment page, never by phone.${v.pinnacle_brand ? '<br>2778 W 15th Street · Brooklyn, NY 11224<br><a href="https://pinnacleelevatorsolutions.com/" style="color:#16653f">pinnacleelevatorsolutions.com</a>' : ''}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, preheader, html, text, payment_link_available: Boolean(paymentUrl) };
}

function db() { const c = getSupabaseClient(); if (!c) throw new Error("Collections database is unavailable"); return c; }
function result<T>(r: {data:T;error:unknown}) { if(r.error) throw new Error("Email template storage is unavailable"); return r.data; }

export async function listOutboundEmailTemplates(businessId: string) {
  const business = await getOutboundBusinessSettings(businessId);
  const templates = result(await db().from("outbound_email_templates").select("*").eq("business_id",businessId).order("version",{ascending:false}));
  return { templates: (templates || []).map(t=>({...t,is_default:t.id===business.default_email_template_id})), default_template_id: business.default_email_template_id || null, starter: PINNACLE_EMAIL_TEMPLATE };
}

export async function createOutboundEmailTemplate(businessId: string, content: EmailTemplateContent) {
  await getOutboundBusinessSettings(businessId);
  return result(await db().from("outbound_email_templates").insert({business_id:businessId,content:emailTemplateContentSchema.parse(content),status:"draft"}).select("*").single());
}

export async function publishOutboundEmailTemplate(businessId: string, templateId: string, makeDefault: boolean) {
  const template = result(await db().from("outbound_email_templates").update({status:"published"}).eq("id",templateId).eq("business_id",businessId).select("*").single());
  if (makeDefault) result(await db().from("outbound_businesses").update({default_email_template_id:templateId}).eq("id",businessId).select("id").single());
  await insertOutboundEvent({business_id:businessId,event_type:"email_template_published",source:"admin",payload:{template_id:templateId,version:template.version,default:makeDefault}});
  return template;
}

export async function previewOutboundEmail(businessId: string, invoiceId: string, templateId?: string) {
  const context=await getOutboundInvoiceContext(invoiceId);
  if(String(context.invoice.business_id)!==businessId || String(context.customer.business_id)!==businessId || String(context.business.id)!==businessId) throw new Error("Invoice does not belong to the selected business");
  const selectedId=templateId || String(context.business.default_email_template_id || "");
  const template=selectedId ? result(await db().from("outbound_email_templates").select("*").eq("id",selectedId).eq("business_id",businessId).single()) : null;
  const c=context.customer,b=context.business,i=context.invoice;
  const runtime=outboundBusinessRuntimeSettings(b);
  const pinnacle=b.email_brand === "pinnacle";
  const rawUrl=validatedPreviewPaymentUrl(i,b,context.paymentLink);
  const currency=String(i.currency || "").toUpperCase();
  const currencyValid=/^[A-Z]{3}$/.test(currency);
  let balance="Amount requires review";
  try { if(currencyValid&&Number.isSafeInteger(Number(i.amount_due_cents))&&Number(i.amount_due_cents)>=0) balance=new Intl.NumberFormat("en-US",{style:"currency",currency}).format(Number(i.amount_due_cents)/100); } catch { /* The preview remains inspectable with an explicit blocked amount. */ }
  const rendered=renderOutboundEmailTemplate(template ? emailTemplateContentSchema.parse(template.content) : PINNACLE_EMAIL_TEMPLATE, {
    business_name:String(b.business_name),customer_name:[c.first_name,c.last_name].filter(Boolean).join(" "),invoice_number:String(i.source_document_number || i.invoice_id),
    service_description:String(i.service_description || ""),inspection_date:formatOutboundDate(String(i.inspection_date || ""), ""),
    invoice_date:formatOutboundDate(String(i.invoice_date || ""), ""),due_date:formatOutboundDate(String(i.original_due_date || ""), ""),
    balance,currency,payment_url:rawUrl,
    contact_phone:pinnacle ? "646-893-1695" : String(b.callback_number || ""),contact_email:pinnacle ? "hello@pinnacleelevatorsolutions.com" : "",
    pinnacle_brand:pinnacle,demo:runtime.testMode,
  });
  const recipient=String(c.preferred_email || c.email || "").trim();
  const blockReasons:string[]=[];
  if(balance==="Amount requires review") blockReasons.push("Invoice amount or currency requires review");
  if(!template || template.status!=="published") blockReasons.push("Select a published template");
  if(!runtime.emailEffective) blockReasons.push("Email provider or business delivery setting is not ready");
  if(!z.email().safeParse(recipient).success) blockReasons.push("A valid confirmed recipient is required");
  if(runtime.testMode && !runtime.emailTestRecipientAllowlist.some(e=>e.toLowerCase()===recipient.toLowerCase())) blockReasons.push("Recipient is outside the test allowlist");
  if(Number(i.amount_due_cents)<=0 || !["unpaid","payment_link_sent"].includes(String(i.status))) blockReasons.push("Invoice is not eligible for a payment message");
  if(c.outreach_paused) blockReasons.push("Customer outreach is paused");
  if(!rendered.payment_link_available) blockReasons.push("A verified customer payment link is required");
  return {...rendered,recipient,from:runtime.emailFrom,reply_to:"",send_ready:blockReasons.length===0,block_reasons:blockReasons,
    template_id:template?.id || null,template_version:template?.version || null,payment_provider:invoicePaymentProvider(i,b)};
}
