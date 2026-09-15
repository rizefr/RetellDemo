import {getSupabaseClient} from './supabase';

export class ReviewJobError extends Error { constructor(message:string,public status=409){super(message);} }
export type ReviewJobIdentity={job_id:string;claim_token:string};
export type SheetReadback={spreadsheet_url:string;source_run_id:string;source_count:number;invoice_count:number;totals_minor_by_currency:Record<string,number>};
export type ReviewJobCompletion=ReviewJobIdentity & {business_id:string;outcome:'completed'|'failed';source_run_id?:string;readback?:SheetReadback;failure_code?:string};
function db(){const client=getSupabaseClient();if(!client)throw new ReviewJobError('Review job storage unavailable',503);return client;}
function unwrap<T>(result:{data:T;error:any}):T {if(result.error)throw new ReviewJobError(result.error.code==='P0001'?String(result.error.message):'Review job storage request failed',result.error.code==='P0001'?409:503);return result.data;}
const columns='id,business_id,status,source_run_id,lease_expires_at,claimed_at,completed_at,failure_code,spreadsheet_url,reconciled_at';

// A managed Sheets provider attests its readback. This service never writes to
// Sheets, sends reminders, or treats Sheet cells as accounting input.
export function reviewJobStatus(rows:any[],latestSourceRunId:string|null,now=new Date()) {
 const latest=rows[0]||null;
 const successful=rows.find(row=>row.status==='completed')||null;
 const expired=latest?.status==='active'&&Date.parse(latest.lease_expires_at)<=now.getTime();
 const stale=!successful || latest?.status!=='completed' || successful.source_run_id!==latestSourceRunId || !Number.isFinite(Date.parse(successful.completed_at)) || now.getTime()-Date.parse(successful.completed_at)>24*60*60*1000;
 const reconciliationRequired=Boolean(latest&&!latest.reconciled_at&&(expired||['failed','expired'].includes(latest.status)));
 return {configured:true,stale,reconciliation_required:reconciliationRequired,last_sheet_success_at:successful?.completed_at||null,source_run_id:successful?.source_run_id||null,latest_source_run_id:latestSourceRunId,failure:expired?'review_job_expired':latest?.failure_code||null,job:latest?{...latest,status:expired?'expired':latest.status}:null,attestation_mode:'managed_provider_readback',sending_in_handler:false};
}
export async function getReviewJobStatus(businessId:string) {
 const client=db();
 const rows=unwrap(await client.from('outbound_review_jobs').select(columns).eq('business_id',businessId).order('claimed_at',{ascending:false}).limit(20))||[];
 const latest=unwrap(await client.from('outbound_quickbooks_sync_runs').select('id').eq('business_id',businessId).eq('status','applied').order('applied_at',{ascending:false}).limit(1).maybeSingle());
 let successful:any=rows.find((row:any)=>row.status==='completed');
 if(!successful)successful=unwrap(await client.from('outbound_review_jobs').select(columns).eq('business_id',businessId).eq('status','completed').order('completed_at',{ascending:false}).limit(1).maybeSingle());
 return reviewJobStatus(successful&&!rows.includes(successful)?[...rows,successful]:rows,latest?.id||null);
}
export async function claimReviewJob(businessId:string) {return unwrap(await db().rpc('outbound_claim_review_job',{p_business_id:businessId}));}
export const REVIEW_RECONCILIATION_CONFIRMATION='PROVIDER WORK HAS ENDED; SHEET REQUIRES A NEW VERIFIED REFRESH';
export async function reconcileReviewJob(input:{business_id:string;job_id:string;confirmation:string}) {
 if(input.confirmation!==REVIEW_RECONCILIATION_CONFIRMATION)throw new ReviewJobError('Explicit operator reconciliation confirmation required',400);
 return unwrap(await db().rpc('outbound_reconcile_review_job',{p_business_id:input.business_id,p_job_id:input.job_id,p_confirmation:input.confirmation}));
}
export async function completeReviewJob(input:ReviewJobCompletion) {
 if(input.outcome==='completed'&&(!input.readback||!input.source_run_id||input.readback.source_run_id!==input.source_run_id))throw new ReviewJobError('Exact source run and managed Sheet readback are required',400);
 if(input.outcome==='failed'&&!input.failure_code)throw new ReviewJobError('A failure code is required',400);
 const result=unwrap(await db().rpc('outbound_complete_review_job',{p_business_id:input.business_id,p_job_id:input.job_id,p_claim_token:input.claim_token,p_outcome:input.outcome,p_source_run_id:input.source_run_id||null,p_readback:input.readback||null,p_failure_code:input.failure_code||null}));
 if(result?.status==='expired')throw new ReviewJobError('Review job expired; spreadsheet refresh is unverified',409);
 return result;
}
