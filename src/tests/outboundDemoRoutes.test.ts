import {afterEach, describe, expect, it, vi} from "vitest";
import request from "supertest";
const originalEnv = {...process.env};
afterEach(() => { process.env = {...originalEnv}; vi.doUnmock("../services/outboundRepository"); vi.doUnmock("../services/supabase"); vi.resetModules(); });

describe("demo save atomic failure responses", () => {
  it.each([
    ["PT409", "Paid invoices cannot be edited in Presentation Mode", 409],
    ["23514", "invoice update constraint failure", 500],
  ])("returns %s without a success audit event or a partial-write fallback", async (code,message,status) => {
    process.env.NODE_ENV="test";
    process.env.OUTBOUND_ADMIN_TOKEN="demo-test-admin";
    const rpc=vi.fn().mockResolvedValue({data:null,error:{code,message}});
    const from=vi.fn(() => {throw new Error("Separate writes forbidden");});
    const event=vi.fn();
    vi.doMock("../services/supabase",()=>({getSupabaseClient:()=>({rpc,from})}));
    vi.doMock("../services/outboundRepository", async()=>({...await vi.importActual<typeof import("../services/outboundRepository")>("../services/outboundRepository"),insertOutboundEvent:event}));
    vi.resetModules();
    const {createApp}=await import("../app");
    const response=await request(createApp()).patch("/api/outbound/demo-details").set("Authorization","Bearer demo-test-admin").send({
      business_id:"00000000-0000-4000-8000-000000000001",customer_id:"00000000-0000-4000-8000-000000000002",invoice_id:"00000000-0000-4000-8000-000000000003",business_name:"Changed",first_name:"Changed",amount_due:"50.00",
    });
    expect(response.status).toBe(status);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled();
  });
});
