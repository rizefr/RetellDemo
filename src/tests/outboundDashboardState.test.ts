import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

function dashboardHarness() {
  const nodes = new Map<string, { value: string; disabled: boolean; textContent: string; className: string }>();
  const node = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, { value: "", disabled: false, textContent: "", className: "" });
    return nodes.get(id)!;
  };
  const callButton = node("row-call");
  const gate = node("row-gate");
  const context = vm.createContext({
    Intl, URL, URLSearchParams, console,
    document: {
      getElementById: node,
      querySelectorAll: (selector: string) => selector === '[data-action="call"]' ? [callButton] : selector === '[data-field="gate"]' ? [gate] : [],
    },
  });
  // Evaluate the same production functions without boot-time network requests.
  const script = fs.readFileSync(path.resolve(process.cwd(), "public/outbound/outbound.js"), "utf8")
    .replace(/\ninitializeWorkspace\(\);\nrefreshAll\(\);\s*$/, "");
  vm.runInContext(script, context);
  return { node, run: (source: string) => vm.runInContext(source, context) };
}

describe("collections dashboard state boundaries", () => {
  it("keeps selected-business invoices separate and distinguishes synced source records", () => {
    const h = dashboardHarness();
    h.node("settings-business").value = "company-a";
    h.run(`dashboardState = { businesses: [{id: "company-a"}, {id: "company-b"}], invoices: [
      {id: "a", business_id: "company-a", source_provider: "quickbooks"},
      {id: "b", business_id: "company-b", source_provider: "quickbooks"},
      {id: "c", business_id: "company-a", source_provider: "local"}
    ] };`);
    expect(h.run("scopedInvoices().map(invoice => invoice.id).join(',')")).toBe("a,c");
    expect(h.run("isQuickBooksInvoice(scopedInvoices()[0])")).toBe(true);
    expect(h.run("isQuickBooksInvoice(scopedInvoices()[1])")).toBe(false);
  });

  it("displays supplied currency and never turns an unavailable amount into zero", () => {
    const h = dashboardHarness();
    expect(h.run("formatMoney(12345, 'EUR')")).toBe("€123.45");
    expect(h.run("formatMoney(12345, 'GBP')")).toBe("£123.45");
    expect(h.run("formatMoney(null, 'USD')")).toBe("Amount unavailable");
    expect(h.run("formatMoney(undefined, 'USD')")).toBe("Amount unavailable");
  });

  it("invalidates both row and presentation preflight after safety controls change", () => {
    const h = dashboardHarness();
    h.run("activeDemoPreflight = { eligible: true }; invalidateCallGates();");
    expect(h.run("activeDemoPreflight")).toBeNull();
    expect(h.node("demo-start-call").disabled).toBe(true);
    expect(h.node("row-call").disabled).toBe(true);
    expect(h.node("row-gate").textContent).toBe("Recheck required");
  });

  it("filters source and status without claiming frontend eligibility", () => {
    const h = dashboardHarness();
    h.node("invoice-filter").value = "unpaid";
    h.node("invoice-source-filter").value = "quickbooks";
    h.node("invoice-search").value = "building north";
    expect(h.run(`invoiceMatches({status:"unpaid",source_provider:"quickbooks",invoice_id:"INV-1",outbound_customers:{account_company_name:"Building North"}})`)).toBe(true);
    expect(h.run(`invoiceMatches({status:"unpaid",source_provider:"local",invoice_id:"INV-1",outbound_customers:{account_company_name:"Building North"}})`)).toBe(false);
    expect(h.run(`invoiceMatches({status:"paid",source_provider:"quickbooks",invoice_id:"INV-1",outbound_customers:{account_company_name:"Building North"}})`)).toBe(false);
  });
  it("ignores slow template and source responses after the business selection changes", async () => {
    const h = dashboardHarness();
    h.run(`dashboardState = { businesses: [{id: "company-a"}, {id: "company-b"}], invoices: [] }; templateState = [{id:"current-template"}];`);
    h.node("settings-business").value = "company-a";
    h.node("template-status").textContent = "Current business status";
    h.run(`api = async () => { document.getElementById("settings-business").value = "company-b"; return {templates:[{id:"wrong-company-template"}]}; };`);
    await h.run("loadTemplates()");
    expect(h.run("templateState[0].id")).toBe("current-template");
    expect(h.node("template-status").textContent).toBe("Current business status");
    h.node("settings-business").value = "company-a";
    h.node("source-queue-count").textContent = "Current company queue";
    h.run(`api = async () => { document.getElementById("settings-business").value = "company-b"; return {invoices:[],summary:{eligible_count:9,invoice_count:9}}; };`);
    await h.run("loadSourceQueue()");
    expect(h.node("source-queue-count").textContent).toBe("Current company queue");
  });

  it("loads inspection, issue, and due dates as separate saved values", () => {
    const h = dashboardHarness();
    h.run(`populateDemoEditor({inspection_date:"2026-04-01",invoice_date:"2026-04-07",original_due_date:"2026-05-07",outbound_customers:{},outbound_businesses:{},source_provider:"local"})`);
    expect(h.node("demo-inspection-date").value).toBe("2026-04-01");
    expect(h.node("demo-invoice-date").value).toBe("2026-04-07");
    expect(h.node("demo-original-due-date").value).toBe("2026-05-07");
  });

});
