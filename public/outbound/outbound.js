const statuses = ["unpaid", "payment_link_sent", "paid", "disputed", "manual_review", "cancelled"];
function formatMoney(cents, currency = "USD") {
  const value = Number(cents);
  if (cents === null || cents === undefined || cents === "" || !Number.isFinite(value)) return "Amount unavailable";
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: String(currency).toUpperCase() }).format(value / 100); }
  catch { return `${(value / 100).toFixed(2)} ${currency}`; }
}
function invoiceCurrency(invoice) { return invoice.currency || invoice.currency_code || "USD"; }
function isQuickBooksInvoice(invoice) { return invoice.source_system === "quickbooks" || invoice.source_provider === "quickbooks" || Boolean(invoice.quickbooks_invoice_id); }
function scopedInvoices() { const business = selectedBusiness(); return (dashboardState.invoices || []).filter((invoice) => !business || invoice.business_id === business.id || invoice.outbound_businesses?.id === business.id); }
function inSelectedBusiness(record) {
  const business = selectedBusiness();
  if (!business) return true;
  if (record.business_id) return record.business_id === business.id;
  if (record.outbound_businesses?.id) return record.outbound_businesses.id === business.id;
  if (record.invoice_id) return scopedInvoices().some((invoice) => invoice.id === record.invoice_id);
  return true; // Older unscoped audit events retain their original label.
}
let quickbooksState = null;
let templateState = [];
let emailPreviewRevision = 0;
let templateLoadRevision = 0;
let businessSelectionRevision = 0;
let currentWorkspace = "queue";
const AFTER_HOURS_CONFIRMATION = "I UNDERSTAND THIS IS AN AFTER-HOURS TEST";
const DEMO_CALL_CONFIRMATION = "I AUTHORIZE THIS DEMO TEST CALL";
const pageStatus = document.getElementById("page-status");
const importResult = document.getElementById("import-result");
const commitImportButton = document.getElementById("commit-import");
const batchDryRunButton = document.getElementById("batch-dry-run");
const selectedCallStatus = document.getElementById("selected-call-status");
let validatedCsvText = "";
let validatedBusinessCsvText = "";
let dashboardState = { invoices: [], calls: [], payment_links: [], events: [], businesses: [], followups: [] };
let setupState = null;
let settingsReadiness = null;
let activeCallPoll = null;
let activeDemoAuthorization = null;
let activeDemoPreflight = null;
let demoReadinessRevision = 0;
let demoAuthorizationRequestRevision = 0;
let demoPreflightRequestRevision = 0;

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) throw new Error("Your session expired. Reload this page and sign in to continue.");
  if (!response.ok) {
    const validation = Array.isArray(body.errors)
      ? body.errors.map((error) => `Row ${error.row}: ${error.message}`).join(" ")
      : "";
    throw new Error(validation || body.error || `Request failed (${response.status})`);
  }
  return body;
}

function latest(items = []) {
  return [...items].sort((a, b) =>
    String(b.created_at || b.scheduled_for).localeCompare(String(a.created_at || a.scheduled_for)),
  )[0];
}

function formatDate(value) {
  if (!value) return "None";
  const compact = String(value).match(/^(\d{4})(\d{2})(\d{2})$/);
  const dateOnly = compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    const [year, month, day] = dateOnly.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
  }
  const date = new Date(dateOnly);
  return Number.isNaN(date.valueOf()) ? "Unknown" : date.toLocaleString();
}

function splitLines(value) {
  return String(value || "").split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}

function localDateTimeInput(value, timezone) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function humanize(value) {
  return String(value || "unknown").replaceAll("_", " ");
}

const CALL_GATE_MESSAGES = {
  invalid_phone_number: "Invalid phone number format. Use E.164, like +13475850249.",
  invalid_phone: "Invalid phone number format. Use E.164, like +13475850249.",
  invalid_format: "Invalid phone number format. Use E.164, like +13475850249.",
  confirmation_required: "Exact confirmation phrase is incorrect.",
  checkbox_required: "Warning checkbox is required.",
  test_mode_disabled: "Test mode is off. Presentation Mode requires test mode.",
  max_batch_size_not_one: "Batch size must be 1 for Presentation Mode.",
  demo_authorization_expired: "Temporary demo authorization expired. Authorize the test number again.",
  demo_call_authorization_expired: "Temporary demo authorization expired. Authorize the test number again.",
  demo_call_authorization_missing: "Authorize a temporary demo number before preflight.",
  outside_calling_window: "After-hours override is required outside the normal calling window.",
  after_hours_override_required: "After-hours override is required.",
  after_hours_confirmation_invalid: "After-hours phrase is missing or incorrect.",
  invoice_not_outstanding: "Invoice is not eligible. Use an unpaid or payment-link-sent demo invoice.",
  invoice_not_eligible: "Invoice is not eligible for a call.",
  customer_paused: "Customer outreach is paused.",
  outreach_paused: "Customer outreach is paused.",
  retell_agent_missing: "Retell agent ID is missing.",
  retell_conversation_flow_missing: "Retell Conversation Flow ID is missing.",
  retell_from_number_missing: "Retell from number is missing.",
  email_not_ready: "Email is not ready.",
  sms_disabled: "SMS is disabled/manual.",
  quickbooks_not_connected: "QuickBooks is not connected. QuickBooks invoices require a verified source connection.",
};

function friendlyReason(reason) {
  return CALL_GATE_MESSAGES[reason] || humanize(reason);
}

function friendlyErrorMessage(error) {
  const message = error?.message || String(error || "");
  const lower = message.toLowerCase();
  if (lower.includes("e.164") || (lower.includes("phone") && lower.includes("invalid"))) {
    return CALL_GATE_MESSAGES.invalid_phone_number;
  }
  if (lower.includes("authorize") && lower.includes("demo")) return CALL_GATE_MESSAGES.demo_call_authorization_missing;
  if (lower.includes("test mode")) return CALL_GATE_MESSAGES.test_mode_disabled;
  if (lower.includes("maximum batch size") || lower.includes("batch size 1")) return CALL_GATE_MESSAGES.max_batch_size_not_one;
  if (lower.includes(DEMO_CALL_CONFIRMATION.toLowerCase()) || lower.includes("exact")) {
    return `Exact confirmation phrase is incorrect. Type ${DEMO_CALL_CONFIRMATION}.`;
  }
  if (lower.includes(AFTER_HOURS_CONFIRMATION.toLowerCase())) {
    return `After-hours phrase is missing or incorrect. Type ${AFTER_HOURS_CONFIRMATION}.`;
  }
  return message;
}

function stateBadge(label, tone = "neutral") {
  const span = document.createElement("span");
  span.className = `state-badge ${tone}`;
  span.textContent = label;
  return span;
}

function setDemoFeedback(message, badges = []) {
  const result = document.getElementById("demo-last-result");
  const container = document.getElementById("demo-feedback-badges");
  if (result) result.textContent = message;
  if (container) container.replaceChildren(...badges.map((item) => stateBadge(item.label, item.tone)));
}

function demoAuthorizationExpired() {
  return activeDemoAuthorization?.expires_at && new Date(activeDemoAuthorization.expires_at) <= new Date();
}

function badge(value, tone = "neutral") {
  const span = document.createElement("span");
  span.className = `status-badge ${tone}`;
  span.textContent = humanize(value);
  return span;
}

function details(summary, content, className = "") {
  const element = document.createElement("details");
  if (className) element.className = className;
  const heading = document.createElement("summary");
  const pre = document.createElement("pre");
  heading.textContent = summary;
  pre.textContent = content || "No data";
  element.append(heading, pre);
  return element;
}

function setStatus(message, error = false) {
  pageStatus.textContent = message;
  pageStatus.className = error ? "error" : "";
}

function checklistItem(label, state, detail = "") {
  const item = document.createElement("li");
  item.className = `check-item ${state ? "pass" : "fail"}`;
  const marker = document.createElement("span");
  marker.className = "check-marker";
  marker.textContent = state ? "Ready" : "Needs setup";
  const content = document.createElement("span");
  content.textContent = detail ? `${label}: ${detail}` : label;
  item.append(marker, content);
  return item;
}

function renderChecklist(id, items) {
  document.getElementById(id).replaceChildren(...items.map((item) => checklistItem(item.label, item.ok, item.detail)));
}

function addEndpoint(container, label, url) {
  const row = document.createElement("div");
  const name = document.createElement("strong");
  const code = document.createElement("code");
  name.textContent = label;
  code.textContent = url;
  row.append(name, code);
  container.append(row);
}

async function loadSetupStatus() {
  const summary = document.getElementById("setup-summary");
  try {
    summary.textContent = "Checking deployment readiness...";
    const setup = await api("/api/outbound/setup/status");
    setupState = setup;
    summary.textContent = setup.ready_for_single_test_call
      ? "Server setup is ready for one gated test call. A selected customer must still pass call preflight."
      : "Setup is incomplete. Review the items marked Needs setup.";
    summary.className = `setup-summary ${setup.ready_for_single_test_call ? "ready" : "warning"}`;

    renderChecklist("setup-app", [
      { label: "APP_BASE_URL configured", ok: setup.app.app_base_url_configured, detail: setup.app.configured_base_url || "Missing" },
      { label: "Detected base URL", ok: true, detail: setup.app.detected_base_url },
      { label: "Configured URL matches request", ok: setup.app.base_url_matches_request },
      { label: "Runtime", ok: true, detail: setup.app.runtime },
      { label: "/health route", ok: setup.app.health.ok, detail: setup.app.health.url },
      { label: "Admin authentication", ok: setup.app.admin_auth.authenticated },
    ]);
    renderChecklist("setup-supabase", [
      { label: "SUPABASE_URL present", ok: setup.supabase.url_configured },
      { label: "Service role present server-side", ok: setup.supabase.service_role_configured },
      ...Object.entries(setup.supabase.tables).map(([name, ready]) => ({ label: name, ok: ready })),
      { label: "outbound_mark_invoice_paid detected", ok: setup.supabase.paid_rpc_detected },
    ]);
    renderChecklist("setup-stripe", [
      { label: "Stripe secret key present", ok: setup.stripe.secret_key_configured },
      { label: "Webhook secret present", ok: setup.stripe.webhook_secret_configured },
      { label: "Latest payment event", ok: true, detail: setup.stripe.latest_payment_event ? `${humanize(setup.stripe.latest_payment_event.event_type)} · ${formatDate(setup.stripe.latest_payment_event.created_at)}` : "None recorded" },
    ]);
    renderChecklist("setup-retell", [
      { label: "Retell API key present", ok: setup.retell.api_key_configured },
      { label: "Outbound from number", ok: setup.retell.from_number_correct, detail: setup.retell.from_number },
      { label: "Outbound agent ID present", ok: setup.retell.outbound_agent_configured },
      { label: "Outbound Conversation Flow ID present", ok: setup.retell.outbound_flow_configured },
      { label: "Inbound callback agent configured", ok: setup.retell.inbound_collections_agent_configured },
      { label: "Inbound callback Conversation Flow configured", ok: setup.retell.inbound_collections_flow_configured },
      { label: "Retell webhook secret present", ok: setup.retell.webhook_secret_configured },
      { label: "SMS mode", ok: true, detail: setup.retell.sms_mode === "disabled_manual" ? "Disabled/manual" : "Enabled; verify provider" },
      { label: "Latest Retell event", ok: true, detail: setup.retell.latest_event ? `${humanize(setup.retell.latest_event.event_type)} · ${formatDate(setup.retell.latest_event.created_at)}` : "None recorded" },
    ]);
    renderChecklist("setup-email", [
      { label: "Provider", ok: true, detail: setup.email.provider },
      { label: "Provider key present", ok: setup.email.provider_key_configured },
      { label: "From address present", ok: setup.email.from_address_configured },
      { label: "Email mode", ok: true, detail: setup.email.mode === "disabled_manual" ? "Disabled/manual" : "Enabled" },
    ]);
    renderChecklist("setup-safety", [
      { label: "Test mode enabled", ok: setup.call_safety.test_mode },
      { label: "Test phone allowlist", ok: setup.call_safety.allowlist_configured, detail: `${setup.call_safety.allowlist_count} number(s)` },
      { label: "Maximum batch size", ok: setup.call_safety.max_batch_size === 1, detail: String(setup.call_safety.max_batch_size) },
      { label: "Calling window", ok: true, detail: setup.call_safety.calling_window },
      { label: "Real batch hidden", ok: !setup.call_safety.real_batch_available_in_ui },
      { label: "After-hours self-test override", ok: setup.call_safety.after_hours_test_override_enabled, detail: setup.call_safety.after_hours_test_override_enabled ? "Enabled with confirmation gates" : "Disabled" },
    ]);

    const endpoints = document.getElementById("setup-endpoints");
    endpoints.replaceChildren();
    addEndpoint(endpoints, "Stripe webhook", setup.stripe.webhook_url);
    addEndpoint(endpoints, "Retell webhook", setup.retell.webhook_url);
    setup.retell.function_urls.forEach((url) => addEndpoint(endpoints, "Retell function", url));
    const overrideEnabled = setup.call_safety.after_hours_test_override_enabled;
    document.getElementById("after-hours-panel").classList.toggle("disabled", !overrideEnabled);
    document.getElementById("after-hours-ack").disabled = !overrideEnabled;
    document.getElementById("after-hours-confirmation").disabled = !overrideEnabled;
    document.getElementById("after-hours-status").textContent = overrideEnabled
      ? "Enabled for one authenticated, allowlisted self-test after exact confirmation."
      : "Disabled by server configuration.";
    if (setup.supabase.migration_warning) setStatus(setup.supabase.migration_warning, true);
  } catch (error) {
    summary.textContent = error.message;
    summary.className = "setup-summary error";
  }
}

