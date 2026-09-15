import {afterEach,describe,it,expect,vi} from 'vitest';
import {buildQuickBooksPreview,daysPastDue,decimalMinorUnits,normalizeQuickBooksInvoice,quickBooksReportCsv,readQuickBooksInvoices,safeSpreadsheetValue,validateQuickBooksPaymentUrl,type QuickBooksConnection} from '../services/outboundQuickBooksSync';
import {QuickBooksReadOnlyProvider,quickBooksServerCredentialConfigured} from '../services/outboundQuickBooksProvider';
const now=new Date('2026-09-14T16:00:00Z');
const connection:QuickBooksConnection={business_id:'business-a',realm_id:'12345',company_name:'Fixture LLC',environment:'sandbox',connected_account_id:'ca_fixture',connection_owner_id:'owner',timezone:'America/New_York',verified_at:now.toISOString(),status:'active',source_country:'US'};
const customer={Id:'42',Active:true,DisplayName:'Fixture',PrimaryPhone:{FreeFormNumber:'2025550199'},PrimaryEmailAddr:{Address:'fixture@example.com'}};
const raw={Id:'81',DocNumber:'INV-1',CustomerRef:{value:'42'},Balance:125.25,TotalAmt:250,CurrencyRef:{value:'USD'},TxnDate:'2026-08-20',DueDate:'2026-08-30',Line:[{DetailType:'SalesItemLineDetail',SalesItemLineDetail:{ItemRef:{name:'Category 1'},ServiceDate:'2026-08-19'}}]};
const normalize=(patch:object={},c:object=customer)=>normalizeQuickBooksInvoice({...raw,...patch},c,connection,now);
describe('read-only QuickBooks integration boundaries',()=>{
 afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
 it('uses due date and exact fourteen day boundary',()=>{expect(normalize({DueDate:'2026-08-31'}).eligible).toBe(false);expect(normalize().days_overdue).toBe(15);expect(normalize().eligible).toBe(true);expect(normalize().inspection_date).toBe('2026-08-19');expect(normalize().invoice_date).toBe('2026-08-20');});
 it('counts calendar days across DST',()=>expect(daysPastDue('2026-03-01','America/New_York',new Date('2026-03-16T04:30:00Z'))).toBe(15));
 it('quarantines missing dates and invalid timezone',()=>{expect(normalize({DueDate:null}).mapping_valid).toBe(false);expect(normalizeQuickBooksInvoice(raw,customer,{...connection,timezone:'Invalid'},now).mapping_valid).toBe(false);});
 it('validates exact money and supported exponents',()=>{expect(decimalMinorUnits('10.01','USD')).toBe(1001);for(const amount of [-1,'1.001',Infinity,'1e3',2147483648])expect(decimalMinorUnits(amount,'USD')).toBeNull();expect(decimalMinorUnits(100,'JPY')).toBeNull();expect(decimalMinorUnits(1.234,'KWD')).toBeNull();});
 it('rejects balance greater than original invoice total',()=>expect(normalize({Balance:251}).mapping_valid).toBe(false));
 it('quarantines invalid contact and customer identity',()=>{expect(normalize({}, {...customer,PrimaryPhone:{FreeFormNumber:'123'}}).mapping_valid).toBe(false);expect(normalize({}, {...customer,Id:'wrong'}).mapping_valid).toBe(false);});
 it('normalizes verified US contact formats, preserves extensions and distinguishes missing values',()=>{
  const row=normalize({}, {...customer,PrimaryPhone:{FreeFormNumber:'(202) 555-0199 ext. 123'}});
  expect(row.phone_number).toBe('+12025550199');expect(row.source_values.customer_phone_extension).toBe('123');
  const missing=normalize({}, {...customer,PrimaryPhone:undefined,PrimaryEmailAddr:undefined});
  expect(missing.block_reasons).toContain('missing_phone_number');expect(missing.block_reasons).toContain('missing_email');expect(missing.block_reasons).not.toContain('invalid_phone_number');
  for(const value of ['first@example.com,second@example.com','a,b@example.com','a;b@example.com']){const invalid=normalize({}, {...customer,PrimaryEmailAddr:{Address:value}});expect(invalid.email).toBeNull();expect(invalid.block_reasons).toContain('multiple_email_recipients');}
 });
 it('does not assume a country for local phone numbers from an unverified or foreign company',()=>{
  for(const country of [undefined,'GB'])expect(normalizeQuickBooksInvoice(raw,customer,{...connection,source_country:country},now).block_reasons).toContain('phone_region_unverified');
  expect(normalizeQuickBooksInvoice(raw,{...customer,PrimaryPhone:{FreeFormNumber:'+442079460018'}},{...connection,source_country:'GB'},now).phone_number).toBe('+442079460018');
 });
 it('quarantines ambiguous service dates or unrecognized service type',()=>{expect(normalize({Line:[...raw.Line,{DetailType:'SalesItemLineDetail',SalesItemLineDetail:{ItemRef:{name:'Category 1'},ServiceDate:'2026-08-18'}}]}).mapping_valid).toBe(false);expect(normalize({Line:[{DetailType:'SalesItemLineDetail',SalesItemLineDetail:{ItemRef:{name:'Consulting'},ServiceDate:'2026-08-19'}}]}).mapping_valid).toBe(false);});
 it('preserves paid invoices for reconciliation while preventing outreach',()=>{const row=normalize({Balance:0});expect(row.mapping_valid).toBe(true);expect(row.eligible).toBe(false);expect(row.block_reasons).toContain('invoice_paid');});
 it('rejects duplicate invoices and cross-company source records',()=>{expect(()=>buildQuickBooksPreview(connection,[normalize(),normalize()],now)).toThrow(/Duplicate/);expect(()=>buildQuickBooksPreview(connection,[{...normalize(),source_realm_id:'other'}],now)).toThrow(/company mismatch/);});
 it('keeps currency totals separate and preview immutable',()=>{const p=buildQuickBooksPreview(connection,[normalize(),normalize({Id:'82',CurrencyRef:{value:'CAD'}})],now);expect(p.totals_by_currency).toHaveLength(2);expect(p.hash).toHaveLength(64);expect(p.accounting_writes).toBe(false);expect(p.outreach_started).toBe(false);});
 it('sanitizes formula injection and exports money in major units',()=>{for(const s of ['=cmd',' +1','\t@SUM','-1'])expect(safeSpreadsheetValue(s).startsWith("'")).toBe(true);expect(quickBooksReportCsv([normalize()])).toContain('125.25');});
 it('only accepts actual Intuit customer payment destinations',()=>{expect(validateQuickBooksPaymentUrl('https://connect.intuit.com/portal/app/CommerceNetwork/view/scs-v1-fixture')).toBeTruthy();for(const url of ['https://qbo.intuit.com/app/invoice?txnId=81','https://connect.intuit.com.evil.com/portal/x','http://connect.intuit.com/pay/x','https://user@connect.intuit.com/pay/x'])expect(validateQuickBooksPaymentUrl(url)).toBeNull();});
 it('accepts the exact InvoiceLink token path observed from a verified existing Intuit invoice',()=>{expect(validateQuickBooksPaymentUrl('https://connect.intuit.com/t/scs-v1-fixtureToken_123')).toBeTruthy();for(const url of ['https://connect.intuit.com/t/arbitrary','https://connect.intuit.com/t/scs-v1-','https://connect.quickbooks.com/t/scs-v1-fixture','https://connect.intuit.com/t/scs-v1-fixture/redirect','https://connect.intuit.com.evil.com/t/scs-v1-fixture'])expect(validateQuickBooksPaymentUrl(url)).toBeNull();});
 it('refuses incomplete pages and duplicate pagination',async()=>{await expect(readQuickBooksInvoices(async()=>({}),connection,now)).rejects.toThrow(/incomplete/);await expect(readQuickBooksInvoices(async()=>({QueryResponse:{Invoice:[raw]}}),connection,now)).rejects.toThrow(/Repeated/);});
 it('reads complete invoices and resolves customers only by source IDs',async()=>{const execute=vi.fn().mockResolvedValueOnce({QueryResponse:{Invoice:[raw]}}).mockResolvedValueOnce({QueryResponse:{}}).mockResolvedValueOnce({QueryResponse:{Customer:[customer]}});const p=await readQuickBooksInvoices(execute,connection,now);expect(p.counts.fetched).toBe(1);expect(execute.mock.calls[0][1].query).toContain("Balance > '0'");expect(execute.mock.calls[2][1].query).toContain("Id IN ('42')");});
 it('rejects personal CLI credential and all write operations',async()=>{vi.stubEnv('QUICKBOOKS_COMPOSIO_API_KEY','uak_private');expect(quickBooksServerCredentialConfigured()).toBe(false);const provider=new QuickBooksReadOnlyProvider(connection);await expect(provider.get('invoice')).rejects.toThrow(/approved/);await expect(provider.execute('QUICKBOOKS_SEND_INVOICE',{})).rejects.toThrow(/approved/);await expect(provider.invoice('81')).rejects.toThrow(/scoped server/);});
 it('binds the exact account, realm and GET invoiceLink read without sending',async()=>{vi.stubEnv('QUICKBOOKS_COMPOSIO_API_KEY','scoped-fixture');const request=vi.fn().mockResolvedValue(new Response(JSON.stringify({data:{Invoice:raw}}),{status:200}));await new QuickBooksReadOnlyProvider(connection,request).invoice('81',true);const payload=JSON.parse(request.mock.calls[0][1].body);expect(payload.method).toBe('GET');expect(payload.connected_account_id).toBe('ca_fixture');expect(payload).not.toHaveProperty('connectedAccountId');expect(payload.parameters).toEqual([{name:'Accept',value:'application/json',type:'header'}]);expect(request.mock.calls[0][0]).toBe('https://backend.composio.dev/api/v3.1/tools/execute/proxy');expect(payload.endpoint).toContain('/v3/company/12345/invoice/81');expect(payload.endpoint).toContain('include=invoiceLink');});
 it('verifies raw managed-account metadata and company through the exact bound realm',async()=>{
  vi.stubEnv('QUICKBOOKS_COMPOSIO_API_KEY','scoped-fixture');
  const account={status:'ACTIVE',is_disabled:false,user_id:'owner',toolkit:{slug:'quickbooks'},data:{base_url:'https://sandbox-quickbooks.api.intuit.com'}};
  const request=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(account),{status:200})).mockResolvedValueOnce(new Response(JSON.stringify({data:{CompanyInfo:{Id:'1',domain:'QBO',CompanyName:'Fixture LLC',DefaultTimeZone:'America/Los_Angeles'}}}),{status:200}));
  const result=await new QuickBooksReadOnlyProvider(connection,request).verifyCompany();
  expect(request.mock.calls[0][0]).toBe('https://backend.composio.dev/api/v3.1/connected_accounts/ca_fixture');
  expect(request.mock.calls[0][1].method).toBe('GET');
  expect(JSON.parse(request.mock.calls[1][1].body).endpoint).toContain('/v3/company/12345/companyinfo/12345');
  expect(result.realm_id).toBe('12345');expect(result.source_timezone).toBe('America/Los_Angeles');
 });
 it('blocks a disabled account or mismatched environment before any company read',async()=>{
  vi.stubEnv('QUICKBOOKS_COMPOSIO_API_KEY','scoped-fixture');
  for(const patch of [{is_disabled:true},{data:{base_url:'https://quickbooks.api.intuit.com'}}]){
   const request=vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'ACTIVE',is_disabled:false,user_id:'owner',toolkit:{slug:'quickbooks'},data:{base_url:'https://sandbox-quickbooks.api.intuit.com'},...patch}),{status:200}));
   await expect(new QuickBooksReadOnlyProvider(connection,request).verifyCompany()).rejects.toThrow(/mismatch/);expect(request).toHaveBeenCalledTimes(1);
  }
 });
 it('redacts provider credential failures and verifies owner',async()=>{vi.stubEnv('QUICKBOOKS_COMPOSIO_API_KEY','secret-fixture');const denied=new QuickBooksReadOnlyProvider(connection,vi.fn().mockResolvedValue(new Response('secret-fixture',{status:401})));await expect(denied.invoice('81')).rejects.toThrow(/expired/);const mismatch=new QuickBooksReadOnlyProvider(connection,vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'ACTIVE',user_id:'wrong',toolkit:{slug:'quickbooks'}}),{status:200})));await expect(mismatch.verifyCompany()).rejects.toThrow(/owner/);});
});
