import {describe,it,expect,vi,afterEach} from 'vitest';
import {QuickBooksConsumerMcp,quickBooksConsumerCredentialConfigured,quickBooksCompanyIdentityHash,readConsumerToolResult,verifyConsumerAccountList} from '../services/outboundQuickBooksConsumerMcp';
import {QuickBooksReadOnlyProvider,quickBooksServerCredentialConfigured} from '../services/outboundQuickBooksProvider';
import type {QuickBooksConnection} from '../services/outboundQuickBooksSync';
const connection:QuickBooksConnection={business_id:'business-a',realm_id:'12345',company_name:'Fixture LLC',environment:'sandbox',connected_account_id:'ca_fixture',connection_owner_id:'owner',timezone:'America/New_York',verified_at:'2026-09-14T00:00:00Z',status:'active'};
const key='ck_fixture_1234567890';
const company={CompanyName:'Fixture LLC',LegalName:'Fixture LLC',domain:'QBO',Country:'US',CompanyStartDate:'2023-01-01',MetaData:{CreateTime:'2023-01-01T00:00:00Z'},LegalAddr:{Line1:'1 Example Street',City:'New York'}};
const consumerConnection={...connection,credential_mode:'consumer_mcp' as const,consumer_account_id:'quickbooks_fixture-word',provider_user_id:'provider-owner',company_identity_hash:quickBooksCompanyIdentityHash(company)};
const accounts={successful:true,data:{results:{quickbooks:{toolkit:'quickbooks',status:'active',accounts:[{id:'quickbooks_fixture-word',alias:'Fixture',status:'active',account_type:'PRIVATE',user_info:{sub:'provider-owner'}}]}}}};
const toolData=(tool:string,data:any):any=>({successful:true,data:{total_count:1,success_count:1,error_count:0,results:[{index:0,tool_slug:tool,response:{successful:true,data}}]}});
const schema=[
 {name:'COMPOSIO_MULTI_EXECUTE_TOOL',inputSchema:{properties:{tools:{items:{properties:{account:{type:'string'}}}}}}},
 {name:'COMPOSIO_MANAGE_CONNECTIONS',inputSchema:{properties:{toolkits:{items:{properties:{action:{enum:['add','rename','list','remove']}}}}}}}
];
function harness(options:{schemas?:any[];toolResult?:any;list?:any[];sse?:boolean}={}){
 const calls:any[]=[];let pages=0;
 const request=vi.fn(async(url:any,init:any)=>{
  const body=JSON.parse(init.body);calls.push({url,init,body});
  if(body.method==='notifications/initialized')return new Response(null,{status:202});
  const result=body.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{},serverInfo:{name:'fixture',version:'1'}}:body.method==='tools/list'?(options.list?.[pages++]||{tools:options.schemas||schema}):(options.toolResult||{content:[{type:'text',text:JSON.stringify({successful:true,data:{results:[]}})}]});
  const message={jsonrpc:'2.0',id:body.id,result};
  return new Response(options.sse?`event: message\r\ndata: ${JSON.stringify(message)}\r\n\r\n`:JSON.stringify(message),{status:200,headers:{'content-type':options.sse?'text/event-stream':'application/json',...(body.method==='initialize'?{'mcp-session-id':'fixture-session'}:{})}});
 });
 return {calls,request,client:new QuickBooksConsumerMcp(connection,request as typeof fetch,()=>key)};
}
describe('Composio consumer read-only transport',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 it('negotiates the actual SSE transport and omits the notification ID',async()=>{
  const h=harness({sse:true});await h.client.listConnections();
  expect(h.calls.map(c=>c.body.method)).toEqual(['initialize','notifications/initialized','tools/list','tools/call']);
  expect(h.calls[1].body).not.toHaveProperty('id');
  for(const c of h.calls){expect(c.url).toBe('https://connect.composio.dev/mcp');expect(c.init.redirect).toBe('error');expect(c.init.headers['x-consumer-api-key']).toBe(key);expect(c.init.body).not.toContain(key);}
  expect(h.calls[2].init.headers['MCP-Protocol-Version']).toBe('2025-11-25');expect(h.calls[2].init.headers['Mcp-Session-Id']).toBe('fixture-session');
  expect(h.calls[3].body.params).toEqual({name:'COMPOSIO_MANAGE_CONNECTIONS',arguments:{toolkits:[{name:'quickbooks',action:'list'}]}});
 });
 it('pins every read to the immutable account and initializes once across repeated reads',async()=>{
  const h=harness();await h.client.executeRead('QUICKBOOKS_GET_COMPANY_INFO',{minorversion:75});await h.client.executeRead('QUICKBOOKS_READ_INVOICE',{invoice_id:'81',minorversion:75});
  expect(h.calls.filter(c=>c.body.method==='initialize')).toHaveLength(1);
  const calls=h.calls.filter(c=>c.body.method==='tools/call');
  for(const c of calls){expect(c.body.params.name).toBe('COMPOSIO_MULTI_EXECUTE_TOOL');expect(c.body.params.arguments.tools).toHaveLength(1);expect(c.body.params.arguments.tools[0].account).toBe('ca_fixture');expect(c.body.params.arguments.sync_response_to_workbench).toBe(false);}
 });
 it('rejects write/proxy tools, account overrides, unbounded queries and omitted invoice IDs before network access',async()=>{
  const h=harness();for(const [tool,args] of [
   ['QUICKBOOKS_SEND_INVOICE',{invoice_id:'81'}],['QUICKBOOKS_CREATE_INVOICE',{}],['COMPOSIO_REMOTE_WORKBENCH',{}],['QUICKBOOKS_GET_COMPANY_INFO',{minorversion:75,account:'ca_other'}],
   ['QUICKBOOKS_READ_INVOICE',{minorversion:75}],['QUICKBOOKS_READ_INVOICE',{invoice_id:81,minorversion:75}],['QUICKBOOKS_READ_INVOICE',{invoice_id:'81',minorversion:75,include:'invoiceLink'}],
   ['QUICKBOOKS_QUERY_ENTITIES',{query:'DELETE FROM Invoice'}],['QUICKBOOKS_QUERY_ENTITIES',{query:'SELECT * FROM Invoice STARTPOSITION 0 MAXRESULTS 100'}],['QUICKBOOKS_QUERY_ENTITIES',{query:'SELECT * FROM Invoice STARTPOSITION 1 MAXRESULTS 1001'}]
  ] as [string,any][])await expect(h.client.executeRead(tool,args)).rejects.toMatchObject({code:'operation_not_allowed'});expect(h.request).not.toHaveBeenCalled();
 });
 it('will not rely on a default account when the session cannot explicitly select one',async()=>{
  const h=harness({schemas:[schema[1]]});await expect(h.client.executeRead('QUICKBOOKS_READ_CUSTOMER',{customer_id:'42'})).rejects.toMatchObject({code:'consumer_account_selection_unavailable'});expect(h.calls.some(c=>c.body.method==='tools/call')).toBe(false);
 });
 it('requires the side-effect-free list action in the live schema',async()=>{
  const h=harness({schemas:[schema[0]]});await expect(h.client.listConnections()).rejects.toMatchObject({code:'consumer_connection_inspection_unavailable'});expect(h.calls.some(c=>c.body.method==='tools/call')).toBe(false);
 });
 it('reads all schema pages and rejects repeated cursors',async()=>{
  const h=harness({list:[{tools:[schema[0]],nextCursor:'next'},{tools:[schema[1]]}]});await h.client.listConnections();expect(h.calls[3].body.params).toEqual({cursor:'next'});
  const loop=harness({list:[{tools:schema,nextCursor:'repeat'},{tools:[],nextCursor:'repeat'}]});await expect(loop.client.listConnections()).rejects.toMatchObject({code:'consumer_mcp_schema_invalid'});expect(loop.calls.some(c=>c.body.method==='tools/call')).toBe(false);
 });
 it('rejects unverified connection bindings and personal or project credentials',async()=>{
  for(const patch of [{verified_at:''},{status:'expired'},{realm_id:'not-a-realm'},{connected_account_id:'alias'}])expect(()=>new QuickBooksConsumerMcp({...connection,...patch})).toThrow(/verified/);
  for(const value of ['','uak_fixture','ak_fixture']){vi.stubEnv('QUICKBOOKS_COMPOSIO_CONSUMER_KEY',value);expect(quickBooksConsumerCredentialConfigured()).toBe(false);const request=vi.fn();await expect(new QuickBooksConsumerMcp(connection,request).listConnections()).rejects.toMatchObject({code:'consumer_credential_missing'});expect(request).not.toHaveBeenCalled();}
 });
 it('redacts provider errors and never retries or switches accounts after an uncertain result',async()=>{
  const h=harness({toolResult:{isError:true,content:[{type:'text',text:`sensitive ${key}`}]}});await expect(h.client.executeRead('QUICKBOOKS_GET_COMPANY_INFO',{minorversion:75})).rejects.toThrow('Composio could not complete the read');expect(h.calls.filter(c=>c.body.method==='tools/call')).toHaveLength(1);
  const request=vi.fn().mockResolvedValue(new Response(key,{status:401}));await expect(new QuickBooksConsumerMcp(connection,request,()=>key).listConnections()).rejects.toThrow('Composio consumer authorization failed or expired');expect(request).toHaveBeenCalledTimes(1);
 });
 it('rejects malformed or ambiguous result text instead of accepting a partial response',async()=>{
  for(const content of [[{type:'text',text:'not-json'}],[{type:'text',text:'{}'},{type:'text',text:'{}'}]]){const h=harness({toolResult:{content}});await expect(h.client.listConnections()).rejects.toThrow(/invalid read result|incomplete read result/);}
 });
 it('validates exact consumer identity without relying on alias, default selection or shared owner alone',()=>{
  expect(verifyConsumerAccountList(accounts,consumerConnection).id).toBe('quickbooks_fixture-word');
  for(const patch of [{id:'quickbooks_other'}, {status:'expired'}, {account_type:'SHARED'}, {user_info:{sub:'other-owner'}}]){
   const changed=structuredClone(accounts);Object.assign(changed.data.results.quickbooks.accounts[0],patch);expect(()=>verifyConsumerAccountList(changed,consumerConnection)).toThrow(/owner or status/);
  }
  const duplicate=structuredClone(accounts);duplicate.data.results.quickbooks.accounts.push({...duplicate.data.results.quickbooks.accounts[0]});expect(()=>verifyConsumerAccountList(duplicate,consumerConnection)).toThrow(/owner or status/);
 });
 it('requires one successful matching native result and rejects truncated, failed, or misrouted data',()=>{
  const tool='QUICKBOOKS_GET_COMPANY_INFO';const good=toolData(tool,company);expect(readConsumerToolResult(good,tool)).toEqual(company);
  for(const changed of [{...good,successful:false},{...good,error:'private-provider-detail'},{...good,data:{...good.data,error_count:1}},{...good,data:{...good.data,remote_file_info:{path:'/tmp/partial.json'}}},{...good,data:{...good.data,results:[]}},toolData('QUICKBOOKS_READ_INVOICE',company),{...good,data:{...good.data,results:[{...good.data.results[0],response:{successful:false,data:company}}]}}])expect(()=>readConsumerToolResult(changed,tool)).toThrow(/read/);
 });
 it('anchors company creation and legal identity to the independent exact-realm read',()=>{
  expect(quickBooksCompanyIdentityHash({...company,Id:'1',SyncToken:'updated',DefaultTimeZone:'America/Los_Angeles'})).toBe(consumerConnection.company_identity_hash);
  expect(quickBooksCompanyIdentityHash({...company,MetaData:{CreateTime:'2024-01-01T00:00:00Z'}})).not.toBe(consumerConnection.company_identity_hash);
  expect(()=>quickBooksCompanyIdentityHash({...company,MetaData:{}})).toThrow(/incomplete/);
 });
 it('chooses the stored credential mode and never silently falls back to another credential',async()=>{
  vi.stubEnv('QUICKBOOKS_COMPOSIO_CONSUMER_KEY',key);vi.stubEnv('QUICKBOOKS_COMPOSIO_API_KEY','');
  expect(quickBooksServerCredentialConfigured(consumerConnection)).toBe(true);expect(quickBooksServerCredentialConfigured(connection)).toBe(false);
  const request=vi.fn();await expect(new QuickBooksReadOnlyProvider(connection,request).invoice('81')).rejects.toMatchObject({code:'server_credential_missing'});expect(request).not.toHaveBeenCalled();
  expect(()=>new QuickBooksReadOnlyProvider({...consumerConnection,company_identity_hash:null})).toThrow(/independently verified/);
 });
 it('the consumer provider verifies metadata then pinned company and fails closed on source changes',async()=>{
  const h=harness();const original=h.request.getMockImplementation()!;
  h.request.mockImplementation(async(url:any,init:any)=>{
   const message=JSON.parse(init.body);if(message.method!=='tools/call')return original(url,init);
   h.calls.push({url,init,body:message});const data=message.params.name==='COMPOSIO_MANAGE_CONNECTIONS'?accounts:toolData('QUICKBOOKS_GET_COMPANY_INFO',company);
   return new Response(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{structuredContent:data}}));
  });
  const provider=new QuickBooksReadOnlyProvider(consumerConnection,h.request as typeof fetch,()=>key);
  const verified=await provider.verifyCompany();expect(verified.realm_id).toBe('12345');expect(verified.source_country).toBe('US');
  const execution=h.calls.at(-1).body.params.arguments.tools[0];expect(execution.account).toBe('ca_fixture');expect(execution.tool_slug).toBe('QUICKBOOKS_GET_COMPANY_INFO');
  await expect(new QuickBooksReadOnlyProvider({...consumerConnection,company_identity_hash:'a'.repeat(64)},h.request as typeof fetch,()=>key).verifyCompany()).rejects.toMatchObject({code:'company_mismatch'});
  await expect(provider.get('companyinfo/999')).rejects.toMatchObject({code:'company_mismatch'});
 });
 it('preserves the genuine native InvoiceLink without inventing an unsupported include argument',async()=>{
  const invoice={Id:'81',InvoiceLink:'https://connect.intuit.com/t/scs-v1-fixtureToken_123',Balance:125,CurrencyRef:{value:'USD'}};
  const h=harness({toolResult:{structuredContent:toolData('QUICKBOOKS_READ_INVOICE',invoice)}});
  const result=await new QuickBooksReadOnlyProvider(consumerConnection,h.request as typeof fetch,()=>key).invoice('81',true);
  expect(result).toEqual(invoice);expect(h.calls.at(-1).body.params.arguments.tools[0]).toEqual({tool_slug:'QUICKBOOKS_READ_INVOICE',account:'ca_fixture',arguments:{invoice_id:'81',minorversion:75}});
 });
 it('retries bounded transient read failures with the same session, request ID, account and arguments',async()=>{
  for(const transient of [429,502,503,504,'network']){
   const h=harness();const original=h.request.getMockImplementation()!;let attempts=0;const bodies:string[]=[];
   h.request.mockImplementation(async(url:any,init:any)=>{
    const body=JSON.parse(init.body);if(body.method==='tools/call'){bodies.push(init.body);if(attempts++===0){if(transient==='network')throw new Error(key);return new Response('temporary',{status:Number(transient),headers:{'retry-after':'0'}});}}
    return original(url,init);
   });
   await h.client.executeRead('QUICKBOOKS_READ_CUSTOMER',{customer_id:'42'});
   expect(bodies).toHaveLength(2);expect(bodies[0]).toBe(bodies[1]);expect(JSON.parse(bodies[1]).params.arguments.tools[0].account).toBe('ca_fixture');
  }
 });
 it('stops after three transient attempts and does not retry protocol failures or expired authorization',async()=>{
  const h=harness();const original=h.request.getMockImplementation()!;let attempts=0;
  h.request.mockImplementation(async(url:any,init:any)=>{if(JSON.parse(init.body).method==='tools/call'){attempts++;return new Response('private',{status:503,headers:{'retry-after':'0'}});}return original(url,init);});
  await expect(h.client.listConnections()).rejects.toMatchObject({code:'provider_request_failed'});expect(attempts).toBe(3);
 });
 it('fails closed before starting another request after the bounded hosted read budget',async()=>{
  const h=harness();const now=Date.now();const clock=vi.spyOn(Date,'now').mockReturnValue(now+241000);
  try{await expect(h.client.listConnections()).rejects.toMatchObject({code:'provider_request_budget'});expect(h.request).not.toHaveBeenCalled();}finally{clock.mockRestore();}
 });
 it('reduces an oversized open page without accepting inline previews or skipping a source position',async()=>{
  const h=harness();const original=h.request.getMockImplementation()!;const queries:string[]=[];
  h.request.mockImplementation(async(url:any,init:any)=>{
   const body=JSON.parse(init.body);if(body.method!=='tools/call')return original(url,init);
   const read=body.params.arguments.tools[0];queries.push(read.arguments.query);
   const complete=read.arguments.query.endsWith('MAXRESULTS 2');const data=toolData(read.tool_slug,complete?{QueryResponse:{Invoice:[{Id:'31'},{Id:'32'}],startPosition:31,maxResults:2}}:{data_preview:{Invoice:[{Id:'WRONG'}]}});
   if(!complete)data.data.remote_file_info={file_path:'/mnt/files/mex/fixture.json'};
   return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:{structuredContent:data}}));
  });
  const r=await new QuickBooksReadOnlyProvider(consumerConnection,h.request as typeof fetch,()=>key).execute('QUICKBOOKS_QUERY_ENTITIES',{query:"SELECT * FROM Invoice WHERE Balance > '0' STARTPOSITION 31 MAXRESULTS 10"});
  expect(queries).toEqual([10,5,2].map(size=>`SELECT * FROM Invoice WHERE Balance > '0' STARTPOSITION 31 MAXRESULTS ${size}`));expect(r.QueryResponse.Invoice.map((i:any)=>i.Id)).toEqual(['31','32']);
 });
 it.each([", ",","])('splits oversized exact-ID queries with separator %s and preserves every customer once',async(separator)=>{
  const h=harness();const original=h.request.getMockImplementation()!;const queries:string[]=[];
  h.request.mockImplementation(async(url:any,init:any)=>{
   const body=JSON.parse(init.body);if(body.method!=='tools/call')return original(url,init);
   const read=body.params.arguments.tools[0],query=read.arguments.query;queries.push(query);
   const ids=[...query.matchAll(/'(\d+)'/g)].map((m:any)=>m[1]);const rows=ids.map((Id:string)=>({Id}));const data=toolData(read.tool_slug,{QueryResponse:{Customer:rows,startPosition:1,maxResults:rows.length}});
   if(ids.length>1)data.data.remote_file_info={file_path:'/mnt/files/mex/fixture.json'};
   return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:{structuredContent:data}}));
  });
  const r=await new QuickBooksReadOnlyProvider(consumerConnection,h.request as typeof fetch,()=>key).execute('QUICKBOOKS_QUERY_ENTITIES',{query:`SELECT * FROM Customer WHERE Id IN (${[1,2,3].map(id=>`'${id}'`).join(separator)}) STARTPOSITION 1 MAXRESULTS 10`});
  expect(r.QueryResponse.Customer.map((i:any)=>i.Id)).toEqual(['1','2','3']);expect(r.QueryResponse.maxResults).toBe(3);expect(queries).toHaveLength(5);
 });
 it('never accepts a partial result for an oversized single source or retries a wrong-result envelope',async()=>{
  for(const wrongTool of [false,true]){
   const data=toolData(wrongTool?'QUICKBOOKS_READ_INVOICE':'QUICKBOOKS_QUERY_ENTITIES',{data_preview:{Invoice:[{Id:'1'}]}});data.data.remote_file_info={file_path:'/mnt/files/mex/fixture.json'};
   const h=harness({toolResult:{structuredContent:data}});
   await expect(new QuickBooksReadOnlyProvider(consumerConnection,h.request as typeof fetch,()=>key).execute('QUICKBOOKS_QUERY_ENTITIES',{query:"SELECT * FROM Invoice WHERE Balance > '0' STARTPOSITION 1 MAXRESULTS 1"})).rejects.toMatchObject({code:wrongTool?'provider_read_failed':'consumer_result_truncated'});
   expect(h.calls.filter(c=>c.body.method==='tools/call')).toHaveLength(1);
  }
 });

});