function selectedBusiness() {
  const id = document.getElementById("settings-business").value;
  return (dashboardState.businesses || []).find((business) => business.id === id) || dashboardState.businesses?.[0] || null;
}

const BUSINESS_SELECTION_KEY = "pinnacle-collections:selected-business:v1";
function rememberedBusinessId() { try { return localStorage.getItem(BUSINESS_SELECTION_KEY) || ""; } catch { return ""; } }
function rememberBusiness(id) { if (!(dashboardState.businesses || []).some(business => business.id === id)) return; try { localStorage.setItem(BUSINESS_SELECTION_KEY, id); } catch { /* A blocked preference store does not prevent using the workspace. */ } }
function renderBusinessChoices() {
  const businesses = dashboardState.businesses || [];
  const current = document.getElementById("settings-business").value;
  const remembered = rememberedBusinessId();
  const selectedId = businesses.some(business => business.id === current) ? current : businesses.some(business => business.id === remembered) ? remembered : businesses[0]?.id || "";
  for (const id of ["settings-business", "workspace-business"]) {
    const select = document.getElementById(id);
    select.replaceChildren(...businesses.map(business => new Option(`${business.is_demo === true ? "Demo" : business.is_demo === false ? "Live accounting" : "Unverified"} · ${business.business_name}`, business.id)));
    select.value = selectedId;
    select.disabled = !businesses.length;
  }
  if (selectedId) rememberBusiness(selectedId);
  document.getElementById("open-demo-workspace").disabled = !businesses.some(business => business.is_demo === true);
  const demo = businesses.find(business => business.id === selectedId)?.is_demo === true;
  document.getElementById("workspace-demo-note").textContent = demo
    ? "Controlled sample data. Edit the sample invoice, preview payment and email details, then check the test-call gates."
    : "Open demo to use controlled sample data. Live accounting and its outreach lock remain separate.";
}

async function renderSettings() {
  const revision = businessSelectionRevision;
  renderBusinessChoices();
  const business = selectedBusiness();
  if (!business) return;
  document.getElementById("header-business-name").textContent = business.business_name || "Configured business";
  document.getElementById("setting-business-name").value = business.business_name || "";
  document.getElementById("setting-agent-name").value = business.agent_display_name || "Paul";
  document.getElementById("setting-product-type").value = business.product_type || "elevator_inspection";
  document.getElementById("setting-default-inspection-type").value = business.default_inspection_type || "Category 1";
  document.getElementById("setting-inspection-followup-days").value = business.days_after_inspection_first_call ?? 14;
  document.getElementById("setting-very-overdue-days").value = business.very_overdue_threshold_days ?? 45;
  document.getElementById("setting-timezone").value = business.default_timezone || "America/New_York";
  document.getElementById("setting-disclosure").value = business.ai_disclosure_policy || "after_identity";
  document.getElementById("setting-payment-provider").value = business.payment_provider || "stripe";
  document.getElementById("setting-callback-number").value = business.callback_number || "";
  document.getElementById("setting-transfer-number").value = business.human_transfer_number || "";
  document.getElementById("setting-max-batch").value = business.max_batch_size || 1;
  document.getElementById("setting-phone-allowlist").value = (business.test_phone_allowlist || []).join("\n");
  document.getElementById("setting-email-allowlist").value = (business.email_test_recipient_allowlist || []).join("\n");
  document.getElementById("setting-email-from").value = business.email_from || "";
  document.getElementById("setting-mailing").value = business.payment_mailing_instructions || "";
  document.getElementById("setting-callback-rules").value = JSON.stringify(business.callback_rules || {}, null, 2);
  document.getElementById("setting-test-mode").checked = business.test_mode !== false;
  document.getElementById("setting-after-hours").checked = Boolean(business.allow_after_hours_test_override);
  document.getElementById("setting-email-enabled").checked = Boolean(business.payment_email_enabled);
  document.getElementById("setting-sms-enabled").checked = Boolean(business.retell_sms_enabled);
  const accountingIdentity = business.is_demo === true ? "Demo" : business.is_demo === false ? "Live accounting" : "Accounting identity unverified";
  const outreachStatus = business.outreach_enabled === true ? "enabled" : business.outreach_enabled === false ? "locked" : "unverified";
  let modeDetail = `outreach ${outreachStatus}`;
  if (business.is_demo === true) modeDetail = business.test_mode !== false ? "controlled test" : "test mode off";
  else if (outreachStatus === "enabled" && business.test_mode !== false) modeDetail = "controlled test";
  document.getElementById("workspace-mode").textContent = `${accountingIdentity} · ${modeDetail}`;
  document.getElementById("workspace-mode").className = `state-badge ${business.test_mode !== false && outreachStatus !== "unverified" ? "info" : "warning"}`;
  document.getElementById("business-outreach-status").textContent = [
    `${accountingIdentity}.`,
    outreachStatus === "locked"
      ? "Customer outreach is locked for this business. Saving settings does not unlock it."
      : outreachStatus === "enabled"
        ? "Business outreach permission is enabled; each call still requires current backend checks and a manual start."
        : "Business outreach permission has not been verified by this page.",
    business.test_mode !== false
      ? "Outreach test mode is on and restricts recipients to the approved test allowlists. It does not change the accounting source."
      : "Outreach test mode is off. The accounting source and business outreach permission are separate settings.",
  ].join(" ");
  try {
    const response = await api(`/api/outbound/businesses/${business.id}/settings`);
    if (selectedBusiness()?.id !== business.id || businessSelectionRevision !== revision) return;
    settingsReadiness = response.readiness;
    document.getElementById("settings-readiness").textContent = [
      `Email requested: ${response.readiness.emailRequested ? "yes" : "no"}; provider ready: ${response.readiness.emailProviderReady ? "yes" : "no"}; effective: ${response.readiness.emailEffective ? "enabled" : "disabled/manual"}.`,
      `SMS requested: ${response.readiness.smsRequested ? "yes" : "no"}; provider ready: ${response.readiness.smsProviderReady ? "yes" : "no"}; effective: ${response.readiness.smsEffective ? "enabled" : "disabled/manual"}.`,
      "Secret values remain in Vercel. A sender change must match the verified server-side sender.",
    ].join(" ");
  } catch (error) {
    if (selectedBusiness()?.id !== business.id || businessSelectionRevision !== revision) return;
    document.getElementById("settings-readiness").textContent = error.message;
  }
}

async function saveSettings() {
  const business = selectedBusiness();
  if (!business) return setStatus("No business is selected.", true);
  let callbackRules;
  try { callbackRules = JSON.parse(document.getElementById("setting-callback-rules").value || "{}"); }
  catch { return setStatus("Callback rules must be valid JSON.", true); }
  const payload = {
    business_name: document.getElementById("setting-business-name").value.trim(),
    agent_display_name: document.getElementById("setting-agent-name").value.trim(),
    product_type: document.getElementById("setting-product-type").value,
    default_inspection_type: document.getElementById("setting-default-inspection-type").value,
    days_after_inspection_first_call: Number(document.getElementById("setting-inspection-followup-days").value),
    very_overdue_threshold_days: Number(document.getElementById("setting-very-overdue-days").value),
    default_timezone: document.getElementById("setting-timezone").value.trim(),
    ai_disclosure_policy: document.getElementById("setting-disclosure").value,
    payment_provider: document.getElementById("setting-payment-provider").value,
    callback_number: document.getElementById("setting-callback-number").value.trim() || null,
    human_transfer_number: document.getElementById("setting-transfer-number").value.trim() || null,
    max_batch_size: Number(document.getElementById("setting-max-batch").value),
    test_phone_allowlist: splitLines(document.getElementById("setting-phone-allowlist").value),
    email_test_recipient_allowlist: splitLines(document.getElementById("setting-email-allowlist").value),
    email_from: document.getElementById("setting-email-from").value.trim() || null,
    payment_mailing_instructions: document.getElementById("setting-mailing").value.trim() || null,
    test_mode: document.getElementById("setting-test-mode").checked,
    allow_after_hours_test_override: document.getElementById("setting-after-hours").checked,
    payment_email_enabled: document.getElementById("setting-email-enabled").checked,
    retell_sms_enabled: document.getElementById("setting-sms-enabled").checked,
    callback_rules: callbackRules,
    production_mode_confirmation: document.getElementById("setting-production-confirmation").value.trim() || undefined,
    batch_limit_confirmation: document.getElementById("setting-batch-confirmation").value.trim() || undefined,
  };
  try {
    await api(`/api/outbound/businesses/${business.id}/settings`, { method: "PATCH", body: JSON.stringify(payload) });
    document.getElementById("setting-production-confirmation").value = "";
    document.getElementById("setting-batch-confirmation").value = "";
    setStatus("Business and safety settings saved and audit logged.");
    await refreshAll();
  } catch (error) { setStatus(error.message, true); }
}

function selectedDemoInvoice() {
  const id = document.getElementById("demo-invoice-select")?.value;
  return scopedInvoices().find((invoice) => invoice.id === id) || scopedInvoices()[0] || null;
}

function populateDemoEditor(invoice) {
  demoReadinessRevision++;
  if (!invoice) return;
  const customer = invoice.outbound_customers || {};
  const business = invoice.outbound_businesses || {};
  document.getElementById("demo-call-mode").value = invoice.demo_call_mode || "first_reminder";
  document.getElementById("demo-first-name").value = customer.first_name || "";
  document.getElementById("demo-last-name").value = customer.last_name || "";
  document.getElementById("demo-customer-phone").value = customer.phone_number || "";
  document.getElementById("demo-customer-email").value = customer.email || "";
  document.getElementById("demo-business-name").value = business.business_name || "";
  document.getElementById("demo-external-invoice-id").value = invoice.invoice_id || "";
  document.getElementById("demo-amount-due").value = invoice.amount_due_cents === undefined ? "" : (Number(invoice.amount_due_cents) / 100).toFixed(2);
  document.getElementById("demo-inspection-date").value = invoice.inspection_date || "";
  document.getElementById("demo-invoice-date").value = invoice.invoice_date || "";
  document.getElementById("demo-original-due-date").value = invoice.original_due_date || "";
  document.getElementById("demo-inspection-type").value = invoice.inspection_type || business.default_inspection_type || "Category 1";
  document.getElementById("demo-expected-payment-date").value = invoice.expected_payment_date || "";
  document.getElementById("demo-service-description").value = invoice.service_description || "";
  document.getElementById("demo-previous-call-date").value = invoice.previous_call_date || "";
  document.getElementById("demo-preferred-payment-method").value = invoice.preferred_payment_method || customer.payment_contact_preference || "none";
  document.getElementById("demo-preferred-email").value = customer.preferred_email || "";
  document.getElementById("demo-preferred-phone").value = customer.preferred_phone_number || "";
  document.getElementById("demo-followup-reason").value = invoice.followup_reason || "";
  document.getElementById("demo-prior-concern-note").value = invoice.prior_concern_note || "";
  document.getElementById("demo-callback-details").value = invoice.callback_details || "";
  document.getElementById("demo-mailing-instructions").value = selectedBusiness()?.payment_mailing_instructions || "";
  const sourceLocked = isQuickBooksInvoice(invoice);
  document.querySelectorAll(".demo-editor input, .demo-editor select, .demo-editor textarea, #demo-save-details").forEach((control) => { control.disabled = sourceLocked; });
  if (sourceLocked) setDemoFeedback("This is a synced QuickBooks invoice. Accounting values are protected; select a local demo invoice to edit presentation details.", [{ label: "Synced · protected", tone: "info" }]);
  else setDemoFeedback("This is a local demo invoice. Save any changes, then run the backend preflight for the selected test number.", [{ label: "Local · editable", tone: "info" }]);
  activeDemoPreflight = null;
  document.getElementById("demo-start-call").disabled = true;
}

