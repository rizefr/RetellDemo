import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({tables:{} as Record<string,any[]>,reads:[] as any[],status:vi.fn()}));
vi.mock('../services/outboundReviewJobs',()=>({getReviewJobStatus:state.status}));
vi.mock('../services/outboundQuickBooksProvider',()=>({quickBooksServerCredentialConfigured:()=>false}));
vi.mock('../services/outboundRepository',()=>({getOutboundInvoiceContext:vi.fn(),insertOutboundEvent:vi.fn()}));
vi.mock('../services/supabase',()=>({getSupabaseClient:()=>({from:(table:string)=>{
 const filters:any[]=[];let first=0,last=999;
 const query:any={select:()=>query,eq:(key:string,value:any)=>{filters.push([key,value]);return query;},order:()=>query,range:(from:number,to:number)=>{first=from;last=to;return query;},maybeSingle:async()=>({data:table==='outbound_businesses'?{outreach_enabled:false}:null,error:null}),then:(resolve:any)=>{state.reads.push({table,filters,first,last});return Promise.resolve({data:(state.tables[table]||[]).slice(first,last+1),error:null}).then(resolve);}};
 return query;
}})}));
import {getQuickBooksQueue} from '../services/outboundQuickBooksIntegration';
const worksheet={configured:true,stale:false,source_run_id:'run-a',latest_source_run_id:'run-a',last_sheet_success_at:'2026-09-14T12:00:00Z'};
describe('QuickBooks operational queue snapshot',()=>{
 beforeEach(()=>{state.tables={};state.reads=[];state.status.mockReset().mockResolvedValue(worksheet);});
 it('keeps contact history and preferences beyond the first thousand linked invoices',async()=>{
  state.tables.outbound_quickbooks_source_invoices=Array.from({length:1101},(_,i)=>({last_sync_run_id:'run-a',outbound_invoice_id:`local-${i}`,source_data:{provider_invoice_id:String(i),provider_customer_id:String(i),customer_account:'Fixture',currency:'USD',source_balance_cents:100,days_overdue:21,block_reasons:[]}}));
  state.tables.outbound_invoices=Array.from({length:1101},(_,i)=>({id:`local-${i}`,status:'unpaid',source_verified_at:'2026-09-14T12:00:00Z',expected_payment_date:i===1100?'2026-09-20':null,outbound_customers:{outreach_paused:i===1100,pause_reason:'dispute',payment_contact_preference:'email'},outbound_call_attempts:[{created_at:'2026-09-13T12:00:00Z'}]}));
  const report=await getQuickBooksQueue('business-a');const last=report.source_invoices[1100];
  expect(report.summary.source_count).toBe(1101);expect(last.promised_payment_date).toBe('2026-09-20');expect(last.last_contact).toBe('2026-09-13T12:00:00Z');expect(last.preferred_contact).toBe('email');expect(last.block_reasons).toContain('dispute');expect(last.block_reasons).not.toContain('source_mapping_unverified');
  const pages=state.reads.filter(read=>read.table==='outbound_invoices');expect(pages.map(read=>read.first)).toEqual([0,500,1000]);for(const page of pages)expect(page.filters).toContainEqual(['business_id','business-a']);
 });
 it('rejects source pages from a different applied run',async()=>{
  state.tables.outbound_quickbooks_source_invoices=[{last_sync_run_id:'run-b'}];
  await expect(getQuickBooksQueue('business-a')).rejects.toMatchObject({code:'source_snapshot_changed'});
 });
 it('rejects a new import between reading source pages and final workbook status',async()=>{
  state.status.mockResolvedValueOnce(worksheet).mockResolvedValueOnce({...worksheet,latest_source_run_id:'run-b',stale:true});
  await expect(getQuickBooksQueue('business-a')).rejects.toMatchObject({code:'source_snapshot_changed'});
 });
});
