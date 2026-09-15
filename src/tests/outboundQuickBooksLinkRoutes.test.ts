import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import request from "supertest";

// Exercise the real resolver and route; all provider reads and database writes
// below are local fixtures. No QuickBooks, Stripe, or messaging request is sent.
const mocks=vi.hoisted(()=>({context:vi.fn(),reverify:vi.fn(),connection:vi.fn(),invoice:vi.fn(),active:vi.fn(),create:vi.fn(),update:vi.fn(),event:vi.fn(),stripe:vi.fn()}));
vi.mock("../services/outboundRepository",async()=>({...await vi.importActual<typeof import("../services/outboundRepository")>("../services/outboundRepository"),getOutboundInvoiceContext:mocks.context,getActiveOutboundPaymentLink:mocks.active,createOutboundPaymentLinkRecord:mocks.create,updateOutboundPaymentLinkRecord:mocks.update,insertOutboundEvent:mocks.event}));
vi.mock("../services/outboundQuickBooksIntegration",async()=>({...await vi.importActual<typeof import("../services/outboundQuickBooksIntegration")>("../services/outboundQuickBooksIntegration"),reverifyQuickBooksInvoiceBeforeOutreach:mocks.reverify,getQuickBooksConnection:mocks.connection}));
vi.mock("../services/outboundQuickBooksProvider",async()=>({...await vi.importActual<typeof import("../services/outboundQuickBooksProvider")>("../services/outboundQuickBooksProvider"),QuickBooksReadOnlyProvider:class {invoice=mocks.invoice;}}));
vi.mock("../services/outboundStripe",async()=>({...await vi.importActual<typeof import("../services/outboundStripe")>("../services/outboundStripe"),createOutboundCheckoutSession:mocks.stripe}));

const businessId="00000000-0000-4000-8000-000000000041",customerId="00000000-0000-4000-8000-000000000042",invoiceId="00000000-0000-4000-8000-000000000043";
const url="https://connect.intuit.com/t/scs-v1-fixtureToken_123";
function context(){return {invoice:{id:invoiceId,business_id:businessId,customer_id:customerId,source_provider:"quickbooks",provider_invoice_id:"42",provider_customer_id:"9",source_realm_id:"12345",amount_due_cents:17550,currency:"usd",status:"unpaid"},business:{id:businessId,payment_provider:"quickbooks"},customer:{id:customerId,business_id:businessId}};}
const providerInvoice=()=>({Id:"42",Balance:175.5,CurrencyRef:{value:"USD"},CustomerRef:{value:"9"},InvoiceLink:url});
async function post(body:object={business_id:businessId,invoice_id:invoiceId},origin?:string,authenticated=true,browserSession=false){
 const {createApp}=await import("../app");
 const call=request(createApp()).post("/api/outbound/quickbooks/invoice-link");
 if(browserSession){const {createOutboundAdminCookie}=await import("../services/outboundAuth");call.set("Cookie",createOutboundAdminCookie("fixture-link-admin").split(";")[0]);}
 else if(authenticated)call.set("Authorization","Bearer fixture-link-admin");
 if(origin)call.set("Origin",origin);
 return call.send(body);
}
beforeEach(()=>{
 vi.stubEnv("NODE_ENV","test");vi.stubEnv("OUTBOUND_ADMIN_TOKEN","fixture-link-admin");vi.resetModules();
 Object.values(mocks).forEach(mock=>mock.mockReset());
 mocks.context.mockImplementation(async()=>context());mocks.reverify.mockResolvedValue(context());
 mocks.connection.mockResolvedValue({business_id:businessId,realm_id:"12345"});mocks.invoice.mockResolvedValue(providerInvoice());
 mocks.active.mockResolvedValue(null);mocks.create.mockImplementation(async input=>({id:"fixture-link",...input}));mocks.update.mockResolvedValue({});mocks.event.mockResolvedValue({});
});
afterEach(()=>{expect(mocks.stripe).not.toHaveBeenCalled();vi.unstubAllEnvs();});

