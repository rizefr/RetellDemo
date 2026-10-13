import { afterEach, describe, expect, it, vi } from "vitest";

const input = {
  businessId: "00000000-0000-4000-8000-000000000001",
  customerId: "00000000-0000-4000-8000-000000000002",
  invoiceId: "00000000-0000-4000-8000-000000000003",
  businessPatch: {}, customerPatch: {},
  invoicePatch: { inspection_date: "2026-04-01", invoice_date: "2026-04-07", status: undefined },
};

async function repositoryFixture(error: {code: string; message: string} | null = null) {
  const data = { business: {id: input.businessId}, customer: {id: input.customerId}, invoice: {id: input.invoiceId, status: "unpaid", inspection_date: "2026-04-01", invoice_date: "2026-04-07", original_due_date: "2026-05-07"} };
  const rpc = vi.fn().mockResolvedValue({data: error ? null : data, error});
  const from = vi.fn(() => { throw new Error("Separate demo writes are forbidden"); });
  vi.doMock("../services/supabase", () => ({ getSupabaseClient: () => ({rpc, from}) }));
  vi.resetModules();
  const {updateOutboundDemoDetails} = await import("../services/outboundRepository");
  return {updateOutboundDemoDetails, rpc, from, data};
}
afterEach(() => {vi.doUnmock("../services/supabase"); vi.resetModules();});

describe("atomic Presentation date persistence", () => {
  it("sends separate dates through one atomic RPC, preserving explicit null and dropping undefined payment state", async () => {
    const f = await repositoryFixture();
    const saved = await f.updateOutboundDemoDetails({...input, customerPatch: {preferred_email: null}});
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("outbound_update_demo_details", {
      p_business_id: input.businessId, p_customer_id: input.customerId, p_invoice_id: input.invoiceId,
      p_business_patch: {}, p_customer_patch: {preferred_email: null},
      p_invoice_patch: {inspection_date: "2026-04-01", invoice_date: "2026-04-07"},
    });
    expect(saved).toEqual(f.data);
    expect(f.from).not.toHaveBeenCalled();
  });
  it.each([
    ["PT403", "Demo record associations do not match", 403],
    ["PT409", "Paid invoices cannot be edited in Presentation Mode", 409],
    ["PT400", "Unsupported demo invoice field", 400],
    ["23514", "invoice constraint failure", 500],
    ["PGRST202", "atomic RPC migration unavailable", 500],
  ])("fails closed on %s without falling back to separate writes", async (code, message, status) => {
    const f = await repositoryFixture({code: String(code), message: String(message)});
    await expect(f.updateOutboundDemoDetails(input)).rejects.toMatchObject({message, status});
    expect(f.rpc).toHaveBeenCalledTimes(1);
    expect(f.from).not.toHaveBeenCalled();
  });
});
