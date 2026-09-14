import { describe,it,expect,vi } from "vitest";
import request from "supertest";
import { emailTemplateContentSchema, PINNACLE_EMAIL_TEMPLATE, renderOutboundEmailTemplate, safeEmailPaymentUrl, validatedPreviewPaymentUrl, type EmailInvoiceVariables } from "../services/outboundEmailTemplates";
import { createApp } from "../app";

const variables:EmailInvoiceVariables={business_name:"Pinnacle Elevator Solutions",customer_name:'<script>alert("x")</script>',invoice_number:"6474",service_description:"Category 1 inspection",inspection_date:"July 2, 2026",invoice_date:"July 6, 2026",due_date:"August 5, 2026",balance:"$450.00",currency:"USD",payment_url:"https://connect.intuit.com/portal/app/CommerceNetwork/view/scs-v1-example",contact_phone:"646-893-1695",contact_email:"hello@pinnacleelevatorsolutions.com",pinnacle_brand:true,demo:true};
describe("branded invoice templates",()=>{
 it("escapes mapped customer values and retains separate dates and exact balance",()=>{
  const result=renderOutboundEmailTemplate(PINNACLE_EMAIL_TEMPLATE,variables);
  expect(result.html).not.toContain('<script>');expect(result.html).toContain('&lt;script&gt;');
  for(const value of ["July 2, 2026","July 6, 2026","August 5, 2026","$450.00"]) expect(result.text).toContain(value);
  expect(result.html).toContain('role="presentation"');expect(result.text).toContain("When can we expect the payment?");
 });
 it.each(["javascript:alert(1)","https://qbo.intuit.com/app/invoice?txnId=6474","https://connect.intuit.com.evil.test/a","https://user:pass@connect.intuit.com/a","https://connect.intuit.com:8443/a","http://checkout.stripe.com/a"])("rejects unsafe or internal payment URL %s",url=>expect(safeEmailPaymentUrl(url)).toBe(""));
 it("renders verified Intuit share-token payment links through the shared validator",()=>{
  const url="https://connect.intuit.com/t/scs-v1-fixtureToken_123";
  expect(safeEmailPaymentUrl(url)).toBe(url);
  const result=renderOutboundEmailTemplate(PINNACLE_EMAIL_TEMPLATE,{...variables,payment_url:url});
  expect(result.payment_link_available).toBe(true);expect(result.html).toContain(`href="${url}"`);
  expect(safeEmailPaymentUrl("https://connect.intuit.com/t/arbitrary")).toBe("");
 });
 it("shows honest manual fallback without a fabricated button",()=>{
  const result=renderOutboundEmailTemplate(PINNACLE_EMAIL_TEMPLATE,{...variables,payment_url:""});
  expect(result.payment_link_available).toBe(false);expect(result.html).not.toContain('>Review invoice &amp; pay securely<');
  expect(result.text).toContain("not available");
 });
 it("blocks header injection in drafts",()=>expect(emailTemplateContentSchema.safeParse({...PINNACLE_EMAIL_TEMPLATE,subject:"Invoice\r\nBcc: attacker@example.test"}).success).toBe(false));
 it("requires backend authentication for preview and draft writes",async()=>{
  const app=createApp();
  expect((await request(app).get("/api/outbound/email/preview")).status).toBe(401);
  expect((await request(app).post("/api/outbound/email/templates").send({})).status).toBe(401);
 });
});

const reference=new Date("2026-09-14T16:00:00Z");
const invoice={id:"invoice-a",business_id:"business-a",amount_due_cents:45000,currency:"usd",source_provider:"quickbooks",source_realm_id:"12345",provider_invoice_id:"6474",source_verified_at:reference.toISOString()};
const link={invoice_id:"invoice-a",business_id:"business-a",provider:"quickbooks",source_realm_id:"12345",provider_invoice_id:"6474",status:"open",amount_cents:45000,currency:"usd",url:variables.payment_url,expires_at:new Date(+reference+60000).toISOString()};
describe("payment preview integrity",()=>{
 const business={id:"business-a",payment_provider:"quickbooks"};
 it("accepts a current exact-company exact-invoice link",()=>expect(validatedPreviewPaymentUrl(invoice,business,link,reference)).toBe(variables.payment_url));
 it.each([{business_id:"other"},{invoice_id:"other"},{source_realm_id:"other"},{provider_invoice_id:"other"},{amount_cents:45001},{currency:"eur"},{status:"paid"},{expires_at:"invalid"},{expires_at:reference.toISOString()},{provider:"stripe",url:"https://checkout.stripe.com/c/pay/test"}])("blocks mismatched, expired, or substituted source links %j",change=>expect(validatedPreviewPaymentUrl(invoice,business,{...link,...change},reference)).toBe(""));
 it.each([new Date(+reference-300001).toISOString(),"invalid",new Date(+reference+60001).toISOString()])("blocks stale or invalid source verification %s",source_verified_at=>expect(validatedPreviewPaymentUrl({...invoice,source_verified_at},business,link,reference)).toBe(""));
});
