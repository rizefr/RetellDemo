import {DateTime} from 'luxon';
import {getSupabaseClient} from './supabase';
import {getQuickBooksIntegrationStatus,getQuickBooksQueue} from './outboundQuickBooksIntegration';

export const REVIEW_TIMEZONE='America/New_York';
export type ReviewSettings={business_id:string;stage:'staged_preview'|'live_verified';spreadsheet_url:string;source_snapshot_at?:string|null;enabled:boolean;reminder_recipient:string;timezone:string};
export class ReviewRunError extends Error {constructor(message:string,public status=409){super(message);}}
function db(){const client=getSupabaseClient();if(!client)throw new ReviewRunError('Review storage unavailable',503);return client;}
function unwrap<T>(result:{data:T;error:any}):T{if(result.error){if(result.error.code==='P0001')throw new ReviewRunError(String(result.error.message),409);throw new ReviewRunError('Review storage request failed',503);}return result.data;}
export function reviewCalendar(now=new Date()){
 const local=DateTime.fromJSDate(now,{zone:REVIEW_TIMEZONE}),week=local.startOf('week'),due=week.plus({days:1,hours:12});
 return {week_start:week.toISODate(),due_at:due.toISO(),due:local>=due,timezone:REVIEW_TIMEZONE};
}
export function buildReviewReminder(input:{businessName:string;settings:ReviewSettings;connection:any;queue?:any;now?:Date}){
 const {settings,connection,queue}=input;if(!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(settings.reminder_recipient||""))throw new ReviewRunError("Approved reminder recipient is not configured",409);const blockers=[...connection.blockers||[]];
 if(settings.stage==='staged_preview')blockers.push('staged_preview_not_imported');
 if(connection.stale)blockers.push('source_refresh_stale_or_missing');
 if(settings.stage==='live_verified'&&!queue)blockers.push('queue_not_verified');
 const unique=[...new Set<string>(blockers)],ready=settings.stage==='live_verified'&&connection.connected&&!connection.stale&&queue&&unique.length===0;
 const totals:Record<string,number>={};if(ready)for(const row of queue.invoices||[])totals[row.currency]=(totals[row.currency]||0)+Number(row.source_balance_cents||0);
 const review={stage:ready?'live_review':'blocked_review',configured_stage:settings.stage,connection_blockers:unique,company_name:connection.company_name||null,realm_id:connection.realm_id||null,last_successful_sync_at:connection.last_successful_sync_at||null,staged_snapshot_at:settings.source_snapshot_at||null,spreadsheet_url:settings.spreadsheet_url,invoice_count:ready?queue.invoices.length:null,totals_minor_by_currency:ready?totals:null,customer_outreach:false,sync_triggered:false,calendar:reviewCalendar(input.now)};
 const lines=[`${input.businessName} weekly invoice review`,ready?'The last verified import is available for review.':'The current QuickBooks refresh is not verified. Review the connection blockers before relying on invoice balances.',`Review workbook: ${settings.spreadsheet_url}`,`Last successful application sync: ${connection.last_successful_sync_at||'None verified'}.`];
 if(settings.source_snapshot_at)lines.push(`Staged source snapshot: ${settings.source_snapshot_at}. This is a historical preview, not a current balance check.`);
 if(unique.length)lines.push(`Pending checks: ${unique.join(', ')}.`);
 if(ready){lines.push(`Overdue invoices in the last verified import: ${queue.invoices.length}.`);for(const [currency,minor]of Object.entries(totals))lines.push(`${currency}: ${(minor/100).toFixed(2)} remaining.`);}
 lines.push('This reminder prepares an internal review only. No customer calls, messages, charges, or accounting changes were started.','Before any manual customer contact, refresh the source and recheck the current balance, contact preferences and backend call gates.');
 return {recipient:settings.reminder_recipient,subject:`${input.businessName}: weekly invoice review${ready?'':' — refresh blocked'}`,body_text:lines.join('\n\n'),review};
}
async function settingsFor(businessId:string):Promise<ReviewSettings>{const row=unwrap(await db().from('outbound_review_settings').select('*').eq('business_id',businessId).maybeSingle());if(!row)throw new ReviewRunError('Review configuration not found',404);return row;}
async function preparedReview(businessId:string){
 const settings=await settingsFor(businessId);
 const business=unwrap(await db().from('outbound_businesses').select('id,business_name,is_demo').eq('id',businessId).maybeSingle());if(!business)throw new ReviewRunError('Business not found',404);
 let connection:any;try{connection=await getQuickBooksIntegrationStatus(businessId);}catch{connection={connected:false,stale:true,blockers:['connection_status_unavailable']};}
 let queue:any;if(settings.stage==='live_verified'&&connection.connected&&!connection.stale&&!business.is_demo){try{queue=await getQuickBooksQueue(businessId);}catch{connection.blockers=[...connection.blockers||[],'queue_read_failed'];}}
 if(settings.stage==='live_verified'&&business.is_demo)connection.blockers=[...connection.blockers||[],'live_source_on_demo_business'];
 return {settings,...buildReviewReminder({businessName:String(business.business_name),settings,connection,queue})};
}
export async function getReviewRunStatus(businessId:string){
 const prepared=await preparedReview(businessId);const runs=unwrap(await db().from('outbound_review_runs').select('id,business_id,week_start,status,recipient,lease_expires_at,provider_message_id,failure_code,claimed_at,completed_at').eq('business_id',businessId).order('claimed_at',{ascending:false}).limit(12));
 return {settings:prepared.settings,calendar:reviewCalendar(),review:prepared.review,runs,delivery_policy:'One reservation per business and New York calendar week. Accepted, uncertain, expired, or failed reservations are never automatically sent again.',sending_in_handler:false};
}
export async function configureReviewRuns(input:{business_id:string;stage:'staged_preview'|'live_verified';spreadsheet_url:string;enabled:boolean}){
 if(!/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+(?:\/edit)?$/.test(input.spreadsheet_url))throw new ReviewRunError('A valid Google Sheets document URL is required',400);
 const approved=await settingsFor(input.business_id);
 const business=unwrap(await db().from('outbound_businesses').select('id,is_demo').eq('id',input.business_id).maybeSingle());if(!business)throw new ReviewRunError('Business not found',404);
 if(input.stage==='live_verified'){
  const connection=await getQuickBooksIntegrationStatus(input.business_id);
  if(business.is_demo||!connection.connected||!connection.realm_id)throw new ReviewRunError('A verified live company binding is required for live review');
 }
 return unwrap(await db().from('outbound_review_settings').update({...input,reminder_recipient:approved.reminder_recipient,timezone:REVIEW_TIMEZONE,weekday:2,hour:12,updated_at:new Date().toISOString()}).eq('business_id',input.business_id).select('*').single());
}
export async function claimReviewRun(businessId:string){
 const prepared=await preparedReview(businessId);
 return unwrap(await db().rpc('outbound_claim_review_run',{p_business_id:businessId,p_subject:prepared.subject,p_body_text:prepared.body_text,p_snapshot:prepared.review}));
}
export async function completeReviewRun(input:{business_id:string;run_id:string;claim_token:string;outcome:'accepted'|'uncertain'|'failed_no_send';provider_message_id?:string;failure_code?:string}){
 if(input.outcome==='accepted'&&!input.provider_message_id?.trim())throw new ReviewRunError('Provider message ID required for accepted reminder',400);
 return unwrap(await db().rpc('outbound_complete_review_run',{p_business_id:input.business_id,p_run_id:input.run_id,p_claim_token:input.claim_token,p_outcome:input.outcome,p_provider_message_id:input.provider_message_id||null,p_failure_code:input.failure_code||null}));
}