describe("QuickBooks-only payment-link retrieval",()=>{
 it("requires authentication and trusted browser origin before reading invoice data",async()=>{
  expect((await post(undefined,undefined,false)).status).toBe(401);
  expect((await post(undefined,"https://untrusted.example.test",false,true)).status).toBe(403);
  expect(mocks.context).not.toHaveBeenCalled();expect(mocks.invoice).not.toHaveBeenCalled();
 });
 it.each(["invoice","customer","business","customer_id"])("rejects mismatched %s before any provider read",async field=>{
  const value=context();
  if(field==="invoice")value.invoice.business_id="other";
  if(field==="customer")value.customer.business_id="other";
  if(field==="business")value.business.id="other";
  if(field==="customer_id")value.invoice.customer_id="other";
  mocks.context.mockResolvedValue(value);
  const response=await post();expect(response.status).toBe(403);expect(response.body.code).toBe("invoice_business_mismatch");
  expect(mocks.reverify).not.toHaveBeenCalled();expect(mocks.invoice).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();
 });
 it("rejects a local Stripe invoice even if its business selects QuickBooks",async()=>{
  const value=context();value.invoice.source_provider="local";mocks.context.mockResolvedValue(value);
  const response=await post();expect(response.status).toBe(409);expect(response.body.code).toBe("quickbooks_invoice_unverified");expect(mocks.reverify).not.toHaveBeenCalled();
 });
 it.each(["source","tenant"])("guards a changed %s on the resolver's second read before the Stripe branch",async field=>{
  const changed=context();if(field==="source"){changed.invoice.source_provider="local";changed.business.payment_provider="stripe";}else changed.customer.business_id="other";
  mocks.context.mockResolvedValueOnce(context()).mockResolvedValue(changed);
  const response=await post();expect(response.status).toBe(field==="source"?409:403);expect(mocks.reverify).not.toHaveBeenCalled();expect(mocks.invoice).not.toHaveBeenCalled();
 });
 it("reads and locally caches a genuine existing invoice link without marking delivery",async()=>{
  const response=await post();expect(response.status).toBe(200);
  expect(response.body).toMatchObject({provider:"quickbooks",available:true,reused:false,manual_fallback:false,sent:false,accounting_writes:false,payment_link:{url,amount_cents:17550,currency:"usd"}});
  expect(mocks.invoice).toHaveBeenCalledWith("42",true);
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({invoice_id:invoiceId,business_id:businessId,provider:"quickbooks",sent_via:null}));
  expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({event_type:"quickbooks_payment_link_retrieved",payload:expect.objectContaining({delivery_requested:false,reused:false})}));
  expect(JSON.stringify(mocks.event.mock.calls)).not.toContain(url);
 });
 it("reuses the exact unexpired local QuickBooks link after current invoice verification",async()=>{
  mocks.active.mockResolvedValue({id:"existing-link",invoice_id:invoiceId,provider:"quickbooks",url,amount_cents:17550,currency:"usd",source_realm_id:"12345",provider_invoice_id:"42",expires_at:new Date(Date.now()+60000).toISOString(),private_payload:"not returned"});
  const response=await post();expect(response.status).toBe(200);expect(response.body.reused).toBe(true);expect(response.body.payment_link.id).toBe("existing-link");expect(JSON.stringify(response.body)).not.toContain("private_payload");
  expect(mocks.reverify).toHaveBeenCalledWith(invoiceId);expect(mocks.create).not.toHaveBeenCalled();expect(mocks.update).not.toHaveBeenCalled();
 });
 it.each(["invoice_paid","not_overdue","outreach_blocked"])("preserves current eligibility rejection %s",async code=>{
  const {QuickBooksSyncError}=await import("../services/outboundQuickBooksSync");mocks.reverify.mockRejectedValue(new QuickBooksSyncError("private provider detail",409,code));
  const response=await post();expect(response.status).toBe(409);expect(response.body).toMatchObject({available:false,sent:false,code});expect(response.body.error).not.toContain("private provider");expect(mocks.invoice).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();
 });
 it.each([{Balance:175.49},{CurrencyRef:{value:"EUR"}},{CustomerRef:{value:"other"}}])("rejects changed provider invoice %j without a cache write",async change=>{
  mocks.invoice.mockResolvedValue({...providerInvoice(),...change});const response=await post();expect(response.status).toBe(409);expect(response.body.code).toBe("source_changed");expect(mocks.create).not.toHaveBeenCalled();
 });
 it.each([undefined,"https://qbo.intuit.com/app/invoice?txnId=42","https://checkout.stripe.com/c/pay/test"])("returns explicit manual fallback for missing or invalid QuickBooks payment URL %s",async InvoiceLink=>{
  mocks.invoice.mockResolvedValue({...providerInvoice(),InvoiceLink});const response=await post();expect(response.status).toBe(409);expect(response.body).toMatchObject({code:"manual_payment_followup_required",manual_fallback:true,available:false,sent:false});expect(mocks.create).not.toHaveBeenCalled();
 });
 it("redacts provider failure and does not cancel an existing link or create another",async()=>{
  mocks.invoice.mockRejectedValue(new Error("secret-token provider raw body customer@example.test"));const response=await post();expect(response.status).toBe(503);expect(response.body.code).toBe("payment_link_unavailable");expect(JSON.stringify(response.body)).not.toMatch(/secret-token|raw body|customer@example/);expect(mocks.create).not.toHaveBeenCalled();expect(mocks.update).not.toHaveBeenCalled();
 });
});
