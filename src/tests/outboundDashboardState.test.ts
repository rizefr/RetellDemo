import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

function dashboardHarness() {
  type HarnessNode={value:string;checked:boolean;disabled:boolean;textContent:string;className:string;options:Array<{text:string;value:string}>;replaceChildren:(...children:Array<{text:string;value:string}>)=>void};
  const nodes = new Map<string, HarnessNode>();
  const storage = new Map<string,string>();
  const node = (id: string) => {
    if (!nodes.has(id)) {const created:HarnessNode={value:"",checked:false,disabled:false,textContent:"",className:"",options:[],replaceChildren:(...children)=>{created.textContent="";created.options=children;}};nodes.set(id,created);}
    return nodes.get(id)!;
  };
  const callButton = node("row-call");
  const gate = node("row-gate");
  const context = vm.createContext({
    Intl, URL, URLSearchParams, console,
    Option:class {constructor(public text:string,public value:string){}},
    localStorage:{getItem:(key:string)=>storage.get(key)||null,setItem:(key:string,value:string)=>storage.set(key,value)},
    document: {
      getElementById: node,
      createElement: () => ({textContent:"",className:""}),
      querySelectorAll: (selector: string) => selector === '[data-action="call"]' ? [callButton] : selector === '[data-field="gate"]' ? [gate] : selector.includes("#demo-save-details") ? [node("demo-save-details"),node("demo-first-name")] : [],
    },
  });
  // Evaluate the same production functions without boot-time network requests.
  const script = fs.readFileSync(path.resolve(process.cwd(), "public/outbound/outbound.js"), "utf8")
    .replace(/\ninitializeWorkspace\(\);\nrefreshAll\(\);\s*$/, "");
  vm.runInContext(script, context);
  return { node, storage, run: (source: string) => vm.runInContext(source, context) };
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

  it("resets the protected source banner and editable controls when changing QuickBooks to local demo and back",()=>{
    const h=dashboardHarness();
    h.run('populateDemoEditor({source_provider:"quickbooks",outbound_customers:{},outbound_businesses:{}})');
    expect(h.node("demo-save-details").disabled).toBe(true);
    expect(h.node("demo-last-result").textContent).toContain("synced QuickBooks");
    h.run('populateDemoEditor({source_provider:"local",outbound_customers:{},outbound_businesses:{is_demo:true}})');
    expect(h.node("demo-save-details").disabled).toBe(false);
    expect(h.node("demo-last-result").textContent).toContain("local demo invoice");
    expect(h.node("demo-last-result").textContent).not.toContain("synced QuickBooks");
    expect(h.run('document.getElementById("demo-feedback-badges").options[0].textContent')).toBe("Local · editable");
    h.run('populateDemoEditor({source_provider:"quickbooks",outbound_customers:{},outbound_businesses:{}})');
    expect(h.node("demo-save-details").disabled).toBe(true);
    expect(h.run('document.getElementById("demo-feedback-badges").options[0].textContent')).toBe("Synced · protected");
  });

  it("clears old tenant controls immediately and starts independent business panels without waiting for source reads",async()=>{
    const h=dashboardHarness();
    h.run(`dashboardState={businesses:[{id:"company-a"},{id:"company-b"}],invoices:[]};templateState=[{id:"old-draft"}];
      var pendingPanels=[],startedPanels=[];
      for(const name of ["renderSettings","renderPresentationPanel","loadTemplates","loadSmsReadiness"])globalThis[name]=()=>{startedPanels.push(name);return new Promise(resolve=>pendingPanels.push(resolve));};
      for(const name of ["renderInvoices","renderQueueOverview","renderCallbacks","renderCalls","renderPayments","renderEvents"])globalThis[name]=()=>{};`);
    for(const id of ["template-controls","template-preview","source-sync-controls","source-sync-result","sms-readiness-detail","source-queue-content"])h.node(id).textContent="Previous business data";
    h.node("settings-business").value="company-b";
    const pending=h.run('document.getElementById("settings-business").onchange()');
    expect(h.node("template-controls").textContent).toBe("");expect(h.node("template-preview").textContent).toBe("");expect(h.run("templateState.length")).toBe(0);
    expect(h.node("sms-readiness-detail").textContent).toBe("Loading the selected business…");
    expect(h.node("source-queue-content").textContent).toBe("Loading the selected business…");
    expect(h.run("startedPanels.join(',')")).toBe("renderSettings,renderPresentationPanel,loadTemplates,loadSmsReadiness");
    h.run("pendingPanels.forEach(resolve=>resolve())");await pending;
  });

  it.each(["loadSourceStatus","loadSourceQueue","loadWeeklyReviewStatus","loadSmsReadiness"])("discards stale %s response after switching away and back",async loader=>{
    const h=dashboardHarness();h.node("settings-business").value="company-a";
    h.run(`dashboardState={businesses:[{id:"company-a"},{id:"company-b"}],invoices:[]};el=(_tag,text)=>text;
      api=async()=>{document.getElementById("settings-business").value="company-b";clearBusinessPanels();document.getElementById("settings-business").value="company-a";clearBusinessPanels();return {company_name:"Old source",invoices:[],summary:{invoice_count:99},campaign:{status:"old"},settings:{}};};`);
    await h.run(`${loader}()`);
    for(const id of ["source-connection-detail","source-queue-content","weekly-review-detail","sms-readiness-detail"])expect(h.node(id).textContent).toBe("Loading the selected business…");
    expect(h.run("quickbooksState")).toBeNull();
  });

  it("mirrors the visible Demo/Live choice and restores only an authorized business ID",async()=>{
    const h=dashboardHarness();
    h.run(`dashboardState={businesses:[{id:"demo-id",business_name:"Same business name",is_demo:true},{id:"live-id",business_name:"Same business name",is_demo:false}],invoices:[]};renderBusinessChoices();`);
    expect(h.node("workspace-business").options.map(option=>option.text)).toEqual(["Demo · Same business name","Live accounting · Same business name"]);
    h.run(`for(const name of ["renderSettings","renderPresentationPanel","loadTemplates","loadSmsReadiness","renderInvoices","renderQueueOverview","renderCallbacks","renderCalls","renderPayments","renderEvents"])globalThis[name]=async()=>{};`);
    h.node("workspace-business").value="live-id";
    await h.run('document.getElementById("workspace-business").onchange()');
    expect(h.node("settings-business").value).toBe("live-id");
    h.node("workspace-business").value="";h.node("settings-business").value="";
    h.run("renderBusinessChoices()");
    expect(h.node("workspace-business").value).toBe("live-id");
    h.node("workspace-business").value="";h.node("settings-business").value="";
    h.storage.set("pinnacle-collections:selected-business:v1","not-in-authenticated-response");
    h.run("renderBusinessChoices()");
    expect(h.node("workspace-business").value).toBe("demo-id");
    expect(h.storage.get("pinnacle-collections:selected-business:v1")).toBe("demo-id");
  });

  it("opens a real Demo record in Presentation mode without authorizing or starting a call",async()=>{
    const h=dashboardHarness();
    h.run(`dashboardState={businesses:[{id:"live-id",is_demo:false},{id:"demo-id",is_demo:true}],invoices:[]};var openedWorkspace=null,changedId=null;setWorkspace=name=>{openedWorkspace=name;};changeBusiness=async id=>{changedId=id;};`);
    h.node("settings-business").value="live-id";
    await h.run('document.getElementById("open-demo-workspace").onclick()');
    expect(h.run("openedWorkspace")).toBe("presentation");expect(h.run("changedId")).toBe("demo-id");expect(h.run("activeDemoAuthorization")).toBeNull();
  });

});

