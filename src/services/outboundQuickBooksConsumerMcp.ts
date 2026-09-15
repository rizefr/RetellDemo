import {createHash} from 'node:crypto';
import {QuickBooksSyncError,type QuickBooksConnection} from './outboundQuickBooksSync';

const MCP_ENDPOINT='https://connect.composio.dev/mcp';
const READ_TOOLS=new Set(['QUICKBOOKS_QUERY_ENTITIES','QUICKBOOKS_GET_COMPANY_INFO','QUICKBOOKS_READ_CUSTOMER','QUICKBOOKS_READ_INVOICE']);
const QUERY=/^SELECT \* FROM (?:Invoice|Customer)(?: WHERE (?:Balance > '0'|Id IN \('[A-Za-z0-9_\-', ]+'\)))? STARTPOSITION (\d+) MAXRESULTS (\d+)$/;
type JsonObject=Record<string,any>;
const error=(message:string,code='consumer_mcp_failed',status=503)=>new QuickBooksSyncError(message,status,code);
export function quickBooksConsumerCredentialConfigured(){return /^ck_[A-Za-z0-9_-]{12,2048}$/.test(process.env.QUICKBOOKS_COMPOSIO_CONSUMER_KEY||'');}
/** Compare against the independently verified exact-realm GET; CompanyInfo.Id is not a realm ID. */
export function quickBooksCompanyIdentityHash(company:JsonObject){
 if(company?.domain!=='QBO'||!company.CompanyName||!company.Country||!company.MetaData?.CreateTime)throw error('QuickBooks company identity is incomplete','company_mismatch',403);
 const address=company.LegalAddr||{};
 const values=[company.domain,company.CompanyName,company.LegalName,company.Country,company.CompanyStartDate,company.MetaData.CreateTime,address.Line1,address.Line2,address.City,address.CountrySubDivisionCode,address.PostalCode,address.Country].map(value=>String(value||''));
 return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
export function readConsumerToolResult(result:JsonObject,tool:string):JsonObject {
 const data=result?.data,rows=data?.results;
 if(result?.successful!==true||result.error||data?.total_count!==1||data.success_count!==1||data.error_count!==0||!Array.isArray(rows)||rows.length!==1)throw error('QuickBooks read is incomplete or failed','provider_read_failed');
 const row=rows[0];
 if(data.remote_file_info){
  if(row.index!==0||row.tool_slug!==tool||row.error||row.response?.successful!==true||row.response.error)throw error('QuickBooks returned a different or failed read result','provider_read_failed');
  throw error('QuickBooks read requires a smaller complete response','consumer_result_truncated');
 }
 if(row.index!==0||row.tool_slug!==tool||row.error||row.response?.successful!==true||row.response.error||!row.response.data||typeof row.response.data!=='object'||Array.isArray(row.response.data))throw error('QuickBooks returned a different or incomplete read result','provider_read_failed');
 return row.response.data;
}
export function verifyConsumerAccountList(result:JsonObject,connection:QuickBooksConnection){
 const toolkit=result?.data?.results?.quickbooks;
 if(result?.successful!==true||result.error||toolkit?.toolkit!=='quickbooks'||toolkit.status!=='active'||!Array.isArray(toolkit.accounts))throw error('QuickBooks consumer connection is unavailable','connection_not_active',409);
 const matches=toolkit.accounts.filter((account:JsonObject)=>account.id===connection.consumer_account_id);
 if(matches.length!==1||matches[0].status!=='active'||matches[0].account_type!=='PRIVATE'||!connection.provider_user_id||matches[0].user_info?.sub!==connection.provider_user_id)throw error('QuickBooks consumer account owner or status mismatch','connection_owner_mismatch',403);
 return matches[0];
}

/** Deterministic transport: no caller-selected endpoint, meta-tool, account, or write action. */
export class QuickBooksConsumerMcp {
 private id=0;
 private protocol='';
 private session='';
 private initialized:Promise<void>|null=null;
 private readonly deadline=Date.now()+240000;
 constructor(readonly connection:QuickBooksConnection,private readonly request:typeof fetch=fetch,private readonly credential:()=>string=()=>process.env.QUICKBOOKS_COMPOSIO_CONSUMER_KEY||''){
  if(!/^ca_[A-Za-z0-9_-]+$/.test(connection.connected_account_id)||!/^\d+$/.test(connection.realm_id)||!connection.verified_at||connection.status!=='active')throw error('A verified QuickBooks account and realm binding is required','connection_unverified',409);
 }
 private async response(response:Response,id:number|undefined):Promise<any>{
  if([401,403].includes(response.status))throw error('Composio consumer authorization failed or expired','provider_authorization_failed');
  if(!response.ok)throw error(`Composio consumer request failed (${response.status})`,'provider_request_failed');
  if(id===undefined){await response.body?.cancel();return null;}
  const decode=(raw:string)=>{let value;try{value=JSON.parse(raw);}catch{throw error('Composio returned an invalid protocol response','consumer_mcp_invalid_response');}return value;};
  const accepted=(value:any)=>{
   if(value?.jsonrpc!=='2.0'||value.id!==id||value.error||!Object.hasOwn(value,'result'))throw error('Composio rejected the read request','consumer_mcp_protocol_error');
   return value.result;
  };
  if((response.headers.get('content-type')||'').includes('text/event-stream')){
   const reader=response.body?.getReader();if(!reader)throw error('Composio returned an empty response','consumer_mcp_invalid_response');
   const decoder=new TextDecoder();let buffer='',bytes=0;
   try{
    while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>8*1024*1024)throw error('Composio response exceeds the safe limit','consumer_mcp_response_limit');buffer=(buffer+decoder.decode(chunk.value,{stream:true})).replace(/\r\n/g,'\n');let end;
     while((end=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=event.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!data)continue;const value=decode(data);if(value?.id===id)return accepted(value);}
    }
   }finally{await reader.cancel().catch(()=>{});}
   throw error('Composio response ended before the read completed','consumer_mcp_partial_response');
  }
  const raw=await response.text();if(raw.length>8*1024*1024)throw error('Composio response exceeds the safe limit','consumer_mcp_response_limit');return accepted(decode(raw));
 }
 private async rpc(method:'initialize'|'notifications/initialized'|'tools/list'|'tools/call',params:JsonObject={}){
  const key=this.credential();if(!/^ck_[A-Za-z0-9_-]{12,2048}$/.test(key))throw error('An approved Composio consumer credential is required','consumer_credential_missing');
  const id=method==='notifications/initialized'?undefined:++this.id;
  const headers:Record<string,string>={'Content-Type':'application/json','Accept':'application/json, text/event-stream','x-consumer-api-key':key};
  if(this.session)headers['Mcp-Session-Id']=this.session;if(this.protocol)headers['MCP-Protocol-Version']=this.protocol;
  // Only idempotent reads are retried. Preserve the JSON-RPC ID, session, account and body.
  const body=JSON.stringify({jsonrpc:'2.0',...(id===undefined?{}:{id}),method,params});
  const retryable=method==='tools/list'||method==='tools/call';
  for(let attempt=0;attempt<(retryable?3:1);attempt++){
   const remaining=this.deadline-Date.now();if(remaining<=0)throw error('QuickBooks read exceeded the request budget; nothing imported','provider_request_budget');
   let response:Response;
   try{response=await this.request(MCP_ENDPOINT,{method:'POST',redirect:'error',headers,body,signal:AbortSignal.timeout(Math.max(1,Math.min(25000,remaining)))});}
   catch{if(retryable&&attempt<2&&this.deadline-Date.now()>1000){await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));continue;}throw error('Composio consumer service could not be reached','provider_unreachable');}
   if(retryable&&[429,502,503,504].includes(response.status)&&attempt<2){
    const retryAfter=response.headers.get('retry-after');const delay=retryAfter&&/^\d+$/.test(retryAfter)?Math.min(Number(retryAfter)*1000,2000):250*(attempt+1);
    await response.body?.cancel();if(this.deadline-Date.now()<=delay)throw error('QuickBooks read exceeded the request budget; nothing imported','provider_request_budget');
    await new Promise(resolve=>setTimeout(resolve,delay));continue;
   }
   if(method==='initialize')this.session=response.headers.get('mcp-session-id')||'';
   return this.response(response,id);
  }
  throw error('Composio consumer service could not be reached','provider_unreachable');
 }
 private initialize(){
  this.initialized??=(async()=>{
   const result=await this.rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'pinnacle-read-only-invoices',version:'1.0.0'}});
   if(!['2025-11-25','2025-06-18','2025-03-26','2024-11-05'].includes(result?.protocolVersion))throw error('Composio protocol version is unsupported','consumer_mcp_protocol_unsupported');this.protocol=result.protocolVersion;
   await this.rpc('notifications/initialized');
   const tools:any[]=[],seen=new Set<string>();let cursor:string|undefined;
   for(let page=0;page<20;page++){const result=await this.rpc('tools/list',cursor?{cursor}:{});if(!Array.isArray(result?.tools))throw error('Composio tool schema is incomplete','consumer_mcp_schema_invalid');tools.push(...result.tools);if(!result.nextCursor)break;if(typeof result.nextCursor!=='string'||seen.has(result.nextCursor)||page===19)throw error('Composio tool schema pagination is incomplete','consumer_mcp_schema_invalid');seen.add(result.nextCursor);cursor=result.nextCursor;}
   const execute=tools.find(tool=>tool.name==='COMPOSIO_MULTI_EXECUTE_TOOL');
   if(execute?.inputSchema?.properties?.tools?.items?.properties?.account?.type!=='string')throw error('This Composio session cannot explicitly select the verified account','consumer_account_selection_unavailable',409);
   const management=tools.find(tool=>tool.name==='COMPOSIO_MANAGE_CONNECTIONS');
   if(!management?.inputSchema?.properties?.toolkits?.items?.properties?.action?.enum?.includes('list'))throw error('Read-only connection inspection is unavailable','consumer_connection_inspection_unavailable',409);
  })();
  return this.initialized;
 }
 private async call(name:'COMPOSIO_MANAGE_CONNECTIONS'|'COMPOSIO_MULTI_EXECUTE_TOOL',args:JsonObject){
  await this.initialize();const result=await this.rpc('tools/call',{name,arguments:args});
  if(result?.isError)throw error('Composio could not complete the read','provider_read_failed');
  if(result?.structuredContent && typeof result.structuredContent==='object')return result.structuredContent;
  const blocks=Array.isArray(result?.content)?result.content.filter((part:any)=>part.type==='text'&&typeof part.text==='string'):[];
  if(blocks.length!==1)throw error('Composio returned an incomplete read result','consumer_mcp_partial_response');
  try{return JSON.parse(blocks[0].text);}catch{throw error('Composio returned an invalid read result','consumer_mcp_invalid_response');}
 }
 async listConnections(){
  return this.call('COMPOSIO_MANAGE_CONNECTIONS',{toolkits:[{name:'quickbooks',action:'list'}]});
 }
 async executeRead(tool:string,args:JsonObject){
  if(!READ_TOOLS.has(tool))throw error('Only approved QuickBooks reads are allowed','operation_not_allowed',403);
  const keys=Object.keys(args).sort();
  if(tool==='QUICKBOOKS_QUERY_ENTITIES'){
   const query=typeof args.query==='string'?args.query:'';const match=QUERY.exec(query);
   if(keys.join(',')!=='query'||!match||Number(match[1])<1||Number(match[1])>10000||Number(match[2])<1||Number(match[2])>1000)throw error('Only bounded Invoice and Customer queries are allowed','operation_not_allowed',403);
  }else if(tool==='QUICKBOOKS_GET_COMPANY_INFO'){
   if(keys.join(',')!=='minorversion'||args.minorversion!==75)throw error('Unsupported company read parameters','operation_not_allowed',403);
  }else{
   const key=tool==='QUICKBOOKS_READ_CUSTOMER'?'customer_id':'invoice_id';const expected=key==='invoice_id'?'invoice_id,minorversion':'customer_id';
   if(keys.join(',')!==expected||typeof args[key]!=='string'||!/^\d+$/.test(args[key])||(key==='invoice_id'&&args.minorversion!==75))throw error('An exact numeric QuickBooks source ID is required','operation_not_allowed',403);
  }
  return this.call('COMPOSIO_MULTI_EXECUTE_TOOL',{tools:[{tool_slug:tool,arguments:args,account:this.connection.connected_account_id}],sync_response_to_workbench:false,current_step:'READING_VERIFIED_QUICKBOOKS',current_step_metric:'1/1 reads'});
 }
}