async function renderPresentationPanel() {
  const select = document.getElementById("demo-invoice-select");
  const previous = select.value;
  select.replaceChildren(...scopedInvoices().map((invoice) => {
    const customer = invoice.outbound_customers || {};
    return new Option(`${customer.first_name || ""} ${customer.last_name || ""} · ${invoice.invoice_id || "invoice"}`, invoice.id);
  }));
  if (previous && [...select.options].some((option) => option.value === previous)) select.value = previous;
  populateDemoEditor(selectedDemoInvoice());
  const business = selectedBusiness();
  if (!business) return;
  await Promise.allSettled([loadSourceStatus(), loadSourceQueue(), loadWeeklyReviewStatus()]);
}

async function authorizeDemoNumber() {
  const business = selectedBusiness();
  if (!business) return setStatus("Select a business before authorizing a demo number.", true);
  const businessRevision = businessSelectionRevision;
  if (!document.getElementById("demo-authorize-ack").checked) {
    const message = "Warning checkbox is required before authorizing a temporary test number.";
    setDemoFeedback(message, [{ label: "Blocked", tone: "blocked" }]);
    return setStatus(message, true);
  }
  const confirmation = document.getElementById("demo-authorize-confirmation").value.trim();
  if (confirmation !== DEMO_CALL_CONFIRMATION) {
    const message = `Exact confirmation phrase is incorrect. Type ${DEMO_CALL_CONFIRMATION}.`;
    setDemoFeedback(message, [{ label: "Blocked", tone: "blocked" }]);
    return setStatus(message, true);
  }
  const phoneNumber = document.getElementById("demo-phone-number").value.trim();
  const callMode = document.getElementById("demo-call-mode").value;
  const requestRevision = ++demoAuthorizationRequestRevision;
  const current = () => businessSelectionRevision === businessRevision && selectedBusiness()?.id === business.id && demoAuthorizationRequestRevision === requestRevision && document.getElementById("demo-phone-number").value.trim() === phoneNumber && document.getElementById("demo-call-mode").value === callMode;
  activeDemoAuthorization = null;
  invalidateCallGates();
  document.getElementById("demo-preflight").disabled = true;
  try {
    const result = await api("/api/outbound/demo-call/authorize-number", {
      method: "POST",
      body: JSON.stringify({
        business_id: business.id,
        phone_number: phoneNumber,
        demo_call_mode: callMode,
        scenario: callMode,
        ttl_minutes: Number(document.getElementById("demo-ttl-minutes").value || 240),
        acknowledged: true,
        confirmation,
      }),
    });
    if (!current()) return;
    activeDemoAuthorization = result.authorization;
    activeDemoPreflight = null;
    document.getElementById("demo-preflight").disabled = false;
    document.getElementById("demo-start-call").disabled = true;
    document.getElementById("demo-auth-status").textContent = `Authorized ${activeDemoAuthorization.phone_number} until ${formatDate(activeDemoAuthorization.expires_at)}`;
    setDemoFeedback(`Temporary test number ${activeDemoAuthorization.phone_number} is authorized. Run Preflight Check before starting any call.`, [
      { label: "Demo number authorized", tone: "ready" },
      { label: "Preflight required", tone: "warning" },
    ]);
    setStatus("Temporary demo test number authorized. Run the real backend preflight next.");
    await loadDashboard(true);
  } catch (error) {
    if (!current()) return;
    const message = friendlyErrorMessage(error);
    setDemoFeedback(message, [{ label: "Blocked", tone: "blocked" }]);
    setStatus(message, true);
  }
}

async function saveDemoDetails() {
  const invoice = selectedDemoInvoice();
  const customer = invoice?.outbound_customers || {};
  const business = invoice?.outbound_businesses || selectedBusiness();
  if (!invoice || !customer.id || !business?.id) return setStatus("Select a demo invoice before saving details.", true);
  try {
    await api("/api/outbound/demo-details", {
      method: "PATCH",
      body: JSON.stringify({
        business_id: business.id,
        customer_id: customer.id,
        invoice_id: invoice.id,
        first_name: document.getElementById("demo-first-name").value.trim(),
        last_name: document.getElementById("demo-last-name").value.trim(),
        phone_number: document.getElementById("demo-customer-phone").value.trim(),
        email: document.getElementById("demo-customer-email").value.trim(),
        business_name: document.getElementById("demo-business-name").value.trim(),
        service_description: document.getElementById("demo-service-description").value.trim(),
        inspection_type: document.getElementById("demo-inspection-type").value,
        expected_payment_date: document.getElementById("demo-expected-payment-date").value.trim() || null,
        amount_due: document.getElementById("demo-amount-due").value.trim(),
        inspection_date: document.getElementById("demo-inspection-date").value || null,
        invoice_date: document.getElementById("demo-invoice-date").value || null,
        original_due_date: document.getElementById("demo-original-due-date").value.trim(),
        external_invoice_id: document.getElementById("demo-external-invoice-id").value.trim(),
        demo_call_mode: document.getElementById("demo-call-mode").value,
        previous_call_date: document.getElementById("demo-previous-call-date").value.trim() || null,
        followup_reason: document.getElementById("demo-followup-reason").value.trim() || null,
        prior_concern_note: document.getElementById("demo-prior-concern-note").value.trim() || null,
        preferred_payment_method: document.getElementById("demo-preferred-payment-method").value,
        callback_details: document.getElementById("demo-callback-details").value.trim() || null,
        preferred_email: document.getElementById("demo-preferred-email").value.trim(),
        preferred_phone_number: document.getElementById("demo-preferred-phone").value.trim(),
        payment_mailing_instructions: document.getElementById("demo-mailing-instructions").value.trim() || null,
      }),
    });
    activeDemoPreflight = null;
    document.getElementById("demo-start-call").disabled = true;
    setDemoFeedback("Demo variables saved. Run Preflight Check again so the backend can evaluate the updated call context.", [
      ...(activeDemoAuthorization?.id && !demoAuthorizationExpired()
        ? [{ label: "Demo number authorized", tone: "ready" }]
        : [{ label: "Needs setup", tone: "warning" }]),
      { label: "Preflight required", tone: "warning" },
    ]);
    setStatus("Demo variables saved. Invoice payment status was not changed.");
    await refreshAll();
  } catch (error) {
    const message = friendlyErrorMessage(error);
    setDemoFeedback(message, [{ label: "Blocked", tone: "blocked" }]);
    setStatus(message, true);
  }
}

function demoRunPayload() {
  const invoice = selectedDemoInvoice();
  if (!invoice) throw new Error("Select a demo invoice first.");
  if (!activeDemoAuthorization?.id) throw new Error("Authorize a temporary demo number first.");
  if (demoAuthorizationExpired()) throw new Error("Temporary demo authorization expired. Authorize the test number again.");
  return {
    invoice_id: invoice.id,
    demo_call_authorization_id: activeDemoAuthorization.id,
    after_hours_override: afterHoursOverridePayload(),
  };
}

async function demoPreflight() {
  const businessId = selectedBusiness()?.id;
  const businessRevision = businessSelectionRevision;
  const readinessRevision = demoReadinessRevision;
  const requestRevision = ++demoPreflightRequestRevision;
  let payload;
  const current = () => selectedBusiness()?.id === businessId && businessSelectionRevision === businessRevision && demoReadinessRevision === readinessRevision && demoPreflightRequestRevision === requestRevision && (!payload || (selectedDemoInvoice()?.id === payload.invoice_id && activeDemoAuthorization?.id === payload.demo_call_authorization_id && !demoAuthorizationExpired() && JSON.stringify(afterHoursOverridePayload()) === JSON.stringify(payload.after_hours_override)));
  activeDemoPreflight = null;
  document.getElementById("demo-start-call").disabled = true;
  try {
    payload = demoRunPayload();
    const result = await api("/api/outbound/demo-call/preflight", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!current()) return;
    activeDemoPreflight = result;
    document.getElementById("demo-start-call").disabled = !activeDemoPreflight.eligible;
    const reason = activeDemoPreflight.after_hours_override_block_reason || activeDemoPreflight.reason;
    const message = activeDemoPreflight.eligible
      ? `Preflight passed for ${activeDemoPreflight.destination_phone_number} using ${activeDemoPreflight.agent_label}. The Start button will still use the real backend single-call endpoint.`
      : friendlyReason(reason);
    const badges = activeDemoPreflight.eligible
      ? [
          { label: "Ready", tone: "ready" },
          { label: "Demo number authorized", tone: "ready" },
          { label: "Conversation Flow", tone: "info" },
        ]
      : [
          { label: reason === "outside_calling_window" ? "Needs after-hours confirmation" : "Blocked", tone: reason === "outside_calling_window" ? "warning" : "blocked" },
          { label: "Backend preflight", tone: "info" },
        ];
    setDemoFeedback(message, badges);
    setStatus(activeDemoPreflight.eligible
      ? `Demo call preflight passed for ${activeDemoPreflight.destination_phone_number} using ${activeDemoPreflight.agent_label}.`
      : `Demo call blocked: ${message}`,
      !activeDemoPreflight.eligible);
  } catch (error) {
    if (!current()) return;
    document.getElementById("demo-start-call").disabled = true;
    const message = friendlyErrorMessage(error);
    setDemoFeedback(message, [{ label: "Blocked", tone: "blocked" }]);
    setStatus(message, true);
  }
}

async function startDemoCall() {
  try {
    const preflight = activeDemoPreflight?.eligible ? activeDemoPreflight : await api("/api/outbound/demo-call/preflight", {
      method: "POST",
      body: JSON.stringify(demoRunPayload()),
    });
    if (!preflight.eligible) {
      const message = friendlyReason(preflight.after_hours_override_block_reason || preflight.reason);
      setDemoFeedback(message, [{ label: "Blocked", tone: "blocked" }]);
      return setStatus(`Demo call blocked: ${message}`, true);
    }
    if (!confirm(`Start one gated presentation call to ${preflight.destination_phone_number}?`)) return;
    const result = await api("/api/outbound/demo-call/start", {
      method: "POST",
      body: JSON.stringify(demoRunPayload()),
    });
    document.getElementById("demo-start-call").disabled = true;
    setDemoFeedback(`Retell accepted the one-call request for ${preflight.destination_phone_number}. Dashboard data is refreshing.`, [
      { label: "Submitted", tone: "ready" },
    ]);
    setStatus(`Retell demo call registered: ${result.call_id}`);
    await refreshAll();
  } catch (error) {
    const message = friendlyErrorMessage(error);
    setDemoFeedback(message, [{ label: "Blocked", tone: "blocked" }]);
    setStatus(message, true);
  }
}

function afterHoursOverridePayload() {
  if (!setupState?.call_safety?.after_hours_test_override_enabled) return undefined;
  const acknowledged = document.getElementById("after-hours-ack").checked;
  const confirmation = document.getElementById("after-hours-confirmation").value.trim();
  if (!acknowledged || confirmation !== AFTER_HOURS_CONFIRMATION) return undefined;
  return { acknowledged: true, confirmation, reason: "self_test" };
}