function pendingDemoHarness(){
 const h=dashboardHarness();
 h.node("settings-business").value="company-a";h.node("demo-invoice-select").value="invoice-a";
 h.node("demo-authorize-ack").checked=true;h.node("demo-authorize-confirmation").value="I AUTHORIZE THIS DEMO TEST CALL";
 h.node("demo-phone-number").value="+12125550123";h.node("demo-call-mode").value="first_reminder";h.node("demo-ttl-minutes").value="5";
 h.run(`dashboardState={businesses:[{id:"company-a"},{id:"company-b"}],invoices:[{id:"invoice-a",business_id:"company-a"},{id:"invoice-b",business_id:"company-a"}]};
  activeDemoAuthorization={id:"auth-a",business_id:"company-a",phone_number:"+12125550123",expires_at:"2050-01-01T00:00:00Z"};
  var pendingReply;api=()=>new Promise((resolve,reject)=>{pendingReply={resolve,reject};});setDemoFeedback=()=>{};
  for(const name of ["renderSettings","renderPresentationPanel","loadTemplates","loadSmsReadiness","renderInvoices","renderQueueOverview","renderCallbacks","renderCalls","renderPayments","renderEvents","loadDashboard"])globalThis[name]=async()=>{};`);
 return h;
}
const authorizationResult='{authorization:{id:"old-response-auth",business_id:"company-a",phone_number:"+12125550123",expires_at:"2050-01-01T00:00:00Z"}}';
const preflightResult='{eligible:true,destination_phone_number:"+12125550123",agent_label:"Conversation Flow",demo_call_authorization_id:"auth-a"}';
describe("pending presentation response isolation",()=>{
 it.each(["authorizeDemoNumber","demoPreflight"])("ignores late successful %s after A→B→A workspace changes",async operation=>{
  const h=pendingDemoHarness();const pending=h.run(`${operation}()`);
  await h.run('changeBusiness("company-b")');await h.run('changeBusiness("company-a")');
  if(operation==="demoPreflight")h.run('activeDemoAuthorization={id:"auth-a",expires_at:"2050-01-01T00:00:00Z"}');
  h.run(`pendingReply.resolve(${operation==="authorizeDemoNumber"?authorizationResult:preflightResult})`);await pending;
  expect(h.run("activeDemoPreflight")).toBeNull();expect(h.node("demo-start-call").disabled).toBe(true);
  if(operation==="authorizeDemoNumber")expect(h.run("activeDemoAuthorization")).toBeNull();
 });
 it.each(["authorizeDemoNumber","demoPreflight"])("ignores late failed %s after A→B→A workspace changes",async operation=>{
  const h=pendingDemoHarness();const pending=h.run(`${operation}()`);
  await h.run('changeBusiness("company-b")');await h.run('changeBusiness("company-a")');
  h.node("page-status").textContent="Current workspace state";
  h.run('pendingReply.reject(new Error("Old workspace error"))');await pending;
  expect(h.node("page-status").textContent).toBe("Current workspace state");expect(h.node("demo-start-call").disabled).toBe(true);
 });
 it("ignores preflight after invoice selection changes away and back",async()=>{
  const h=pendingDemoHarness();const pending=h.run("demoPreflight()");
  h.node("demo-invoice-select").value="invoice-b";h.run('document.getElementById("demo-invoice-select").onchange()');
  h.node("demo-invoice-select").value="invoice-a";h.run('document.getElementById("demo-invoice-select").onchange()');
  h.run(`pendingReply.resolve(${preflightResult})`);await pending;
  expect(h.run("activeDemoPreflight")).toBeNull();expect(h.node("demo-start-call").disabled).toBe(true);
 });
 it("ignores preflight after the after-hours confirmation is invalidated",async()=>{
  const h=pendingDemoHarness();const pending=h.run("demoPreflight()");h.run("invalidateCallGates()");
  h.run(`pendingReply.resolve(${preflightResult})`);await pending;
  expect(h.run("activeDemoPreflight")).toBeNull();expect(h.node("demo-start-call").disabled).toBe(true);
 });
 it.each(["authorizeDemoNumber","demoPreflight"])("accepts the current unchanged %s response",async operation=>{
  const h=pendingDemoHarness();const pending=h.run(`${operation}()`);
  h.run(`pendingReply.resolve(${operation==="authorizeDemoNumber"?authorizationResult:preflightResult})`);await pending;
  if(operation==="authorizeDemoNumber"){expect(h.run("activeDemoAuthorization.id")).toBe("old-response-auth");expect(h.node("demo-preflight").disabled).toBe(false);expect(h.node("demo-start-call").disabled).toBe(true);}
  else {expect(h.run("activeDemoPreflight.eligible")).toBe(true);expect(h.node("demo-start-call").disabled).toBe(false);}
 });
});
