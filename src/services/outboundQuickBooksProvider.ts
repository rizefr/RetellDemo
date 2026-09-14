import { QuickBooksSyncError, type QuickBooksConnection, type ReadExecutor } from './outboundQuickBooksSync';

const API = 'https://backend.composio.dev/api/v3.1';
export function quickBooksServerCredentialConfigured(): boolean {
  const key = process.env.QUICKBOOKS_COMPOSIO_API_KEY || '';
  // Personal CLI user credentials must not become a deployment credential.
  return Boolean(key && !key.startsWith('uak_'));
}
export class QuickBooksReadOnlyProvider {
  constructor(readonly connection: QuickBooksConnection, private readonly request: typeof fetch = fetch) {
    if (!/^\d+$/.test(connection.realm_id) || !/^ca_[A-Za-z0-9_-]+$/.test(connection.connected_account_id)) throw new QuickBooksSyncError('QuickBooks company binding is incomplete',409,'connection_unverified');
    if (connection.status !== 'active' || !connection.verified_at) throw new QuickBooksSyncError('QuickBooks company must be verified before use',409,'connection_unverified');
  }
  private async composio(path: string, body?: unknown): Promise<any> {
    if (!quickBooksServerCredentialConfigured()) throw new QuickBooksSyncError('A scoped server Composio API credential is required. The personal CLI connection is not a deployed integration.',503,'server_credential_missing');
    for (let attempt=0;attempt<3;attempt++) {
      let response: Response;
      try { response = await this.request(`${API}${path}`,{method:body?'POST':'GET',headers:{'x-api-key':process.env.QUICKBOOKS_COMPOSIO_API_KEY!,'Content-Type':'application/json','Accept':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)}); }
      catch { if(attempt===2) throw new QuickBooksSyncError('QuickBooks provider could not be reached; nothing imported',503,'provider_unreachable'); continue; }
      if ([429,502,503,504].includes(response.status) && attempt<2) { await new Promise(resolve=>setTimeout(resolve,250*(attempt+1))); continue; }
      if ([401,403].includes(response.status)) throw new QuickBooksSyncError('QuickBooks provider credentials expired or lack access to this company',503,'provider_authorization_failed');
      if (!response.ok) throw new QuickBooksSyncError(`QuickBooks provider request failed (${response.status}); nothing imported`,502,'provider_request_failed');
      const result = await response.json();
      if(result.successful === false || result.error || Number(result.status)>=400) throw new QuickBooksSyncError('QuickBooks provider rejected the read; nothing imported',502,'provider_read_failed');
      return result;
    }
    throw new QuickBooksSyncError('QuickBooks provider unavailable',503);
  }
  async verifyCompany() {
    const account = await this.composio(`/connected_accounts/${encodeURIComponent(this.connection.connected_account_id)}`);
    if(account.status!=='ACTIVE' || account.is_disabled || account.user_id!==this.connection.connection_owner_id || account.toolkit?.slug!=='quickbooks') throw new QuickBooksSyncError('QuickBooks connected-account owner or status mismatch',403,'connection_owner_mismatch');
    const expectedBase = this.connection.environment==='production'?'https://quickbooks.api.intuit.com':'https://sandbox-quickbooks.api.intuit.com';
    if((account.data?.base_url ?? account.params?.base_url)!==expectedBase) throw new QuickBooksSyncError('QuickBooks environment mismatch',403,'environment_mismatch');
    const data = await this.get(`companyinfo/${this.connection.realm_id}`);
    const company = data.CompanyInfo ?? data;
    if(company.domain!=='QBO' || company.CompanyName!==this.connection.company_name) throw new QuickBooksSyncError('QuickBooks company identity does not match this business',403,'company_mismatch');
    return {company_name:company.CompanyName,source_timezone:company.DefaultTimeZone,source_country:company.Country||null,realm_id:this.connection.realm_id,environment:this.connection.environment};
  }
  async get(relativePath: string, query: Record<string,string> = {}) {
    if(!/^(?:companyinfo\/\d+|invoice\/[A-Za-z0-9_-]+|customer\/[A-Za-z0-9_-]+|query)$/.test(relativePath)) throw new QuickBooksSyncError('Only approved QuickBooks read operations are allowed',403,'operation_not_allowed');
    if(relativePath==='query' && !/^SELECT \* FROM (?:Invoice|Customer)(?: WHERE (?:Balance > '0'|Id IN \('[A-Za-z0-9_\-', ]+'\)))? STARTPOSITION \d+ MAXRESULTS \d+$/.test(query.query||''))throw new QuickBooksSyncError('Only bounded approved QuickBooks queries are allowed',403,'operation_not_allowed');
    const base = this.connection.environment==='production'?'https://quickbooks.api.intuit.com':'https://sandbox-quickbooks.api.intuit.com';
    const url = new URL(`/v3/company/${this.connection.realm_id}/${relativePath}`,base);
    url.searchParams.set('minorversion','75');
    for(const [key,value] of Object.entries(query)) { if(!['query','include'].includes(key)) throw new QuickBooksSyncError('Unsupported QuickBooks parameter',400); url.searchParams.set(key,value); }
    // REST uses snake_case/type; the SDK's connectedAccountId/in aliases are transformed before transport.
    const result = await this.composio('/tools/execute/proxy',{endpoint:url.toString(),method:'GET',connected_account_id:this.connection.connected_account_id,parameters:[{name:'Accept',value:'application/json',type:'header'}]});
    return result.data ?? result;
  }
  execute: ReadExecutor = async (tool,args) => {
    if(tool==='QUICKBOOKS_QUERY_ENTITIES') {
      const query=String(args.query||'');
      if(!/^SELECT \* FROM (?:Invoice|Customer)(?: WHERE (?:Balance > '0'|Id IN \('[A-Za-z0-9_\-', ]+'\)))? STARTPOSITION \d+ MAXRESULTS \d+$/.test(query)) throw new QuickBooksSyncError('Only bounded approved QuickBooks queries are allowed',403,'operation_not_allowed');
      return this.get('query',{query});
    }
    if(tool==='QUICKBOOKS_READ_CUSTOMER' && /^[A-Za-z0-9_-]+$/.test(String(args.customer_id))) return this.get(`customer/${args.customer_id}`);
    throw new QuickBooksSyncError('Only approved QuickBooks read tools are allowed',403,'operation_not_allowed');
  };
  async invoice(id:string, includePaymentLink=false) {
    if(!/^[A-Za-z0-9_-]+$/.test(id)) throw new QuickBooksSyncError('Invalid QuickBooks invoice ID',400);
    const result=await this.get(`invoice/${id}`,includePaymentLink?{include:'invoiceLink'}:{});
    const invoice=result.Invoice ?? result;
    if(String(invoice.Id)!==id) throw new QuickBooksSyncError('QuickBooks returned a different invoice',502,'invoice_mismatch');
    return invoice;
  }
}