function invalidateCallGates() {
  demoReadinessRevision++;
  activeDemoPreflight = null;
  document.getElementById("demo-start-call").disabled = true;
  document.querySelectorAll('[data-action="call"]').forEach((button) => { button.disabled = true; });
  document.querySelectorAll('[data-field="gate"]').forEach((gate) => {
    gate.textContent = "Recheck required";
    gate.className = "gate-status";
  });
}

function setGateState(row, result) {
  const gate = row.querySelector('[data-field="gate"]');
  const callButton = row.querySelector('[data-action="call"]');
  const overrideLabel = result.after_hours_override_used ? " · after-hours self-test override" : "";
  gate.textContent = result.eligible
    ? `Eligible now${overrideLabel}`
    : `${friendlyReason(result.after_hours_override_block_reason || result.reason)} · ${formatDate(result.recipient_local_time)}`;
  gate.className = `gate-status ${result.eligible ? "ready" : "blocked"}`;
  callButton.disabled = !result.eligible;
  selectedCallStatus.textContent = result.eligible
    ? `Selected call is eligible in ${result.timezone}${overrideLabel}. The server will recheck every gate when starting.`
    : `Selected call is blocked: ${friendlyReason(result.after_hours_override_block_reason || result.reason)} Window: ${result.calling_window}.`;
  selectedCallStatus.className = `selected-call-status ${result.eligible ? "ready" : "blocked"}`;
}

async function checkCallGates(invoice, row) {
  const gate = row.querySelector('[data-field="gate"]');
  const callButton = row.querySelector('[data-action="call"]');
  gate.textContent = "Checking...";
  callButton.disabled = true;
  try {
    const result = await api("/api/outbound/calls/dry-run", {
      method: "POST",
      body: JSON.stringify({ invoice_id: invoice.id, after_hours_override: afterHoursOverridePayload() }),
    });
    setGateState(row, result);
    return result;
  } catch (error) {
    gate.textContent = error.message;
    gate.className = "gate-status blocked";
    selectedCallStatus.textContent = error.message;
    selectedCallStatus.className = "selected-call-status blocked";
    return null;
  }
}

function updateBatchButton() {
  const selected = document.querySelectorAll('[data-action="batch-select"]:checked').length;
  batchDryRunButton.disabled = selected === 0;
  batchDryRunButton.textContent = `Batch dry run (${selected})`;
}

function invoiceMatches(invoice) {
  const filter = document.getElementById("invoice-filter").value;
  const query = document.getElementById("invoice-search").value.trim().toLowerCase();
  const customer = invoice.outbound_customers || {};
  const source = document.getElementById("invoice-source-filter").value;
  const sourceMatches = source === "all" || (source === "quickbooks" ? isQuickBooksInvoice(invoice) : !isQuickBooksInvoice(invoice));
  const statusMatches = filter === "all" || invoice.status === filter || (filter === "paused" && customer.outreach_paused);
  const searchText = `${customer.first_name || ""} ${customer.last_name || ""} ${customer.account_company_name || ""} ${invoice.invoice_id || ""} ${invoice.service_description || ""}`.toLowerCase();
  return sourceMatches && statusMatches && (!query || searchText.includes(query));
}

function renderInvoice(invoice) {
  const row = document.getElementById("invoice-row-template").content.firstElementChild.cloneNode(true);
  const customer = invoice.outbound_customers || {};
  const business = invoice.outbound_businesses || {};
  const calls = invoice.outbound_call_attempts || [];
  const paymentLinks = invoice.outbound_payment_links || [];
  const tasks = (invoice.outbound_followup_tasks || []).filter((task) => task.status === "pending");
  const lastCall = latest(calls);
  const nextTask = [...tasks].sort((a, b) => String(a.scheduled_for).localeCompare(String(b.scheduled_for)))[0];
  const phone = row.querySelector('[data-action="phone"]');
  const email = row.querySelector('[data-action="email"]');
  const callButton = row.querySelector('[data-action="call"]');
  const batchSelect = row.querySelector('[data-action="batch-select"]');
  const accountInvoices = scopedInvoices().filter((item) => item.customer_id === invoice.customer_id && invoiceCurrency(item) === invoiceCurrency(invoice));
  const openAccountInvoices = accountInvoices.filter((item) => ["unpaid", "payment_link_sent"].includes(item.status));
  const accountTotal = openAccountInvoices.reduce((sum, item) => sum + Number(item.amount_due_cents || 0), 0);
  const lastPaid = accountInvoices.filter((item) => item.status === "paid" && item.paid_at).sort((a, b) => String(b.paid_at).localeCompare(String(a.paid_at)))[0];

  batchSelect.value = invoice.id;
  batchSelect.setAttribute("aria-label", `Select invoice ${invoice.invoice_id} for batch dry run`);
  batchSelect.onchange = updateBatchButton;
  row.querySelector('[data-field="customer"]').textContent = `${customer.first_name || ""} ${customer.last_name || ""}`.trim();
  row.querySelector('[data-field="business"]').textContent = customer.account_company_name || business.business_name || "";
  const contactContext = [
    customer.payment_contact_preference && customer.payment_contact_preference !== "none" ? `Prefers ${humanize(customer.payment_contact_preference)}` : "",
    customer.preferred_email ? `Preferred email: ${customer.preferred_email}` : "",
    customer.preferred_phone_number ? `Preferred phone: ${customer.preferred_phone_number}` : "",
    customer.responsible_party_name ? `Responsible party: ${customer.responsible_party_name}${customer.responsible_party_email ? ` (${customer.responsible_party_email})` : ""}${customer.responsible_party_phone ? ` ${customer.responsible_party_phone}` : ""}` : "",
    customer.named_contact_requested ? `Named contact requested: ${customer.named_contact_requested}` : "",
    customer.contact_update_note ? `Contact note: ${customer.contact_update_note}` : "",
  ].filter(Boolean).join("\n");
  row.querySelector('[data-field="contact-context"]').textContent = contactContext;
  phone.value = customer.phone_number || "";
  email.value = customer.email || "";
  for (const input of [phone, email]) input.oninput = () => { callButton.disabled = true; row.querySelector('[data-field="gate"]').textContent = "Save changes, then recheck"; };
  row.querySelector('[data-field="invoice"]').textContent = invoice.invoice_id;
  row.querySelector('[data-field="source"]').textContent = isQuickBooksInvoice(invoice) ? "QuickBooks · synced" : "Local / demo";
  row.querySelector('[data-field="ids"]').textContent = `customer ${customer.id}\ninvoice ${invoice.id}\nbusiness ${business.id}${isQuickBooksInvoice(invoice) ? `\nQuickBooks realm ${invoice.source_realm_id || "unverified"}\nQuickBooks invoice ${invoice.provider_invoice_id || "unverified"}\nBalance verified ${formatDate(invoice.source_verified_at)}\nInvoice date ${formatDate(invoice.invoice_date)}\nOriginal total ${formatMoney(invoice.original_total_cents, invoiceCurrency(invoice))}` : ""}`;
  row.querySelector('[data-field="service"]').textContent = `${invoice.service_description || "Service not supplied"} · invoice due ${formatDate(invoice.original_due_date)}${invoice.inspection_date ? ` · inspection ${formatDate(invoice.inspection_date)}` : ""}`;
  row.querySelector('[data-field="amount"]').textContent = formatMoney(invoice.amount_due_cents, invoiceCurrency(invoice));
  row.querySelector('[data-field="amount"]').title = `Account: ${openAccountInvoices.length} open invoice(s), ${formatMoney(accountTotal, invoiceCurrency(invoice))} total due. Last payment: ${lastPaid ? formatDate(lastPaid.paid_at) : formatDate(customer.imported_last_payment_date)}.`;
  row.querySelector('[data-field="payment"]').textContent = invoice.status === "paid" ? "Payment: paid" : `Payment: ${latest(paymentLinks)?.status || "no session"}`;
  row.querySelector('[data-field="last-call"]').textContent = lastCall ? `${humanize(lastCall.outcome || lastCall.status)}${lastCall.summary ? ` · ${lastCall.summary}` : ""}` : "No calls";
  row.querySelector('[data-field="next-followup"]').textContent = `Next: ${nextTask ? formatDate(nextTask.scheduled_for) : "none"}`;
  row.querySelector('[data-field="paused"]').textContent = customer.outreach_paused ? "Outreach paused" : "Outreach requires preflight";
  row.querySelector('[data-field="expected-payment"]').textContent = invoice.expected_payment_date ? `Payment expected: ${formatDate(invoice.expected_payment_date)}` : "Payment date not recorded";
  const statusSelect = row.querySelector('[data-action="status"]');
  statuses.forEach((status) => statusSelect.add(new Option(humanize(status), status, false, status === invoice.status)));
  statusSelect.disabled = isQuickBooksInvoice(invoice);
  statusSelect.setAttribute("aria-label", `Payment status for ${invoice.invoice_id}`);
  const notes = row.querySelector('[data-action="notes"]');
  notes.value = invoice.notes || customer.notes || "";

  row.querySelector('[data-action="save"]').onclick = async () => {
    try {
      await api(`/api/outbound/customers/${customer.id}`, { method: "PATCH", body: JSON.stringify({ phone_number: phone.value.trim(), email: email.value.trim() }) });
      await api(`/api/outbound/invoices/${invoice.id}`, { method: "PATCH", body: JSON.stringify({ ...(isQuickBooksInvoice(invoice) ? {} : { status: statusSelect.value }), notes: notes.value }) });
      setStatus(`Saved customer and invoice ${invoice.invoice_id}.`);
      await refreshAll();
    } catch (error) { setStatus(error.message, true); }
  };
  row.querySelector('[data-action="payment"]').onclick = async () => {
    try {
      const result = await api(`/api/outbound/invoices/${invoice.id}/create-checkout-session`, { method: "POST", body: "{}" });
      window.open(result.payment_link.url, "_blank", "noopener,noreferrer");
      setStatus(isQuickBooksInvoice(invoice) ? "Opened the verified QuickBooks invoice payment link." : result.reused ? "Reused the active Stripe Checkout Session." : "Created an exact-amount Stripe Checkout Session.");
      await refreshAll();
    } catch (error) { setStatus(error.message, true); }
  };
  row.querySelector('[data-action="preflight"]').onclick = () => checkCallGates(invoice, row);
  callButton.onclick = async () => {
    const preflight = await checkCallGates(invoice, row);
    if (!preflight?.eligible) return;
    if (!confirm(`Start one gated test call to ${phone.value.trim()}?`)) return;
    try {
      const result = await api("/api/outbound/calls/start", { method: "POST", body: JSON.stringify({ invoice_id: invoice.id, after_hours_override: afterHoursOverridePayload() }) });
      setStatus(`Retell call registered: ${result.call_id}`);
      callButton.disabled = true;
      await refreshAll();
    } catch (error) { setStatus(error.message, true); }
  };
  const pauseButton = row.querySelector('[data-action="pause"]');
  pauseButton.textContent = customer.outreach_paused ? "Resume" : "Pause";
  pauseButton.onclick = async () => {
    try {
      await api(`/api/outbound/customers/${customer.id}/${customer.outreach_paused ? "resume" : "pause"}`, { method: "POST", body: JSON.stringify({ reason: "admin_page" }) });
      await refreshAll();
    } catch (error) { setStatus(error.message, true); }
  };
  return row;
}

function renderInvoices() {
  const invoices = scopedInvoices().filter(invoiceMatches);
  document.getElementById("invoice-rows").replaceChildren(...invoices.map(renderInvoice));
  document.getElementById("invoice-empty").hidden = invoices.length > 0;
  document.getElementById("invoice-result-count").textContent = `${invoices.length} of ${scopedInvoices().length} invoices shown`;
  updateBatchButton();
}

