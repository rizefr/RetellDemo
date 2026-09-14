import { createHash } from 'node:crypto';
import { DateTime } from 'luxon';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

export type QuickBooksConnection = {
  business_id: string; realm_id: string; company_name: string; environment: 'production' | 'sandbox';
  connected_account_id: string; connection_owner_id: string; timezone: string; verified_at: string;
  status: string; source_country?: string | null; last_successful_sync_at?: string | null; sync_enabled?: boolean;
};
export type SourceInvoice = {
  source_provider: 'quickbooks'; source_realm_id: string; provider_invoice_id: string; provider_customer_id: string;
  invoice_id: string; customer_account: string; first_name: string; last_name: string; email: string | null;
  phone_number: string | null; invoice_email: string | null; invoice_date: string | null; original_due_date: string | null;
  inspection_date: string | null; inspection_type: string | null; service_description: string; original_total_cents: number | null;
  source_balance_cents: number | null; currency: string | null; days_overdue: number | null; source_link: string;
  payment_link_available: boolean; payment_link: string | null; source_verified_at: string; source_updated_at: string | null;
  source_sync_token: string | null; block_reasons: string[]; eligible: boolean; mapping_valid: boolean;
  source_values: Record<string, unknown>;
  last_contact?:string|null; next_action?:string|null; promised_payment_date?:string|null; preferred_contact?:string|null;
};
export class QuickBooksSyncError extends Error {
  constructor(message: string, public status = 409, public code = 'quickbooks_blocked') { super(message); }
}
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const INSPECTION_TYPES: Record<string,string> = {'Category 1':'Category 1','Category 5':'Category 5','Acceptance Test':'Acceptance Test','Periodic Inspection':'Periodic Inspection','Periodic Elevator Test:Periodic Elevator Inspection':'Periodic Inspection'};
const CURRENCY_EXPONENTS: Record<string, number> = { USD: 2, CAD: 2, EUR: 2, GBP: 2, AUD: 2, NZD: 2, CHF: 2, SGD: 2, HKD: 2 };
const asObject = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
const str = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
export function validDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = DateTime.fromISO(value, { zone: 'UTC' });
  return d.isValid && d.toISODate() === value ? value : null;
}
export function decimalMinorUnits(value: unknown, currency: string): number | null {
  const exponent = CURRENCY_EXPONENTS[currency.toUpperCase()];
  if (exponent === undefined || !['number','string'].includes(typeof value)) return null;
  const raw = String(value);
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const [whole, decimals = ''] = raw.split('.');
  if (decimals.slice(exponent).replace(/0/g, '')) return null;
  const result = Number(whole) * 10 ** exponent + Number(decimals.slice(0, exponent).padEnd(exponent, '0'));
  return Number.isSafeInteger(result) && result <= 2147483647 ? result : null;
}
export function daysPastDue(date: unknown, timezone: string, now = new Date()): number | null {
  const due = validDate(date);
  const local = DateTime.fromJSDate(now, { zone: timezone });
  if (!due || !local.isValid) return null;
  return Math.round(local.startOf('day').diff(DateTime.fromISO(due, { zone: timezone }).startOf('day'), 'days').days);
}
export function safeSpreadsheetValue(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
}
export function validateQuickBooksPaymentUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    if (!['connect.intuit.com','connect.quickbooks.com'].includes(url.hostname.toLowerCase())) return null;
    const customerPortal=/^\/(?:portal|pay)\//.test(url.pathname);
    const invoiceShareToken=url.hostname.toLowerCase()==='connect.intuit.com' && /^\/t\/scs-v1-[A-Za-z0-9_-]+$/.test(url.pathname);
    if (!customerPortal && !invoiceShareToken) return null;
    return url.toString();
  } catch { return null; }
}
export function normalizeQuickBooksInvoice(raw: unknown, rawCustomer: unknown, connection: QuickBooksConnection, now = new Date()): SourceInvoice {
  const i = asObject(raw), customer = asObject(rawCustomer);
  const invoiceId = str(i.Id), customerId = str(i.CustomerRef?.value);
  const currency = str(i.CurrencyRef?.value).toUpperCase();
  const balance = decimalMinorUnits(i.Balance, currency), total = decimalMinorUnits(i.TotalAmt, currency);
  const due = validDate(i.DueDate), invoiceDate = validDate(i.TxnDate);
  const days = daysPastDue(due, connection.timezone, now);
  const serviceLines = (Array.isArray(i.Line) ? i.Line : []).filter((line: any) => line.DetailType === 'SalesItemLineDetail' && !/filing fee|sales tax|discount/i.test(str(line.SalesItemLineDetail?.ItemRef?.name)));
  const dates = [...new Set<string>(serviceLines.map((line: any) => validDate(line.SalesItemLineDetail?.ServiceDate)).filter((date: string | null): date is string => date !== null))];
  const sourceTypes = serviceLines.map((line: any) => str(line.SalesItemLineDetail?.ItemRef?.name));
  const types = [...new Set<string>(sourceTypes.map((name:string)=>INSPECTION_TYPES[name]).filter(Boolean))];
  const phoneRaw = str(customer.PrimaryPhone?.FreeFormNumber);
  const sourceCountry=str(connection.source_country).toUpperCase();
  const phoneRegionVerified=phoneRaw.startsWith('+') || sourceCountry==='US';
  const parsedPhone = parsePhoneNumberFromString(phoneRaw, sourceCountry==='US' ? 'US' : undefined);
  const emailRaw = str(customer.PrimaryEmailAddr?.Address);
  const invoiceEmail = str(i.BillEmail?.Address);
  const linkRaw = i.InvoiceLink ?? i.invoiceLink;
  const link = validateQuickBooksPaymentUrl(linkRaw);
  const blocks: string[] = [];
  if(!DateTime.fromJSDate(now,{zone:connection.timezone}).isValid)blocks.push('invalid_business_timezone');
  if (!ID.test(invoiceId) || !ID.test(customerId) || str(customer.Id) !== customerId) blocks.push('invalid_source_identity');
  if (customer.Active === false) blocks.push('inactive_customer');
  if (!Object.hasOwn(CURRENCY_EXPONENTS,currency)) blocks.push('unsupported_or_missing_currency');
  if (balance === null || total === null || (balance !== null && total !== null && balance > total)) blocks.push('invalid_amount');
  if (!due) blocks.push('missing_or_invalid_due_date');
  if (!invoiceDate) blocks.push('missing_or_invalid_invoice_date');
  if (dates.length !== 1) blocks.push(dates.length ? 'ambiguous_service_date' : 'missing_service_date');
  if (types.length !== 1 || sourceTypes.some((name:string)=>!INSPECTION_TYPES[name])) blocks.push(types.length ? 'ambiguous_service_type' : 'missing_service_type');
  if (!parsedPhone?.isValid()) blocks.push(!phoneRaw ? 'missing_phone_number' : !phoneRegionVerified ? 'phone_region_unverified' : 'invalid_phone_number');
  if (!EMAIL.test(emailRaw) && !EMAIL.test(invoiceEmail)) blocks.push(!emailRaw && !invoiceEmail ? 'missing_email' : [emailRaw,invoiceEmail].some(value=>value.includes(',')||value.includes(';')||(value.match(/@/g)||[]).length>1) ? 'multiple_email_recipients' : 'invalid_email');
  if (balance === 0) blocks.push('invoice_paid');
  if (days !== null && days <= 14) blocks.push('not_more_than_14_days_overdue');
  if (linkRaw && !link) blocks.push('invalid_payment_link');
  const mappingErrors = blocks.filter(reason => !['invoice_paid','not_more_than_14_days_overdue','invalid_email','missing_email','multiple_email_recipients','invalid_payment_link'].includes(reason));
  return {
    source_provider: 'quickbooks', source_realm_id: connection.realm_id, provider_invoice_id: invoiceId,
    provider_customer_id: customerId, invoice_id: str(i.DocNumber) || invoiceId,
    customer_account: str(customer.CompanyName) || str(customer.DisplayName) || str(i.CustomerRef?.name),
    first_name: str(customer.GivenName), last_name: str(customer.FamilyName),
    email: EMAIL.test(emailRaw) ? emailRaw : null, invoice_email: EMAIL.test(invoiceEmail) ? invoiceEmail : null,
    phone_number: parsedPhone?.isValid() ? parsedPhone.number : null,
    invoice_date: invoiceDate, original_due_date: due, inspection_date: dates.length === 1 ? dates[0] : null,
    inspection_type: types.length === 1 ? types[0] : null, service_description: types.join('; '),
    original_total_cents: total, source_balance_cents: balance, currency: currency || null, days_overdue: days,
    source_link: `https://qbo.intuit.com/app/invoice?txnId=${encodeURIComponent(invoiceId)}`,
    payment_link_available: Boolean(link), payment_link: link, source_verified_at: now.toISOString(),
    source_updated_at: str(i.MetaData?.LastUpdatedTime) || null, source_sync_token: str(i.SyncToken) || null,
    block_reasons: blocks, eligible: blocks.length === 0, mapping_valid: mappingErrors.length === 0,
    source_values: { Id: i.Id, CustomerRef: i.CustomerRef, DocNumber: i.DocNumber, TxnDate: i.TxnDate, DueDate: i.DueDate,
      TotalAmt: i.TotalAmt, Balance: i.Balance, CurrencyRef: i.CurrencyRef,
      service_lines: serviceLines.map((l: any) => ({ ItemRef: l.SalesItemLineDetail?.ItemRef, ServiceDate: l.SalesItemLineDetail?.ServiceDate })),
      AllowOnlineACHPayment: i.AllowOnlineACHPayment, AllowOnlineCreditCardPayment: i.AllowOnlineCreditCardPayment,
      source_country:sourceCountry||null,customer_phone:phoneRaw,customer_phone_extension:parsedPhone?.ext||null,customer_email:emailRaw,invoice_email:invoiceEmail },
  };
}
export function buildQuickBooksPreview(connection: QuickBooksConnection, rows: SourceInvoice[], now = new Date()) {
  const keys = rows.map(row => `${row.source_realm_id}:${row.provider_invoice_id}`);
  if (new Set(keys).size !== keys.length) throw new QuickBooksSyncError('Duplicate QuickBooks invoice IDs in source response', 502, 'duplicate_source_invoice');
  if (rows.some(row => row.source_realm_id !== connection.realm_id)) throw new QuickBooksSyncError('QuickBooks company mismatch',403,'company_mismatch');
  const totals: Record<string,{currency:string;invoice_count:number;original_total_minor:number;remaining_balance_minor:number;overdue_balance_minor:number}> = {};
  for (const row of rows) {
    if (!row.currency || row.source_balance_cents === null || row.original_total_cents === null) continue;
    const bucket = totals[row.currency] ??= {currency:row.currency,invoice_count:0,original_total_minor:0,remaining_balance_minor:0,overdue_balance_minor:0};
    bucket.invoice_count++; bucket.original_total_minor += row.original_total_cents; bucket.remaining_balance_minor += row.source_balance_cents;
    if ((row.days_overdue ?? -1)>14) bucket.overdue_balance_minor += row.source_balance_cents;
  }
  const payload = {business_id:connection.business_id,realm_id:connection.realm_id,company_name:connection.company_name,environment:connection.environment,timezone:connection.timezone,rows};
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return { ...payload, hash, status:'preview' as const, counts:{fetched:rows.length,eligible:rows.filter(r=>r.eligible).length,quarantined:rows.filter(r=>!r.mapping_valid).length,excluded:rows.filter(r=>!r.eligible).length}, totals_by_currency:Object.values(totals), exclusions:rows.filter(r=>r.block_reasons.length).map(r=>({invoice_id:r.invoice_id,provider_invoice_id:r.provider_invoice_id,reasons:r.block_reasons})),created_at:now.toISOString(),expires_at:new Date(now.getTime()+15*60*1000).toISOString(),accounting_writes:false,outreach_started:false };
}
export type ReadExecutor = (tool: string, args: Record<string,unknown>) => Promise<any>;
export async function readQuickBooksInvoices(execute: ReadExecutor, connection: QuickBooksConnection, now = new Date()) {
  const invoices: any[] = [], customers = new Map<string,any>(), seen = new Set<string>();
  for (let page=0;page<100;page++) {
    const response = await execute('QUICKBOOKS_QUERY_ENTITIES',{query:`SELECT * FROM Invoice STARTPOSITION ${page*100+1} MAXRESULTS 100`});
    const data = response?.QueryResponse;
    if (!data || typeof data !== 'object') throw new QuickBooksSyncError('QuickBooks query response was incomplete; nothing imported',502,'partial_source_response');
    const values = data.Invoice ?? [];
    if (!Array.isArray(values)) throw new QuickBooksSyncError('Invalid QuickBooks invoice page',502);
    if (!values.length) break;
    for (const invoice of values) {
      const id = str(invoice.Id); if (!id || seen.has(id)) throw new QuickBooksSyncError('Repeated or missing invoice ID; sync stopped',502,'duplicate_source_invoice');
      seen.add(id); invoices.push(invoice);
    }
    if (page===99) throw new QuickBooksSyncError('QuickBooks sync exceeded page limit; nothing imported',502,'pagination_limit');
  }
  const customerIds=[...new Set<string>(invoices.map(invoice=>str(invoice.CustomerRef?.value)).filter(id=>ID.test(id)))];
  for(let offset=0;offset<customerIds.length;offset+=100) {
    const chunk=customerIds.slice(offset,offset+100);
    const query="SELECT * FROM Customer WHERE Id IN ("+chunk.map(id=>"'"+id+"'").join(',')+") STARTPOSITION 1 MAXRESULTS 1000";
    const response=await execute('QUICKBOOKS_QUERY_ENTITIES',{query});
    if(!response?.QueryResponse || !Array.isArray(response.QueryResponse.Customer??[])) throw new QuickBooksSyncError('QuickBooks customer query was incomplete; nothing imported',502,'partial_source_response');
    for(const customer of response.QueryResponse.Customer??[]) {
      if(!chunk.includes(str(customer.Id)) || customers.has(str(customer.Id))) throw new QuickBooksSyncError('QuickBooks customer identity mismatch',502,'invalid_source_identity');
      customers.set(str(customer.Id),customer);
    }
  }
  return buildQuickBooksPreview(connection,invoices.map(i=>normalizeQuickBooksInvoice(i,customers.get(str(i.CustomerRef?.value)),connection,now)),now);
}
export const QUICKBOOKS_REPORT_COLUMNS: Array<[string,keyof SourceInvoice]> = [
  ['Customer/account','customer_account'],['QuickBooks invoice ID','provider_invoice_id'],['Invoice number','invoice_id'],['Inspection/service','service_description'],['Inspection date','inspection_date'],['Invoice date','invoice_date'],['Due date','original_due_date'],['Original total','original_total_cents'],['Remaining balance','source_balance_cents'],['Currency','currency'],['Days overdue','days_overdue'],['Phone','phone_number'],['Customer email','email'],['Invoice email','invoice_email'],['Accounting source link (not payment)','source_link'],['Payment link available','payment_link_available'],['Last sync','source_verified_at'],['Eligible','eligible'],['Block reason','block_reasons'],['Last contact','last_contact'],['Next action','next_action'],['Promised payment date','promised_payment_date'],['Preferred contact','preferred_contact'],
];
export function quickBooksReportCsv(rows: SourceInvoice[]): string {
  const csv = (v:unknown) => `"${safeSpreadsheetValue(Array.isArray(v)?v.join('; '):v).replace(/"/g,'""')}"`;
  return [QUICKBOOKS_REPORT_COLUMNS.map(([label])=>csv(label)).join(','),...rows.map(row=>QUICKBOOKS_REPORT_COLUMNS.map(([,key])=>csv(['original_total_cents','source_balance_cents'].includes(key)&&row[key]!==null ? (Number(row[key])/100).toFixed(2):row[key])).join(','))].join('\r\n');
}
