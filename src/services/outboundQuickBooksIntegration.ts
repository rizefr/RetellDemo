import { getSupabaseClient } from './supabase';
import { getOutboundInvoiceContext, insertOutboundEvent } from './outboundRepository';
import { QuickBooksReadOnlyProvider, quickBooksServerCredentialConfigured } from './outboundQuickBooksProvider';
import { QuickBooksSyncError, readQuickBooksInvoices, decimalMinorUnits, daysPastDue, type QuickBooksConnection, type SourceInvoice } from './outboundQuickBooksSync';
import {getReviewJobStatus} from './outboundReviewJobs';

function db() { const client=getSupabaseClient(); if(!client) throw new QuickBooksSyncError('Database is unavailable',503,'database_unavailable'); return client; }
function check(result:any) { if(result.error) { const message=String(result.error.message||''); if(/Preview|Verified connection|Source company|Production QuickBooks|Customer reassignment|Newer source|Review job|review job/.test(message))throw new QuickBooksSyncError(message,409,'preview_rejected'); throw new QuickBooksSyncError('QuickBooks application storage is unavailable',503,'storage_unavailable'); } return result.data; }
export type QuickBooksReviewJob={job_id:string;claim_token:string};
export async function getQuickBooksConnection(businessId:string): Promise<QuickBooksConnection | null> {
  return check(await db().from('outbound_quickbooks_connections').select('*').eq('business_id',businessId).maybeSingle());
}
async function getTrackedQuickBooksInvoiceIds(connection:QuickBooksConnection):Promise<string[]> {
  const ids:string[]=[];
  for(let offset=0;offset<10000;offset+=500){
    const rows=check(await db().from('outbound_quickbooks_source_invoices').select('provider_invoice_id').eq('business_id',connection.business_id).eq('realm_id',connection.realm_id).order('provider_invoice_id').range(offset,offset+499))||[];
    for(const row of rows)ids.push(String(row.provider_invoice_id));
    if(rows.length<500)return ids;
  }
  throw new QuickBooksSyncError('Tracked invoice reconciliation exceeds the safe limit',503,'reconciliation_limit');
}
export async function getQuickBooksIntegrationStatus(businessId:string) {
  const c=await getQuickBooksConnection(businessId), configured=quickBooksServerCredentialConfigured(c||undefined);
  const operational=check(await db().from('outbound_review_settings').select('spreadsheet_url,timezone,weekday,hour,enabled,reminder_recipient').eq('business_id',businessId).maybeSingle());
  const business=check(await db().from('outbound_businesses').select('outreach_enabled').eq('id',businessId).maybeSingle());
  const spreadsheetSync=await getReviewJobStatus(businessId).catch(()=>({stale:true,failure_code:'worksheet_status_unavailable',last_sheet_success_at:null}));
  const last=c?.last_successful_sync_at||null;
  const blockers=[...(!c?['company_binding_not_configured']:[]),...(!configured?['server_credential_missing']:[]),...(c && c.status!=='active'?['connection_not_active']:[])];
  let connected=false;
  if(c && configured && c.status==='active')try{await new QuickBooksReadOnlyProvider(c).verifyCompany();connected=true;}catch(error){blockers.push(error instanceof QuickBooksSyncError?error.code:'provider_read_failed');}
  return {configured,connected,credential_mode:c?.credential_mode||'project_api',identity_verified_at:c?.verified_at||null,company_name:c?.company_name||null,realm_id:c?.realm_id||null,environment:c?.environment||null,application_mode:'read_only',scope_description:'com.intuit.quickbooks.accounting grants broad accounting access. This application permits reads only.',last_successful_sync_at:last,stale:!last || Date.now()-Date.parse(last)>24*60*60*1000,timezone:c?.timezone||'America/New_York',schedule:{enabled:c?.sync_enabled===true,weekday:2,hour:12,timezone:'America/New_York',notification_destination:operational?.reminder_recipient||null,review_reminder_enabled:Boolean(operational?.enabled)},blockers,spreadsheet_url:operational?.spreadsheet_url||(c as any)?.spreadsheet_url||null,spreadsheet_sync:spreadsheetSync,webhook_mode:c?.sync_enabled?'disabled; authenticated scheduled polling':'disabled; manual polling only',outreach_enabled:business?.outreach_enabled===true,outreach_gate_description:'Business call lock; invoice eligibility and contact safeguards are still required.'};
}
export async function previewQuickBooksSync(businessId:string,job?:QuickBooksReviewJob) {
  const c=await getQuickBooksConnection(businessId);
  if(!c) throw new QuickBooksSyncError('Verified QuickBooks company binding required',409,'connection_missing');
  const provider=new QuickBooksReadOnlyProvider(c);
  const lease=check(await db().rpc(job?'outbound_quickbooks_acquire_sync_for_review':'outbound_quickbooks_acquire_sync',{p_business_id:businessId,...(job?{p_job_id:job.job_id,p_claim_token:job.claim_token}:{})}));
  if(!lease) throw new QuickBooksSyncError('A QuickBooks refresh is already running',409,'sync_in_progress');
  try {
    const company=await provider.verifyCompany();
    const trackedInvoiceIds=await getTrackedQuickBooksInvoiceIds(c);
    const preview=await readQuickBooksInvoices(provider.execute,{...c,source_country:company.source_country},new Date(),trackedInvoiceIds);
    const row=check(await db().from('outbound_quickbooks_sync_runs').insert({business_id:businessId,realm_id:c.realm_id,review_job_id:job?.job_id||null,preview_hash:preview.hash,status:'preview',preview,expires_at:preview.expires_at}).select('*').single());
    await insertOutboundEvent({business_id:businessId,source:'quickbooks',event_type:'quickbooks_sync_preview',payload:{sync_run_id:row.id,counts:preview.counts,totals_by_currency:preview.totals_by_currency}});
    return {...preview,id:row.id};
  } catch(error) {
    await insertOutboundEvent({business_id:businessId,source:'quickbooks',event_type:'quickbooks_sync_failed',payload:{code:error instanceof QuickBooksSyncError?error.code:'read_failed'}});
    throw error;
  } finally { check(await db().rpc('outbound_quickbooks_release_sync',{p_business_id:businessId,p_lease:lease})); }
}
export async function applyQuickBooksPreview(businessId:string,previewId:string,previewHash:string,job?:QuickBooksReviewJob) {
  return check(await db().rpc(job?'outbound_quickbooks_apply_preview_for_review':'outbound_quickbooks_apply_preview',{p_business_id:businessId,p_preview_id:previewId,p_preview_hash:previewHash,...(job?{p_job_id:job.job_id,p_claim_token:job.claim_token}:{})}));
}
export async function getQuickBooksQueue(businessId:string) {
  const connection=await getQuickBooksIntegrationStatus(businessId);
  const records:any[]=[];
  for(let offset=0;offset<10000;offset+=500){const page=check(await db().from('outbound_quickbooks_source_invoices').select('*').eq('business_id',businessId).order('provider_invoice_id').range(offset,offset+499))||[];records.push(...page);if(page.length<500)break;if(offset===9500)throw new QuickBooksSyncError('Review queue exceeds safe page limit',503,'queue_limit');}
  const sourceRunId=(connection.spreadsheet_sync as any).latest_source_run_id||null;
  if(records.length&&(!sourceRunId||records.some(record=>record.last_sync_run_id!==sourceRunId)))throw new QuickBooksSyncError('The source snapshot changed while reading. Refresh the operational report.',409,'source_snapshot_changed');
  const localRows:any[]=[];
  for(let offset=0;offset<10000;offset+=500){
    const page=check(await db().from('outbound_invoices').select('id,status,source_verified_at,expected_payment_date,outbound_customers(outreach_paused,pause_reason,payment_contact_preference),outbound_call_attempts(created_at)').eq('business_id',businessId).eq('source_provider','quickbooks').order('id').range(offset,offset+499))||[];
    localRows.push(...page);if(page.length<500)break;if(offset===9500)throw new QuickBooksSyncError('Linked invoice review exceeds safe page limit',503,'queue_limit');
  }
  const localById=new Map<string,any>(localRows.map((row:any)=>[row.id,row]));
  const allInvoices=records.map((record:any)=>{
    const row=record.source_data as SourceInvoice;
    const reasons=[...row.block_reasons];
    const local=localById.get(record.outbound_invoice_id);
    if(connection.stale) reasons.push('stale_source_data');
    if(!connection.connected) reasons.push('connection_unverified');
    if(!connection.outreach_enabled) reasons.push('business_outreach_disabled');
    if(!local?.source_verified_at)reasons.push('source_mapping_unverified');
    if(local?.outbound_customers?.outreach_paused)reasons.push(local.outbound_customers.pause_reason||'customer_paused');
    if(local && !['unpaid','payment_link_sent'].includes(local.status))reasons.push(`invoice_${local.status}`);
    const lastContact=(local?.outbound_call_attempts||[]).map((call:any)=>call.created_at).sort().at(-1)||null;
    return {...row,internal_invoice_id:record.outbound_invoice_id,block_reasons:[...new Set(reasons)],eligible:reasons.length===0,last_contact:lastContact,next_action:row.source_balance_cents===0?'Paid — no outreach':reasons.length?'Review exclusion':'Manual review required',promised_payment_date:local?.expected_payment_date||null,preferred_contact:local?.outbound_customers?.payment_contact_preference||null};
  });
  const invoices=allInvoices.filter((row:any)=>(row.source_balance_cents||0)>0 && (row.days_overdue??0)>14);
  const byCustomer=new Map<string,any>();
  for(const row of invoices) {
    const key=`${row.provider_customer_id}:${row.currency}`;
    const summary=byCustomer.get(key)||{customer_account:row.customer_account,provider_customer_id:row.provider_customer_id,currency:row.currency,invoice_count:0,remaining_balance_minor:0,overdue_balance_minor:0};
    summary.invoice_count++; summary.remaining_balance_minor+=row.source_balance_cents||0;
    if((row.days_overdue??-1)>14)summary.overdue_balance_minor+=row.source_balance_cents||0;
    byCustomer.set(key,summary);
  }
  // Re-read the applied-run/job marker after all source and operational pages. A
  // concurrent import must not pair older balances with a newer Sheet attestation.
  const finalWorksheet=await getReviewJobStatus(businessId);
  if(finalWorksheet.latest_source_run_id!==sourceRunId)throw new QuickBooksSyncError('The source snapshot changed while reading. Refresh the operational report.',409,'source_snapshot_changed');
  connection.spreadsheet_sync=finalWorksheet;
  return {invoices,source_invoices:allInvoices,source_run_id:sourceRunId,customers:[...byCustomer.values()],exclusions:allInvoices.filter((row:any)=>!row.eligible),connection,summary:{invoice_count:invoices.length,eligible_count:invoices.filter((i:any)=>i.eligible).length,source_count:allInvoices.length},operational_view_only:true};
}
export async function reverifyQuickBooksInvoiceBeforeOutreach(invoiceId:string) {
  const context=await getOutboundInvoiceContext(invoiceId), invoice=context.invoice;
  if(invoice.source_provider!=='quickbooks') return context;
  if(!invoice.source_verified_at)throw new QuickBooksSyncError('QuickBooks invoice mapping is unverified; refresh and review before outreach',409,'source_mapping_unverified');
  const connection=await getQuickBooksConnection(String(invoice.business_id));
  if(!connection || connection.realm_id!==invoice.source_realm_id) throw new QuickBooksSyncError('QuickBooks source company is unverified',409);
  const provider=new QuickBooksReadOnlyProvider(connection); await provider.verifyCompany();
  const source=await provider.invoice(String(invoice.provider_invoice_id));
  if(String(source.CustomerRef?.value)!==String(invoice.provider_customer_id)) throw new QuickBooksSyncError('QuickBooks customer changed; review the invoice mapping',409,'customer_mismatch');
  const currency=String(source.CurrencyRef?.value||'').toLowerCase(), balance=decimalMinorUnits(source.Balance,currency);
  if(balance===null || currency!==invoice.currency) throw new QuickBooksSyncError('QuickBooks balance or currency cannot be verified',409,'invalid_balance');
  if(balance===0) {
    check(await db().from('outbound_invoices').update({status:'paid',amount_due_cents:0,source_balance_cents:0,source_verified_at:new Date().toISOString()}).eq('id',invoiceId).eq('source_realm_id',connection.realm_id));
    check(await db().from('outbound_followup_tasks').update({status:'cancelled',reason:'quickbooks_invoice_paid'}).eq('invoice_id',invoiceId).in('status',['pending','in_progress']));
    throw new QuickBooksSyncError('QuickBooks confirms this invoice is paid; outreach stopped',409,'invoice_paid');
  }
  if(balance!==Number(invoice.amount_due_cents) || source.DueDate!==invoice.original_due_date) throw new QuickBooksSyncError('QuickBooks invoice changed since synchronization. Refresh and review before outreach.',409,'source_changed');
  if((daysPastDue(source.DueDate,connection.timezone)??0)<=14) throw new QuickBooksSyncError('Invoice is not more than 14 calendar days overdue',409,'not_overdue');
  if(context.customer.outreach_paused || !['unpaid','payment_link_sent'].includes(String(invoice.status))) throw new QuickBooksSyncError('Invoice is paused or requires review',409,'outreach_blocked');
  check(await db().from('outbound_invoices').update({source_verified_at:new Date().toISOString()}).eq('id',invoiceId).eq('source_realm_id',connection.realm_id));
  return context;
}
