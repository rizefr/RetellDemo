import {afterEach,describe,it,expect,vi} from 'vitest';
vi.mock('../services/outboundStripe',()=>({createOutboundCheckoutSession:vi.fn()}));
import {invoicePaymentProvider,verifiedCachedPaymentUrl} from '../services/outboundPaymentProvider';
const invoice={id:'invoice',source_provider:'quickbooks',source_realm_id:'123',provider_invoice_id:'81',amount_due_cents:12525,currency:'usd',source_verified_at:new Date().toISOString()};
const link={invoice_id:'invoice',provider:'quickbooks',source_realm_id:'123',provider_invoice_id:'81',amount_cents:12525,currency:'usd',status:'open',expires_at:new Date(Date.now()+60000).toISOString(),url:'https://connect.intuit.com/portal/app/CommerceNetwork/view/scs-v1-fixture'};
describe('payment source isolation',()=>{
 afterEach(()=>vi.restoreAllMocks());
 it('never substitutes Stripe for a QuickBooks source',()=>expect(invoicePaymentProvider(invoice,{payment_provider:'stripe'})).toBe('quickbooks'));
 it('keeps explicitly selected demo Stripe and manual providers separate',()=>{expect(invoicePaymentProvider({source_provider:'local'},{payment_provider:'stripe'})).toBe('stripe');expect(invoicePaymentProvider({source_provider:'local'},{payment_provider:'manual_followup'})).toBe('manual');});
 it('validates cached company, invoice and current balance',()=>{expect(verifiedCachedPaymentUrl(invoice,{},link)).toBe(link.url);for(const patch of [{source_realm_id:'other'},{invoice_id:'other'},{amount_cents:1},{currency:'cad'},{provider_invoice_id:'wrong'}])expect(verifiedCachedPaymentUrl(invoice,{}, {...link,...patch})).toBeNull();});
 it('blocks stale source verification and expired customer links',()=>{expect(verifiedCachedPaymentUrl({...invoice,source_verified_at:null},{},link)).toBeNull();expect(verifiedCachedPaymentUrl({...invoice,source_verified_at:'2020-01-01'},{},link)).toBeNull();expect(verifiedCachedPaymentUrl(invoice,{}, {...link,expires_at:'2020-01-01'})).toBeNull();});
 it('blocks accounting URLs and mislabelled Stripe links',()=>{expect(verifiedCachedPaymentUrl(invoice,{}, {...link,url:'https://qbo.intuit.com/app/invoice?txnId=81'})).toBeNull();expect(verifiedCachedPaymentUrl(invoice,{}, {...link,url:'https://checkout.stripe.com/c/pay/example'})).toBeNull();});
});
