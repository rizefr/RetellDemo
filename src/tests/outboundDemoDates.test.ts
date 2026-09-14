import { afterEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const businessId = "00000000-0000-4000-8000-000000000001";
const customerId = "00000000-0000-4000-8000-000000000002";
const invoiceId = "00000000-0000-4000-8000-000000000003";
const input = { businessId, customerId, invoiceId, businessPatch: {}, customerPatch: {}, invoicePatch: { inspection_date: "2026-04-01", invoice_date: "2026-04-07" } };

async function repositoryFixture(invoicePatch: Row = {}, businessPatch: Row = {}) {
  const rows: Record<string, Row[]> = {
    outbound_businesses: [{ id: businessId, is_demo: true, ...businessPatch }],
    outbound_customers: [{ id: customerId, business_id: businessId }],
    outbound_invoices: [{ id: invoiceId, business_id: businessId, customer_id: customerId, source_provider: "local", status: "unpaid", currency: "usd", amount_due_cents: 5000, original_due_date: "2026-05-07", ...invoicePatch }],
    outbound_call_attempts: [], outbound_payment_links: [],
  };
  const writes: Array<{ table: string; patch: Row }> = [];
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let patch: Row | undefined;
    const execute = (single: boolean) => {
      const matches = (rows[table] || []).filter(row => filters.every(test => test(row)));
      if (patch) { writes.push({ table, patch }); matches.forEach(row => Object.assign(row, patch)); }
      return { data: single ? matches[0] || null : matches, error: null };
    };
    const query = {
      select: (_fields?: string) => query,
      update: (value: Row) => { patch = value; return query; },
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      neq: (key: string, value: unknown) => { filters.push(row => row[key] !== value); return query; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query; },
      gt: (_key: string, _value: unknown) => query,
      order: (_key: string, _options?: unknown) => query,
      limit: (_limit: number) => query,
      maybeSingle: async () => execute(true),
      then: (resolve: (value: {data: Row[] | Row | null; error: null}) => unknown) => Promise.resolve(execute(false)).then(resolve),
    };
    return query;
  };
  vi.doMock("../services/supabase", () => ({ getSupabaseClient: () => ({ from }) }));
  vi.resetModules();
  const { updateOutboundDemoDetails, getOutboundInvoiceContext } = await import("../services/outboundRepository");
  return { updateOutboundDemoDetails, getOutboundInvoiceContext, writes, rows };
}

afterEach(() => { vi.doUnmock("../services/supabase"); vi.resetModules(); });

describe("isolated Presentation date persistence", () => {
  it("persists separate dates and reads them back without changing the due date or payment status", async () => {
    const fixture = await repositoryFixture();
    await fixture.updateOutboundDemoDetails(input);
    const stored = await fixture.getOutboundInvoiceContext(invoiceId);
    expect(stored.invoice).toMatchObject({ inspection_date: "2026-04-01", invoice_date: "2026-04-07", original_due_date: "2026-05-07", status: "unpaid" });
    expect(stored.account.oldestInvoiceDate).toBe("2026-04-07");
    expect(fixture.writes).toEqual([{table:"outbound_invoices",patch:input.invoicePatch}]);
  });

  it("rejects cross-business associations before any writes", async () => {
    const fixture = await repositoryFixture();
    await expect(fixture.updateOutboundDemoDetails({...input,businessId:"00000000-0000-4000-8000-000000000099"})).rejects.toThrow("associations");
    expect(fixture.writes).toEqual([]);
  });

  it.each([{source_provider:"quickbooks"},{source_provider:"unverified"},{source_provider:"local",quickbooks_invoice_id:"81"}])("rejects non-local accounting sources before any writes: %j", async source => {
    const fixture = await repositoryFixture(source);
    await expect(fixture.updateOutboundDemoDetails(input)).rejects.toThrow("isolated demo");
    expect(fixture.writes).toEqual([]);
  });

  it("rejects live businesses and paid invoices before touching business or customer values", async () => {
    const live = await repositoryFixture({}, {is_demo:false});
    await expect(live.updateOutboundDemoDetails(input)).rejects.toThrow("isolated demo");
    expect(live.writes).toEqual([]);
    const paid = await repositoryFixture({status:"paid"});
    await expect(paid.updateOutboundDemoDetails({...input,businessPatch:{business_name:"Changed"},customerPatch:{first_name:"Changed"}})).rejects.toThrow("Paid invoices");
    expect(paid.writes).toEqual([]);
  });
});