function renderCallbacks() {
  const tasks = (dashboardState.followups || []).filter((task) => task.task_type === "callback" && inSelectedBusiness(task));
  const rows = tasks.map((task) => {
    const row = document.createElement("tr");
    const customer = task.outbound_customers || {};
    const invoiceRef = task.outbound_invoices || {};
    const invoice = (dashboardState.invoices || []).find((item) => item.id === task.invoice_id);
    const cells = Array.from({ length: 5 }, () => document.createElement("td"));
    const name = document.createElement("strong");
    name.textContent = `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || "Unknown customer";
    const invoiceLabel = document.createElement("span");
    invoiceLabel.className = "subtext";
    invoiceLabel.textContent = invoiceRef.invoice_id || "Unknown invoice";
    cells[0].append(name, invoiceLabel);
    const scheduled = document.createElement("input");
    scheduled.type = "datetime-local";
    scheduled.value = localDateTimeInput(task.scheduled_for, task.callback_timezone);
    const zone = document.createElement("span");
    zone.className = "subtext";
    zone.textContent = `${task.callback_timezone || "Timezone unavailable"} · ${formatDate(task.scheduled_for)}`;
    cells[1].append(scheduled, zone);
    cells[2].textContent = task.callback_reason || task.reason || "Callback requested";
    cells[2].append(details("Confirmation", task.callback_confirmation_text || "No confirmation text stored"));
    cells[3].append(badge(task.status, task.status === "pending" ? "info" : task.status === "completed" ? "success" : "neutral"));
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const save = document.createElement("button");
    save.className = "secondary";
    save.textContent = "Save time";
    save.disabled = task.status !== "pending";
    save.onclick = async () => {
      try {
        await api(`/api/outbound/followups/${task.id}`, { method: "PATCH", body: JSON.stringify({ scheduled_for_local: scheduled.value, callback_timezone: task.callback_timezone || "America/New_York" }) });
        setStatus("Callback time updated and audit logged.");
        await refreshAll();
      } catch (error) { setStatus(error.message, true); }
    };
    const complete = document.createElement("button");
    complete.className = "secondary";
    complete.textContent = "Mark completed";
    complete.disabled = !["pending", "in_progress"].includes(task.status);
    complete.onclick = async () => {
      try {
        await api(`/api/outbound/followups/${task.id}`, { method: "PATCH", body: JSON.stringify({ status: "completed" }) });
        await refreshAll();
      } catch (error) { setStatus(error.message, true); }
    };
    const preflight = document.createElement("button");
    preflight.className = "secondary";
    preflight.textContent = "Check call gates";
    const start = document.createElement("button");
    start.className = "danger-muted";
    start.textContent = "Start one callback";
    start.disabled = true;
    preflight.disabled = task.status !== "pending" || !invoice;
    preflight.onclick = async () => {
      try {
        const result = await api("/api/outbound/calls/dry-run", { method: "POST", body: JSON.stringify({ invoice_id: task.invoice_id, followup_task_id: task.id, after_hours_override: afterHoursOverridePayload() }) });
        start.disabled = !result.eligible;
        setStatus(result.eligible ? "Callback passed the real backend preflight." : `Callback blocked: ${humanize(result.reason)}.`, !result.eligible);
      } catch (error) { start.disabled = true; setStatus(error.message, true); }
    };
    start.onclick = async () => {
      const result = await api("/api/outbound/calls/dry-run", { method: "POST", body: JSON.stringify({ invoice_id: task.invoice_id, followup_task_id: task.id, after_hours_override: afterHoursOverridePayload() }) });
      if (!result.eligible || !confirm(`Start one gated callback to ${customer.phone_number || "the selected customer"}?`)) return;
      try {
        const started = await api("/api/outbound/calls/start", { method: "POST", body: JSON.stringify({ invoice_id: task.invoice_id, followup_task_id: task.id, after_hours_override: afterHoursOverridePayload() }) });
        setStatus(`Retell callback registered: ${started.call_id}`);
        start.disabled = true;
        await refreshAll();
      } catch (error) { setStatus(error.message, true); }
    };
    actions.append(save, complete, preflight, start);
    cells[4].append(actions);
    row.append(...cells);
    return row;
  });
  document.getElementById("callback-rows").replaceChildren(...rows);
  document.getElementById("callback-empty").hidden = rows.length > 0;
  document.getElementById("callback-count").textContent = `${rows.length} callback${rows.length === 1 ? "" : "s"}`;
}

function renderCalls() {
  const calls = (dashboardState.calls || []).filter(inSelectedBusiness);
  const rows = calls.map((call) => {
    const row = document.createElement("tr");
    const customer = call.outbound_customers || {};
    const invoice = call.outbound_invoices || {};
    const analysis = call.analysis && typeof call.analysis === "object" ? call.analysis : {};
    const cells = Array.from({ length: 7 }, () => document.createElement("td"));
    cells[0].textContent = formatDate(call.started_at || call.created_at);
    cells[1].innerHTML = "";
    const customerName = document.createElement("strong");
    const invoiceLabel = document.createElement("span");
    customerName.textContent = `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || "Unknown customer";
    invoiceLabel.className = "subtext";
    invoiceLabel.textContent = `${invoice.invoice_id || "Unknown invoice"} · ${invoice.service_description || ""}`;
    cells[1].append(customerName, invoiceLabel);
    const outcomeTone = ["do_not_contact", "wrong_number", "dispute", "attorney_represented"].includes(call.outcome) ? "warning" : call.outcome ? "success" : "neutral";
    cells[2].append(badge(call.outcome || call.status || "pending", outcomeTone));
    cells[3].textContent = call.summary || "No clear summary available from transcript.";
    cells[4].textContent = Number.isFinite(call.duration_ms) ? `${Math.round(call.duration_ms / 1000)}s` : "Unknown";
    cells[5].textContent = humanize(analysis.next_action || "manual_review");
    const detailWrap = document.createElement("div");
    detailWrap.className = "detail-stack";
    detailWrap.append(details("Transcript", call.transcript || "No transcript stored"));
    detailWrap.append(details("Tools and errors", JSON.stringify({ tools_invoked: analysis.tools_invoked || [], tool_errors: analysis.tool_errors || [] }, null, 2)));
    detailWrap.append(details("Internal IDs", `call attempt ${call.id}\nRetell ${call.retell_call_id || "none"}`));
    if (call.recording_url) {
      const link = document.createElement("a");
      link.href = call.recording_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open recording";
      detailWrap.append(link);
    }
    if (!call.summary && call.status === "ended") {
      const repair = document.createElement("button");
      repair.className = "secondary small";
      repair.textContent = "Repair analysis";
      repair.onclick = async () => {
        try {
          await api(`/api/outbound/calls/${call.id}/rebuild-analysis`, { method: "POST", body: "{}" });
          setStatus("Call analysis rebuilt from the stored Retell event.");
          await refreshAll();
        } catch (error) { setStatus(error.message, true); }
      };
      detailWrap.append(repair);
    }
    cells[6].append(detailWrap);
    row.append(...cells);
    return row;
  });
  document.getElementById("call-rows").replaceChildren(...rows);
  document.getElementById("call-empty").hidden = rows.length > 0;
  document.getElementById("call-count").textContent = `${calls.length} call${calls.length === 1 ? "" : "s"}`;
}

function renderPayments() {
  const links = (dashboardState.payment_links || []).filter(inSelectedBusiness);
  const rows = links.map((link) => {
    const row = document.createElement("tr");
    const customer = link.outbound_customers || {};
    const invoice = link.outbound_invoices || {};
    const cells = Array.from({ length: 7 }, () => document.createElement("td"));
    cells[0].textContent = formatDate(link.created_at);
    const label = document.createElement("strong");
    const name = document.createElement("span");
    label.textContent = invoice.invoice_id || "Unknown invoice";
    name.className = "subtext";
    name.textContent = `${customer.first_name || ""} ${customer.last_name || ""}`.trim();
    cells[1].append(label, name);
    cells[2].textContent = formatMoney(link.amount_cents, link.currency || invoiceCurrency(invoice));
    cells[3].append(badge(link.status, link.status === "paid" ? "success" : link.status === "open" ? "info" : "neutral"));
    cells[4].textContent = link.sent_via ? humanize(link.sent_via) : "Not delivered";
    cells[5].textContent = link.paid_at ? `Paid ${formatDate(link.paid_at)}` : link.expires_at ? `Expires ${formatDate(link.expires_at)}` : "No expiry";
    const actionWrap = document.createElement("div");
    actionWrap.className = "detail-stack";
    if (link.url && link.status === "open") {
      const open = document.createElement("a");
      open.href = link.url;
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      open.textContent = "Open Checkout";
      const copy = document.createElement("button");
      copy.className = "secondary small";
      copy.textContent = "Copy link";
      copy.onclick = async () => { await navigator.clipboard.writeText(link.url); setStatus("Payment link copied."); };
      actionWrap.append(open, copy);
    }
    actionWrap.append(details("Session details", `Checkout ${link.stripe_checkout_session_id || "pending"}\nInternal ${link.id}`));
    cells[6].append(actionWrap);
    row.append(...cells);
    return row;
  });
  document.getElementById("payment-rows").replaceChildren(...rows);
  document.getElementById("payment-empty").hidden = rows.length > 0;
  document.getElementById("payment-count").textContent = `${links.length} link${links.length === 1 ? "" : "s"}`;
}

function eventMessage(event) {
  const payload = event.payload || {};
  if (event.event_type === "after_hours_test_override_authorized") return "Allowlisted after-hours self-test authorized.";
  if (event.event_type === "call_analysis_rebuilt") return "Stored Retell analysis was repaired.";
  if (String(event.event_type).startsWith("email_")) return humanize(event.event_type);
  if (payload.reason) return humanize(payload.reason);
  return humanize(event.event_type);
}

function renderEvents() {
  const filter = document.getElementById("event-filter").value;
  const events = (dashboardState.events || []).filter((event) => inSelectedBusiness(event) && (filter === "all" || event.source === filter));
  const rows = events.map((event) => {
    const row = document.createElement("tr");
    const invoice = event.outbound_invoices || {};
    const cells = Array.from({ length: 6 }, () => document.createElement("td"));
    cells[0].textContent = formatDate(event.created_at);
    cells[1].append(badge(event.source, "info"));
    cells[2].textContent = humanize(event.event_type);
    cells[3].textContent = invoice.invoice_id || "None";
    cells[4].textContent = eventMessage(event);
    cells[5].append(details("View redacted payload", JSON.stringify(event.payload || {}, null, 2)));
    row.append(...cells);
    return row;
  });
  document.getElementById("event-rows").replaceChildren(...rows);
  document.getElementById("event-empty").hidden = rows.length > 0;
  document.getElementById("event-count").textContent = `${events.length} event${events.length === 1 ? "" : "s"}`;
}

function configureActiveCallPolling() {
  const active = dashboardState.calls.some((call) => ["starting", "registered", "ongoing"].includes(call.status));
  if (active && !activeCallPoll) activeCallPoll = setInterval(() => loadDashboard(true), 15000);
  if (!active && activeCallPoll) { clearInterval(activeCallPoll); activeCallPoll = null; }
}

async function loadDashboard(silent = false) {
  try {
    if (!silent) setStatus("Refreshing dashboard...");
    dashboardState = await api("/api/outbound/dashboard");
    const settings = renderSettings();
    renderInvoices();
    renderQueueOverview();
    await Promise.allSettled([settings, renderPresentationPanel(), loadTemplates(), loadSmsReadiness()]);
    renderCallbacks();
    renderCalls();
    renderPayments();
    renderEvents();
    document.getElementById("last-refreshed").textContent = `Last refreshed ${formatDate(dashboardState.refreshed_at)}`;
    configureActiveCallPolling();
    if (!silent) setStatus(`${dashboardState.invoices.length} invoices, ${dashboardState.calls.length} calls, and ${dashboardState.payment_links.length} payment links loaded.`);
  } catch (error) {
    invalidateCallGates();
    setStatus(`Dashboard refresh failed. Previously displayed records may be stale. ${error.message}`, true);
  }
}

async function refreshAll() {
  const button = document.getElementById("refresh-all");
  button.disabled = true;
  try { await Promise.all([loadSetupStatus(), loadDashboard()]); }
  finally { button.disabled = false; }
}

