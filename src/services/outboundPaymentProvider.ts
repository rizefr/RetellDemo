import { createOutboundCheckoutSession } from './outboundStripe';
import { createOutboundPaymentLinkRecord, getActiveOutboundPaymentLink, getOutboundInvoiceContext, updateOutboundPaymentLinkRecord } from './outboundRepository';
import { getQuickBooksConnection, reverifyQuickBooksInvoiceBeforeOutreach } from './outboundQuickBooksIntegration';
import { QuickBooksReadOnlyProvider } from './outboundQuickBooksProvider';
import { QuickBooksSyncError, decimalMinorUnits, validateQuickBooksPaymentUrl } from './outboundQuickBooksSync';
export function invoicePaymentProvider(invoice:Record<string,unknown>,business:Record<string,unknown>):'stripe'|'quickbooks'|'manual' {
  if(invoice.source_provider==='quickbooks' || invoice.payment_provider==='quickbooks')return 'quickbooks';
  const selected=String(invoice.payment_provider || business.payment_provider || 'stripe');
  if(selected.startsWith('quickbooks'))return 'quickbooks';
  return selected==='stripe'?'stripe':'manual';
}
export function verifiedCachedPaymentUrl(invoice:Record<string,unknown>,business:Record<string,unknown>,link:Record<string,unknown>|null|undefined):string|null {
  if(!link || link.invoice_id!==invoice.id || link.status!=='open' || Number(link.amount_cents)!==Number(invoice.amount_due_cents) || String(link.currency).toLowerCase()!==String(invoice.currency).toLowerCase() || !link.expires_at || Date.parse(String(link.expires_at))<=Date.now()) return null;
  const provider=invoicePaymentProvider(invoice,business);
  if(provider==='quickbooks') {
    if(link.provider!=='quickbooks' || link.source_realm_id!==invoice.source_realm_id || String(link.provider_invoice_id)!==String(invoice.provider_invoice_id) || !invoice.source_verified_at || Date.now()-Date.parse(String(invoice.source_verified_at))>15*60*1000)return null;
    return validateQuickBooksPaymentUrl(link.url);
  }
  if(provider!=='stripe' || (link.provider && link.provider!=='stripe'))return null;
  try {const url=new URL(String(link.url));return url.protocol==='https:' && !url.username && !url.password && ['checkout.stripe.com','buy.stripe.com'].includes(url.hostname)?url.toString():null;}catch{return null;}
}
export async function resolveOutboundPaymentLink(invoiceId:string,sentVia='admin') {
  const context=await getOutboundInvoiceContext(invoiceId), provider=invoicePaymentProvider(context.invoice,context.business);
  if(provider==='stripe')return {...await createOutboundCheckoutSession(invoiceId,sentVia),provider};
  if(provider==='manual')throw new QuickBooksSyncError('Manual payment follow-up is required; no verified online payment link is available',409,'manual_payment_followup_required');
  if(context.invoice.source_provider!=='quickbooks')throw new QuickBooksSyncError('QuickBooks invoice source has not been verified. Manual payment follow-up required.',409,'quickbooks_invoice_unverified');
  await reverifyQuickBooksInvoiceBeforeOutreach(invoiceId);
  const connection=await getQuickBooksConnection(String(context.invoice.business_id));
  if(!connection || connection.realm_id!==context.invoice.source_realm_id)throw new QuickBooksSyncError('QuickBooks company mismatch',403,'company_mismatch');
  const client=new QuickBooksReadOnlyProvider(connection);
  const invoice=await client.invoice(String(context.invoice.provider_invoice_id),true);
  const balance=decimalMinorUnits(invoice.Balance,String(invoice.CurrencyRef?.value||''));
  if(balance!==Number(context.invoice.amount_due_cents) || String(invoice.CurrencyRef?.value||'').toLowerCase()!==context.invoice.currency || String(invoice.CustomerRef?.value)!==context.invoice.provider_customer_id)throw new QuickBooksSyncError('QuickBooks invoice changed. Refresh the invoice before sharing payment details.',409,'source_changed');
  const url=validateQuickBooksPaymentUrl(invoice.InvoiceLink??invoice.invoiceLink);
  if(!url)throw new QuickBooksSyncError('QuickBooks did not return a verified customer payment link. Use the existing invoice’s Share link in QuickBooks for manual follow-up; do not send or create an invoice to obtain a URL.',409,'manual_payment_followup_required');
  const active=await getActiveOutboundPaymentLink(invoiceId);
  if(active?.provider==='quickbooks' && active.url===url && Number(active.amount_cents)===balance && active.currency===context.invoice.currency && active.source_realm_id===connection.realm_id && String(active.provider_invoice_id)===String(invoice.Id) && active.expires_at && Date.parse(String(active.expires_at))>Date.now())return {payment_link:active,provider,reused:true};
  if(active)await updateOutboundPaymentLinkRecord(String(active.id),{status:'cancelled'});
  const payment_link=await createOutboundPaymentLinkRecord({business_id:context.invoice.business_id,customer_id:context.invoice.customer_id,invoice_id:invoiceId,provider:'quickbooks',provider_invoice_id:String(invoice.Id),source_realm_id:connection.realm_id,url,amount_cents:balance,currency:context.invoice.currency,status:'open',sent_via:null,expires_at:new Date(Date.now()+15*60*1000).toISOString()});
  return {payment_link,provider,reused:false};
}