async function importCsv(dryRun) {
  const file = document.getElementById("csv-file").files[0];
  if (!file) return setStatus("Choose a CSV file first.", true);
  try {
    const csv = await file.text();
    const result = await api("/api/outbound/customers/import", { method: "POST", body: JSON.stringify({ csv, dry_run: dryRun }) });
    importResult.textContent = dryRun
      ? `${result.result.rows_valid} row(s) validated. Import is now enabled.`
      : `${result.result.customers_created} customer(s) created, ${result.result.customers_updated} updated; ${result.result.invoices_created} invoice(s) created, ${result.result.invoices_updated} updated.`;
    if (dryRun) { validatedCsvText = csv; commitImportButton.disabled = false; }
    else { validatedCsvText = ""; commitImportButton.disabled = true; await refreshAll(); }
  } catch (error) {
    validatedCsvText = "";
    commitImportButton.disabled = true;
    importResult.textContent = "";
    setStatus(error.message, true);
  }
}

async function importBusinessCsv(dryRun) {
  const file = document.getElementById("business-csv-file").files[0];
  const output = document.getElementById("business-import-result");
  if (!file) return setStatus("Choose a business setup CSV first.", true);
  try {
    const csv = await file.text();
    const result = await api("/api/outbound/businesses/import", { method: "POST", body: JSON.stringify({ csv, dry_run: dryRun }) });
    output.textContent = dryRun
      ? `${result.result.rows_valid} business row(s) validated. Import is now enabled.`
      : `${result.result.businesses_created} business(es) created, ${result.result.businesses_updated} updated, ${result.result.rows_skipped} unchanged.`;
    if (dryRun) {
      validatedBusinessCsvText = csv;
      document.getElementById("commit-business-import").disabled = false;
    }
  } catch (error) {
    validatedBusinessCsvText = "";
    document.getElementById("commit-business-import").disabled = true;
    output.textContent = "";
    setStatus(error.message, true);
  }
}

document.getElementById("csv-file").onchange = () => { validatedCsvText = ""; commitImportButton.disabled = true; importResult.textContent = "Validate the selected file before importing."; };
document.getElementById("refresh-all").onclick = refreshAll;
document.getElementById("refresh-setup").onclick = loadSetupStatus;
function clearBusinessPanels() {
  businessSelectionRevision++;
  emailPreviewRevision++;
  templateLoadRevision++;
  templateState = [];
  quickbooksState = null;
  settingsReadiness = null;
  for (const id of ["template-controls", "template-preview", "source-sync-controls", "source-sync-result"]) document.getElementById(id).replaceChildren();
  for (const id of ["template-status", "source-connection-detail", "spreadsheet-sync-detail", "weekly-review-detail", "source-queue-content", "sms-readiness-detail", "settings-readiness", "quickbooks-status", "queue-source-notice"]) document.getElementById(id).textContent = "Loading the selected business…";
  document.getElementById("source-queue-count").textContent = "Loading source records…";
}

async function changeBusiness(businessId) {
  if (!(dashboardState.businesses || []).some(business => business.id === businessId)) return;
  document.getElementById("settings-business").value = businessId;
  document.getElementById("workspace-business").value = businessId;
  rememberBusiness(businessId);
  clearBusinessPanels();
  activeDemoAuthorization = null;
  activeDemoPreflight = null;
  document.getElementById("demo-auth-status").textContent = "No demo number authorized";
  document.getElementById("demo-preflight").disabled = true;
  document.getElementById("demo-start-call").disabled = true;
  const settings = renderSettings();
  renderInvoices(); renderQueueOverview(); renderCallbacks(); renderCalls(); renderPayments(); renderEvents();
  await Promise.allSettled([settings, renderPresentationPanel(), loadTemplates(), loadSmsReadiness()]);
}
document.getElementById("settings-business").onchange = () => changeBusiness(document.getElementById("settings-business").value);
document.getElementById("workspace-business").onchange = () => changeBusiness(document.getElementById("workspace-business").value);
document.getElementById("open-demo-workspace").onclick = async () => {
  const current = selectedBusiness();
  const demo = current?.is_demo === true ? current : (dashboardState.businesses || []).find(business => business.is_demo === true);
  if (!demo) return;
  setWorkspace("presentation");
  await changeBusiness(demo.id);
};
document.getElementById("save-settings").onclick = saveSettings;
document.getElementById("demo-invoice-select").onchange = () => populateDemoEditor(selectedDemoInvoice());
document.getElementById("demo-call-mode").onchange = invalidateCallGates;
document.getElementById("demo-authorize-number").onclick = authorizeDemoNumber;
document.getElementById("demo-save-details").onclick = saveDemoDetails;
document.getElementById("demo-preflight").onclick = demoPreflight;
document.getElementById("demo-start-call").onclick = startDemoCall;
document.getElementById("invoice-filter").onchange = renderInvoices;
document.getElementById("invoice-search").oninput = renderInvoices;
document.getElementById("invoice-source-filter").onchange = renderInvoices;
document.getElementById("event-filter").onchange = renderEvents;
document.getElementById("after-hours-ack").onchange = invalidateCallGates;
document.getElementById("after-hours-confirmation").oninput = invalidateCallGates;
document.getElementById("dry-run-import").onclick = () => importCsv(true);
document.getElementById("business-csv-file").onchange = () => { validatedBusinessCsvText = ""; document.getElementById("commit-business-import").disabled = true; document.getElementById("business-import-result").textContent = "Validate the selected business sheet before importing."; };
document.getElementById("dry-run-business-import").onclick = () => importBusinessCsv(true);
commitImportButton.onclick = async () => {
  if (!validatedCsvText) return setStatus("Validate the CSV before importing.", true);
  try {
    const result = await api("/api/outbound/customers/import", { method: "POST", body: JSON.stringify({ csv: validatedCsvText, dry_run: false }) });
    importResult.textContent = `${result.result.customers_created} customer(s) created, ${result.result.customers_updated} updated; ${result.result.invoices_created} invoice(s) created, ${result.result.invoices_updated} updated.`;
    validatedCsvText = "";
    commitImportButton.disabled = true;
    await refreshAll();
  } catch (error) { setStatus(error.message, true); }
};
document.getElementById("commit-business-import").onclick = async () => {
  if (!validatedBusinessCsvText) return setStatus("Validate the business setup sheet before importing.", true);
  try {
    const result = await api("/api/outbound/businesses/import", { method: "POST", body: JSON.stringify({ csv: validatedBusinessCsvText, dry_run: false }) });
    document.getElementById("business-import-result").textContent = `${result.result.businesses_created} business(es) created, ${result.result.businesses_updated} updated, ${result.result.rows_skipped} unchanged.`;
    validatedBusinessCsvText = "";
    document.getElementById("commit-business-import").disabled = true;
    await refreshAll();
  } catch (error) { setStatus(error.message, true); }
};
batchDryRunButton.onclick = async () => {
  const invoiceIds = [...document.querySelectorAll('[data-action="batch-select"]:checked')].map((input) => input.value);
  if (!invoiceIds.length) return;
  try {
    const result = await api("/api/outbound/calls/start-batch", { method: "POST", body: JSON.stringify({ mode: "dry_run", invoice_ids: invoiceIds }) });
    const eligible = result.results.filter((item) => item.eligible).length;
    setStatus(`Batch dry run complete: ${eligible} eligible, ${result.results.length - eligible} blocked, 0 calls placed.`);
    await loadDashboard(true);
  } catch (error) { setStatus(error.message, true); }
};
document.getElementById("logout").onclick = async () => { await api("/api/outbound/auth/logout", { method: "POST", body: "{}" }); location.reload(); };

function el(tag, content, className) {
  const node = document.createElement(tag);
  if (content !== undefined && content !== null) node.textContent = String(content);
  if (className) node.className = className;
  return node;
}

function setWorkspace(name, updateLocation = true) {
  const labels = { queue: "Invoice queue", presentation: "Presentation mode", connections: "Connections & sync", templates: "Email & SMS", activity: "Activity & payments", settings: "Business settings" };
  currentWorkspace = Object.hasOwn(labels, name) ? name : "queue";
  document.querySelectorAll("[data-workspace]").forEach((panel) => { panel.hidden = panel.dataset.workspace !== currentWorkspace; });
  document.querySelectorAll("[data-workspace-link]").forEach((button) => {
    const active = button.dataset.workspaceLink === currentWorkspace;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  document.getElementById("workspace-title").textContent = labels[currentWorkspace];
  if (updateLocation) history.replaceState(null, "", `#${currentWorkspace}`);
}

function renderQueueOverview() {
  const invoices = scopedInvoices();
  const totals = new Map();
  for (const invoice of invoices.filter((item) => ["unpaid", "payment_link_sent"].includes(item.status))) {
    const currency = invoiceCurrency(invoice);
    totals.set(currency, (totals.get(currency) || 0) + Number(invoice.amount_due_cents || 0));
  }
  const metrics = document.getElementById("queue-metrics");
  metrics.replaceChildren();
  const items = [
    ["Outstanding balance", totals.size ? [...totals].map(([currency, cents]) => formatMoney(cents, currency)) : ["—"], "Stored balance · rechecked before calls"],
    ["Invoices to review", String(invoices.length), "Review list · not a call-ready count"],
    ["Payment dates recorded", String(invoices.filter((invoice) => invoice.expected_payment_date).length), "Customer’s expected payment date"],
    ["Paused or needs review", String(invoices.filter((invoice) => invoice.outbound_customers?.outreach_paused || ["disputed", "manual_review"].includes(invoice.status)).length), "Resolve the reason before outreach"],
  ];
  items.forEach(([label, value, detail]) => {
    const card = el("article", null, "metric-card");
    const number = el("strong");
    if (Array.isArray(value)) value.forEach((amount) => number.append(el("span", amount, "currency-total"))); else number.textContent = value;
    card.append(el("span", label), number, el("small", detail)); metrics.append(card);
  });
  document.getElementById("nav-invoice-count").textContent = String(invoices.length);
}

function describeFields(container, fields) {
  const list = el("dl", null, "source-fields");
  fields.forEach(([name, value]) => { const cell = el("div"); cell.append(el("dt", name), el("dd", value ?? "Not verified")); list.append(cell); });
  container.append(list);
}

function renderSpreadsheetStatus(sync) {
  const output = document.getElementById("spreadsheet-sync-detail");
  const failure = sync?.failure || sync?.failure_code || sync?.job?.failure_code;
  const jobStatus = sync?.job?.status;
  const freshness = sync?.stale === false ? "Current for the imported snapshot"
    : sync?.stale === true ? sync.last_sheet_success_at ? "Stale · refresh required" : "No verified refresh recorded"
      : "Not verified";
  const coverage = sync?.source_run_id && sync?.latest_source_run_id
    ? sync.source_run_id === sync.latest_source_run_id ? "Matches the latest QuickBooks import" : "Does not include the latest QuickBooks import"
    : "No matching imported snapshot verified";
  const jobLabels = { active: "Refresh in progress", completed: "Completed", failed: "Failed", expired: "Expired · refresh unverified" };
  output.className = `setup-summary ${failure || jobStatus === "failed" || jobStatus === "expired" ? "error" : sync?.stale === false ? "ready" : "warning"}`;
  output.replaceChildren(el("h3", "Overdue spreadsheet · separate refresh"));
  describeFields(output, [
    ["Sheet freshness", freshness],
    ["Last verified sheet refresh", sync?.last_sheet_success_at ? formatDate(sync.last_sheet_success_at) : "None recorded"],
    ["QuickBooks snapshot in sheet", coverage],
    ["Latest sheet refresh", jobLabels[jobStatus] || "No refresh job recorded"],
  ]);
  if (failure) output.append(el("p", `Sheet refresh needs attention: ${humanize(failure)}.`, "error"));
  output.append(el("p", "QuickBooks import status and spreadsheet refresh status are tracked separately. The sheet remains an operational view; backend checks control customer outreach."));
  if (sync?.job) output.append(details("Spreadsheet refresh audit", JSON.stringify({
    confirmation_method: sync.attestation_mode || "unverified",
    last_successful_source_run_id: sync.source_run_id || null,
    latest_imported_source_run_id: sync.latest_source_run_id || null,
    job: sync.job,
  }, null, 2)));
}

async function loadSourceStatus() {
  const business = selectedBusiness();
  if (!business) return;
  const revision = businessSelectionRevision;
  const detail = document.getElementById("source-connection-detail");
  const controls = document.getElementById("source-sync-controls");
  controls.replaceChildren();
  document.getElementById("spreadsheet-sync-detail").textContent = "Reading spreadsheet refresh status…";
  try {
    const qb = await api(`/api/outbound/integrations/quickbooks/status?business_id=${encodeURIComponent(business.id)}`);
    if (selectedBusiness()?.id !== business.id || businessSelectionRevision !== revision) return;
    quickbooksState = qb;
    renderSpreadsheetStatus(qb.spreadsheet_sync);
    detail.className = "";
    const headline = qb.connected ? `${qb.company_name || "Company not verified"} · ${qb.environment || "Environment not verified"}` : "QuickBooks connection requires verification";
    detail.replaceChildren(el("strong", headline));
    describeFields(detail, [
      ["Source company", qb.company_name], ["Company / realm ID", qb.realm_id],
      ["Application access", "Reads only · no accounting writes"], ["Permission scope", qb.scope_description || "Scope not verified"],
      ["Last QuickBooks import", qb.last_successful_sync_at ? formatDate(qb.last_successful_sync_at) : "No successful import recorded"],
      ["Imported accounting freshness", qb.stale ? "Stale · refresh before review" : qb.last_successful_sync_at ? "Current at last import" : "Unverified"],
    ]);
    if (qb.blockers?.length) detail.append(el("p", `Needs attention: ${qb.blockers.map((item) => typeof item === "string" ? humanize(item) : item.message || item.reason || "Verification required").join(" · ")}`));
    const notice = document.getElementById("queue-source-notice");
    notice.textContent = qb.connected && qb.last_successful_sync_at
      ? `QuickBooks: ${qb.company_name || qb.realm_id}. Last accounting import ${formatDate(qb.last_successful_sync_at)}.${qb.stale ? " Data is stale. Refresh before review." : " The backend rechecks the balance immediately before a manual call."}`
      : "QuickBooks has no verified successful sync here. Local/demo invoices are labeled below; they are not verified accounting balances.";
    notice.className = `setup-summary ${qb.connected && qb.last_successful_sync_at && !qb.stale ? "ready" : "warning"}`;
    document.getElementById("quickbooks-status").textContent = `QuickBooks: ${qb.connected ? headline : "not verified"}. Payment provider is selected per invoice; a QuickBooks invoice is never automatically moved to Stripe.`;
    const actions = el("div", null, "sync-actions");
    const preview = el("button", "Preview QuickBooks import");
    preview.disabled = !qb.connected;
    preview.onclick = previewSourceSync;
    const report = el("a", "Download operational report", "download-link");
    report.href = `/api/outbound/integrations/quickbooks/report.csv?business_id=${encodeURIComponent(business.id)}`;
    actions.append(preview, report); controls.append(actions);

  } catch (error) {
    if (selectedBusiness()?.id !== business.id || businessSelectionRevision !== revision) return;
    quickbooksState = null;
    renderSpreadsheetStatus(null);
    detail.textContent = `Connection status unavailable: ${error.message}`;
    detail.className = "setup-summary warning";
    document.getElementById("quickbooks-status").textContent = "QuickBooks source could not be verified. No accounting import is available.";
    document.getElementById("queue-source-notice").textContent = `Accounting verification unavailable. Local dashboard data may be stale. ${error.message}`;
    document.getElementById("queue-source-notice").className = "setup-summary warning";
  }
}

async function loadWeeklyReviewStatus() {
  const business = selectedBusiness();
  if (!business) return;
  const revision = businessSelectionRevision;
  const output = document.getElementById("weekly-review-detail");
  output.replaceChildren(el("p", "Loading weekly review settings…"));
  try {
    const response = await api(`/api/outbound/integrations/review-runs/status?business_id=${encodeURIComponent(business.id)}`);
    if (selectedBusiness()?.id !== business.id || businessSelectionRevision !== revision) return;
    output.replaceChildren();
    const settings = response.settings || {};
    const review = response.review || {};
    if (review.spreadsheet_sync) renderSpreadsheetStatus(review.spreadsheet_sync);
    const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][settings.weekday];
    const hour = Number(settings.hour);
    const schedule = weekday && Number.isInteger(hour) && hour >= 0 && hour < 24 ? `${weekday} at ${hour % 12 || 12}:00 ${hour >= 12 ? "PM" : "AM"}` : "Not configured";
    output.append(el("h3", settings.enabled ? "Weekly review · active" : "Weekly review · activation pending"));
    describeFields(output, [["Schedule", schedule], ["Timezone", settings.timezone], ["Review reminder", settings.reminder_recipient], ["Source stage", humanize(review.stage || settings.stage || "unverified")], ["Last QuickBooks import", formatDate(review.last_successful_sync_at)], ["Staged snapshot", formatDate(review.staged_snapshot_at || settings.source_snapshot_at)], ["Next review", formatDate(response.calendar?.due_at)]]);
    output.append(el("p", "Weekly refresh prepares the review queue only. Customer calls still require a fresh balance check and manual start."));
    if (review.connection_blockers?.length) output.append(el("p", `Needs attention: ${review.connection_blockers.map(humanize).join(" · ")}`, "error"));
    const spreadsheetUrl = review.spreadsheet_url || settings.spreadsheet_url;
    if (spreadsheetUrl) {
      try { const url = new URL(spreadsheetUrl); if (url.protocol === "https:" && url.hostname === "docs.google.com" && !url.username && !url.password) { const link = el("a", "Open private overdue-invoice sheet", "download-link"); link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer"; output.append(link); } } catch { /* Invalid source links remain hidden. */ }
    }
    if (response.runs?.length) output.append(details("Recent review runs", JSON.stringify(response.runs, null, 2)));
  } catch (error) { if (selectedBusiness()?.id !== business.id || businessSelectionRevision !== revision) return; output.replaceChildren(el("p", `Weekly review status unavailable: ${error.message}`, "error")); }
}

async function previewSourceSync() {
  const business = selectedBusiness();
  if (!business) return;
  const revision = businessSelectionRevision;
  const output = document.getElementById("source-sync-result");
  output.replaceChildren(el("p", "Reading QuickBooks and validating the proposed import…"));
  try {
    const preview = await api("/api/outbound/integrations/quickbooks/preview", { method: "POST", body: JSON.stringify({ business_id: business.id }) });
    if (selectedBusiness()?.id !== business.id || businessSelectionRevision !== revision) return;
    output.replaceChildren();
    const result = el("div", null, "sync-result");
    result.append(el("h3", "Import preview · no records applied yet"));
    result.append(el("p", `Expires ${formatDate(preview.expires_at)}. Review the counts, currency totals, mappings, and exclusions before applying.`));
    result.append(details("Counts, totals and exclusions", JSON.stringify({ counts: preview.counts, totals_by_currency: preview.totals_by_currency, exclusions: preview.exclusions }, null, 2)));
    result.append(details("Proposed invoice mappings", JSON.stringify(preview.rows || [], null, 2)));
    const apply = el("button", "Apply reviewed import");
    apply.disabled = preview.status !== "preview" || !preview.id || !preview.hash;
    apply.onclick = async () => {
      if (selectedBusiness()?.id !== business.id || businessSelectionRevision !== revision) return setStatus("The selected business changed. Create a new preview.", true);
      apply.disabled = true;
      try {
        const applied = await api("/api/outbound/integrations/quickbooks/apply", { method: "POST", body: JSON.stringify({ business_id: business.id, preview_id: preview.id, preview_hash: preview.hash }) });
        if (selectedBusiness()?.id !== business.id || businessSelectionRevision !== revision) return;
        output.replaceChildren(el("div", "Import applied to the review database. QuickBooks accounting records were not changed.", "setup-summary ready"), details("Import result", JSON.stringify(applied, null, 2)));
        await refreshAll();
      } catch (error) { if (selectedBusiness()?.id === business.id && businessSelectionRevision === revision) output.append(el("p", error.message, "error")); }
    };
    result.append(apply); output.append(result);
  } catch (error) { if (selectedBusiness()?.id !== business.id || businessSelectionRevision !== revision) return; output.replaceChildren(el("div", `Import preview failed: ${error.message}`, "setup-summary error")); }
}

function templateField(label, id, value = "", multiline = false) {
  const wrapper = el("label", label, multiline ? "wide" : "");
  const input = el(multiline ? "textarea" : "input");
  input.id = id; input.value = value;
  if (multiline) input.rows = 3;
  wrapper.append(input); return wrapper;
}

async function loadTemplates() {
  const business = selectedBusiness();
  if (!business) return;
  const loadRevision = ++templateLoadRevision;
  emailPreviewRevision++;
  const controls = document.getElementById("template-controls");
  const status = document.getElementById("template-status");
  try {
    const response = await api(`/api/outbound/email/templates?business_id=${encodeURIComponent(business.id)}`);
    if (selectedBusiness()?.id !== business.id || templateLoadRevision !== loadRevision) return;
    templateState = response.templates || [];
    const previous = document.getElementById("email-template-select")?.value;
    const previousInvoice = document.getElementById("email-preview-invoice")?.value;
    controls.replaceChildren();
    const form = el("div", null, "template-form");
    const selectLabel = el("label", "Template / version");
    const select = el("select"); select.id = "email-template-select";
    templateState.forEach((template) => select.add(new Option(`${template.content?.name || "Invoice reminder"} · v${template.version} · ${template.status}${template.is_default ? " · default" : ""}`, template.id)));
    if (templateState.some((template) => template.id === previous)) select.value = previous;
    else if (response.default_template_id) select.value = response.default_template_id;
    selectLabel.append(select);
    const invoiceLabel = el("label", "Preview invoice");
    const invoiceSelect = el("select"); invoiceSelect.id = "email-preview-invoice";
    scopedInvoices().forEach((invoice) => invoiceSelect.add(new Option(`${invoice.invoice_id} · ${formatMoney(invoice.amount_due_cents, invoiceCurrency(invoice))}`, invoice.id)));
    if (scopedInvoices().some((invoice) => invoice.id === previousInvoice)) invoiceSelect.value = previousInvoice;
    invoiceLabel.append(invoiceSelect);
    const preview = el("button", "Preview email", "secondary"); preview.disabled = !templateState.length || !scopedInvoices().length; preview.onclick = previewEmailTemplate;
    const retrieve = el("button", "Retrieve QuickBooks payment link", "secondary");
    retrieve.id = "template-quickbooks-link";
    const linkStatus = el("p", "QuickBooks only. Reads the existing invoice; no email is sent.", "muted wide");
    linkStatus.setAttribute("role", "status");
    let selectionRevision = 0;
    let retrieving = false;
    const selectedSourceInvoice = () => scopedInvoices().find((invoice) => invoice.id === invoiceSelect.value);
    const updateRetrieval = () => {
      const invoice = selectedSourceInvoice();
      retrieve.disabled = retrieving || invoice?.business_id !== business.id || invoice?.source_provider !== "quickbooks" || !invoice.provider_invoice_id || !invoice.source_realm_id || !Number.isSafeInteger(Number(invoice.amount_due_cents)) || Number(invoice.amount_due_cents) <= 0 || !["unpaid", "payment_link_sent"].includes(invoice.status);
    };
    retrieve.onclick = async () => {
      const invoice = selectedSourceInvoice();
      if (retrieve.disabled || !invoice) return;
      const revision = selectionRevision;
      const current = () => selectedBusiness()?.id === business.id && templateLoadRevision === loadRevision && selectionRevision === revision && invoiceSelect.value === invoice.id && controls.contains(retrieve);
      retrieving = true; updateRetrieval();
      linkStatus.textContent = "Checking the current QuickBooks invoice and its genuine customer payment link…";
      try {
        const result = await api("/api/outbound/quickbooks/invoice-link", { method: "POST", body: JSON.stringify({ business_id: business.id, invoice_id: invoice.id }) });
        if (!current()) return;
        const refreshed = await api("/api/outbound/dashboard");
        if (!current()) return;
        dashboardState = refreshed;
        renderInvoices(); renderQueueOverview(); renderPayments(); renderEvents();
        linkStatus.textContent = result.available && result.provider === "quickbooks" ? `Verified QuickBooks payment link ${result.reused ? "rechecked" : "retrieved"}. No email was sent.` : "No verified QuickBooks link is available. Review the existing invoice’s Share link in QuickBooks for manual follow-up.";
        await previewEmailTemplate();
      } catch (error) {
        if (!current()) return;
        linkStatus.textContent = error.message;
        await previewEmailTemplate();
      } finally { retrieving = false; if (controls.contains(retrieve)) updateRetrieval(); }
    };
    updateRetrieval();
    const publish = el("button", "Publish selected as default", "secondary");
    publish.disabled = !templateState.length;
    publish.onclick = async () => {
      if (!select.value) return;
      publish.disabled = true;
      try { await api(`/api/outbound/email/templates/${encodeURIComponent(select.value)}/publish`, { method: "POST", body: JSON.stringify({ business_id: business.id, make_default: true }) }); if (selectedBusiness()?.id !== business.id || templateLoadRevision !== loadRevision) return; setStatus("Template published and saved as this business’s default."); await loadTemplates(); }
      catch (error) { if (selectedBusiness()?.id === business.id && templateLoadRevision === loadRevision) status.textContent = error.message; } finally { if (controls.contains(publish)) publish.disabled = false; }
    };
    form.append(selectLabel, invoiceLabel, preview, retrieve, publish, linkStatus); controls.append(form);
    const editor = el("details", null, "template-editor"); editor.append(el("summary", "Create a draft version"));
    const draft = el("div", null, "template-form");
    const content = templateState.find((template) => template.id === select.value)?.content || response.starter || {};
    draft.append(templateField("Template name", "template-draft-name", content.name || "Pinnacle invoice follow-up"), templateField("Subject", "template-draft-subject", content.subject || ""), templateField("Preheader", "template-draft-preheader", content.preheader || ""), templateField("Introduction", "template-draft-introduction", content.introduction || "", true), templateField("Closing", "template-draft-closing", content.closing || "", true));
    const save = el("button", "Save new draft");
    save.onclick = async () => {
      save.disabled = true;
      const values = Object.fromEntries(["name", "subject", "preheader", "introduction", "closing"].map((key) => [key, document.getElementById(`template-draft-${key}`).value.trim()]));
      try { await api("/api/outbound/email/templates", { method: "POST", body: JSON.stringify({ business_id: business.id, content: values }) }); if (selectedBusiness()?.id !== business.id || templateLoadRevision !== loadRevision) return; setStatus("New draft saved. Preview it before publishing."); await loadTemplates(); }
      catch (error) { if (selectedBusiness()?.id === business.id && templateLoadRevision === loadRevision) status.textContent = error.message; } finally { if (controls.contains(save)) save.disabled = false; }
    };
    draft.append(save); editor.append(draft); controls.append(editor);
    status.textContent = templateState.length ? `${templateState.length} stored template version(s). A preview does not send an email.` : "No stored templates yet. Create a draft to begin.";
    status.className = "setup-summary";
    select.onchange = () => { selectionRevision++; emailPreviewRevision++; document.getElementById("template-preview").replaceChildren(); const template = templateState.find((item) => item.id === select.value); for (const key of ["name", "subject", "preheader", "introduction", "closing"]) document.getElementById(`template-draft-${key}`).value = template?.content?.[key] || ""; };
    invoiceSelect.onchange = () => { selectionRevision++; emailPreviewRevision++; document.getElementById("template-preview").replaceChildren(); linkStatus.textContent = "QuickBooks only. Reads the existing invoice; no email is sent."; updateRetrieval(); };
  } catch (error) { if (selectedBusiness()?.id !== business.id || templateLoadRevision !== loadRevision) return; controls.replaceChildren(); status.textContent = `Template service unavailable: ${error.message}`; status.className = "setup-summary warning"; }
}

async function previewEmailTemplate() {
  const business = selectedBusiness();
  const templateId = document.getElementById("email-template-select")?.value;
  const invoiceId = document.getElementById("email-preview-invoice")?.value;
  if (!business || !templateId || !invoiceId) return;
  const revision = ++emailPreviewRevision;
  const current = () => emailPreviewRevision === revision && selectedBusiness()?.id === business.id && document.getElementById("email-template-select")?.value === templateId && document.getElementById("email-preview-invoice")?.value === invoiceId;
  const output = document.getElementById("template-preview");
  output.replaceChildren(el("p", "Rendering the selected invoice with stored template values…"));
  try {
    const preview = await api(`/api/outbound/email/preview?${new URLSearchParams({ business_id: business.id, invoice_id: invoiceId, template_id: templateId })}`);
    if (!current()) return;
    output.replaceChildren();
    describeFields(output, [["Recipient", preview.recipient], ["From", preview.from], ["Reply to", preview.reply_to], ["Payment provider", preview.payment_provider], ["Payment link", preview.payment_link_available ? "Verified link available" : "Unavailable · manual review"], ["Template version", preview.template_version]]);
    output.append(el("h3", preview.subject), el("p", preview.preheader));
    output.append(el("div", preview.send_ready ? "Preview ready. Opening this preview does not send an email." : `Sending blocked: ${(preview.block_reasons || []).map(humanize).join(" · ") || "Review sender, recipient and payment link"}. Opening this preview does not send an email.`, `setup-summary ${preview.send_ready ? "ready" : "warning"}`));
    const frame = el("iframe"); frame.className = "template-preview-frame"; frame.title = "Email template preview"; frame.setAttribute("sandbox", ""); frame.setAttribute("referrerpolicy", "no-referrer"); frame.srcdoc = preview.html; output.append(frame);
    output.append(details("Plain-text version", preview.text));
  } catch (error) { if (!current()) return; output.replaceChildren(el("div", `Preview failed: ${error.message}`, "setup-summary error")); }
}

async function loadSourceQueue() {
  const business = selectedBusiness();
  if (!business) return;
  const revision = businessSelectionRevision;
  const content = document.getElementById("source-queue-content");
  const count = document.getElementById("source-queue-count");
  try {
    const queue = await api(`/api/outbound/integrations/quickbooks/queue?business_id=${encodeURIComponent(business.id)}`);
    if (selectedBusiness()?.id !== business.id || businessSelectionRevision !== revision) return;
    const invoices = queue.invoices || [];
    count.textContent = `${queue.summary?.eligible_count ?? 0} pass source checks · ${queue.summary?.invoice_count ?? invoices.length} source records`;
    content.replaceChildren();
    if (!invoices.length) { content.className = "empty-state"; content.textContent = "No QuickBooks source records are stored for this business. Review the company connection and import preview in Connections & sync."; return; }
    content.className = "";
    const wrap = el("div", null, "table-wrap"); const table = el("table", null, "compact-table");
    const head = el("thead"); const heading = el("tr");
    ["Account / invoice", "Balance / dates", "Contact", "Source checks", "Next action"].forEach(label => heading.append(el("th", label)));
    head.append(heading); const body = el("tbody");
    invoices.forEach(invoice => {
      const row = el("tr"); const cells = Array.from({ length: 5 }, () => el("td"));
      cells[0].append(el("strong", invoice.customer_account || "Account not mapped"), el("span", invoice.invoice_id, "subtext"), el("span", `QuickBooks · ${invoice.source_realm_id}`, "subtext"));
      cells[1].append(el("strong", formatMoney(invoice.source_balance_cents, invoice.currency)), el("span", `Original ${formatMoney(invoice.original_total_cents, invoice.currency)}`, "subtext"), el("span", `Due ${formatDate(invoice.original_due_date)} · ${invoice.days_overdue ?? "Unknown"} days overdue`, "subtext"), el("span", `Invoice ${formatDate(invoice.invoice_date)} · inspection ${formatDate(invoice.inspection_date)}`, "subtext"));
      cells[2].append(el("span", invoice.email || "No email"), el("span", invoice.phone_number || "No phone", "subtext"));
      cells[3].append(badge(invoice.eligible ? "Source checks pass" : "Needs review", invoice.eligible ? "success" : "warning"), el("span", (invoice.block_reasons || []).map(humanize).join(" · ") || "Fresh call preflight required", "subtext"), el("span", `Verified ${formatDate(invoice.source_verified_at)}`, "subtext"), el("span", invoice.payment_link_available ? "Payment link available" : "Payment link needs manual review", "subtext"));
      cells[4].append(el("span", humanize(invoice.next_action || "manual_review")), el("span", `Last contact ${formatDate(invoice.last_contact)}`, "subtext"), el("span", invoice.promised_payment_date ? `Expected payment ${formatDate(invoice.promised_payment_date)}` : "No payment date recorded", "subtext"));
      row.append(...cells); body.append(row);
    });
    table.append(head, body); wrap.append(table); content.append(wrap);
    if (queue.customers?.length) {
      const summary = el("details"); summary.append(el("summary", "Customer totals · separated by currency"));
      queue.customers.forEach(customer => summary.append(el("p", `${customer.customer_account} · ${customer.invoice_count} invoice(s) · ${formatMoney(customer.remaining_balance_minor, customer.currency)} remaining · ${formatMoney(customer.overdue_balance_minor, customer.currency)} overdue`)));
      content.append(summary);
    }
  } catch (error) { if (selectedBusiness()?.id !== business.id || businessSelectionRevision !== revision) return; count.textContent = "Source review unavailable"; content.className = "setup-summary warning"; content.textContent = `No source readiness can be confirmed. ${error.message}`; }
}

async function loadSmsReadiness() {
  const business = selectedBusiness(); if (!business) return;
  const revision = businessSelectionRevision;
  const output = document.getElementById("sms-readiness-detail");
  try {
    const readiness = await api(`/api/outbound/sms/readiness?business_id=${encodeURIComponent(business.id)}`);
    if (selectedBusiness()?.id !== business.id || businessSelectionRevision !== revision) return;
    output.replaceChildren();
    describeFields(output, [["Campaign observation", `${humanize(readiness.campaign?.status)} · ${readiness.campaign?.observed_on || "date unavailable"}`], ["Collections number", readiness.campaign?.phone_number], ["Sending", "Disabled · requires explicit activation"], ["Consent evidence records", readiness.consent_record_count ?? "Storage unavailable"], ["Suppressed recipients", readiness.suppression_count ?? "Storage unavailable"], ["Provider events", readiness.provider_webhook_connected ? "Connected" : "Not connected · no live event verification"]]);
    if (readiness.campaign?.rejection_reason) output.append(el("div", `Retell rejection: ${readiness.campaign.rejection_reason}`, "setup-summary error"));
    output.append(el("p", readiness.consent_rule));
    const checklist = el("ul", null, "check-list"); (readiness.activation_checklist || []).forEach(item => checklist.append(el("li", item))); output.append(checklist);
    output.append(details("Prepared SMS templates · no messages sent", Object.entries(readiness.templates || {}).map(([name, value]) => `${humanize(name)}: ${value}`).join("\n\n")));
  } catch (error) { if (selectedBusiness()?.id !== business.id || businessSelectionRevision !== revision) return; output.textContent = `Sending is disabled. Readiness could not be verified: ${error.message}`; }
}

function initializeWorkspace() {
  document.body.classList.toggle("embedded-workspace", new URLSearchParams(location.search).get("embedded") === "1");
  document.querySelectorAll("[data-workspace-link]").forEach((button) => { button.onclick = () => setWorkspace(button.dataset.workspaceLink); });
  setWorkspace(location.hash.slice(1), false);
  window.addEventListener("hashchange", () => setWorkspace(location.hash.slice(1), false));
  document.getElementById("source-refresh").onclick = async () => { await loadSourceStatus(); await loadSourceQueue(); await loadWeeklyReviewStatus(); };
  document.getElementById("template-refresh").onclick = loadTemplates;
  setInterval(() => {
    if (activeDemoAuthorization && demoAuthorizationExpired()) {
      activeDemoPreflight = null;
      document.getElementById("demo-start-call").disabled = true;
      document.getElementById("demo-preflight").disabled = true;
      document.getElementById("demo-auth-status").textContent = "Demo number authorization expired";
    }
  }, 10000);
  document.querySelectorAll(".demo-editor input, .demo-editor select, .demo-editor textarea").forEach((input) => input.addEventListener("input", () => { invalidateCallGates(); setDemoFeedback("Unsaved demo changes. Save the details, then run the backend preflight again.", [{ label: "Unsaved", tone: "warning" }]); }));
}

initializeWorkspace();
refreshAll();
