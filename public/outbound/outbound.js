const statuses = ["unpaid", "payment_link_sent", "paid", "disputed", "manual_review", "cancelled"];
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
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

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
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
  single_prompt_agent_not_configured: "The Single Prompt comparison agent is not configured yet.",
  retell_from_number_missing: "Retell from number is missing.",
  email_not_ready: "Email is not ready.",
  sms_disabled: "SMS is disabled/manual.",
  quickbooks_not_connected: "QuickBooks is not connected; Stripe remains the ready provider.",
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
      { label: "Single Prompt comparison agent", ok: setup.retell.single_prompt_agent_configured, detail: setup.retell.single_prompt_agent_configured ? "Configured" : "Not configured" },
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
    const singlePromptOption = document.querySelector('#demo-agent-variant option[value="single_prompt"]');
    singlePromptOption.disabled = !setup.retell.single_prompt_agent_configured;
    if (!setup.retell.single_prompt_agent_configured && document.getElementById("demo-agent-variant").value === "single_prompt") {
      document.getElementById("demo-agent-variant").value = "conversation_flow";
    }
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

async function renderSettings() {
  const select = document.getElementById("settings-business");
  const previous = select.value;
  select.replaceChildren(...(dashboardState.businesses || []).map((business) => new Option(business.business_name, business.id)));
  if (previous && [...select.options].some((option) => option.value === previous)) select.value = previous;
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
  try {
    const response = await api(`/api/outbound/businesses/${business.id}/settings`);
    settingsReadiness = response.readiness;
    document.getElementById("settings-readiness").textContent = [
      `Email requested: ${response.readiness.emailRequested ? "yes" : "no"}; provider ready: ${response.readiness.emailProviderReady ? "yes" : "no"}; effective: ${response.readiness.emailEffective ? "enabled" : "disabled/manual"}.`,
      `SMS requested: ${response.readiness.smsRequested ? "yes" : "no"}; provider ready: ${response.readiness.smsProviderReady ? "yes" : "no"}; effective: ${response.readiness.smsEffective ? "enabled" : "disabled/manual"}.`,
      "Secret values remain in Vercel. A sender change must match the verified server-side sender.",
    ].join(" ");
  } catch (error) {
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
  return (dashboardState.invoices || []).find((invoice) => invoice.id === id) || (dashboardState.invoices || [])[0] || null;
}

function populateDemoEditor(invoice) {
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
  activeDemoPreflight = null;
  document.getElementById("demo-start-call").disabled = true;
}

async function renderPresentationPanel() {
  const select = document.getElementById("demo-invoice-select");
  const previous = select.value;
  select.replaceChildren(...(dashboardState.invoices || []).map((invoice) => {
    const customer = invoice.outbound_customers || {};
    return new Option(`${customer.first_name || ""} ${customer.last_name || ""} · ${invoice.invoice_id || "invoice"}`, invoice.id);
  }));
  if (previous && [...select.options].some((option) => option.value === previous)) select.value = previous;
  populateDemoEditor(selectedDemoInvoice());
  const business = selectedBusiness();
  if (!business) return;
  try {
    const qb = await api(`/api/outbound/quickbooks/status?business_id=${encodeURIComponent(business.id)}`);
    document.getElementById("quickbooks-status").textContent = `Payment provider: ${humanize(qb.provider)}. QuickBooks: ${qb.connected ? "connected" : "not connected"}; OAuth configured: ${qb.configured ? "yes" : "no"}; environment: ${qb.environment}. Stripe remains default unless changed.`;
  } catch (error) {
    document.getElementById("quickbooks-status").textContent = `QuickBooks status unavailable: ${error.message}`;
  }
}

async function authorizeDemoNumber() {
  const business = selectedBusiness();
  if (!business) return setStatus("Select a business before authorizing a demo number.", true);
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
  try {
    const result = await api("/api/outbound/demo-call/authorize-number", {
      method: "POST",
      body: JSON.stringify({
        business_id: business.id,
        phone_number: document.getElementById("demo-phone-number").value.trim(),
        demo_call_mode: document.getElementById("demo-call-mode").value,
        scenario: document.getElementById("demo-call-mode").value,
        ttl_minutes: Number(document.getElementById("demo-ttl-minutes").value || 240),
        acknowledged: true,
        confirmation,
      }),
    });
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
    agent_variant: document.getElementById("demo-agent-variant").value,
    after_hours_override: afterHoursOverridePayload(),
  };
}

async function demoPreflight() {
  try {
    activeDemoPreflight = await api("/api/outbound/demo-call/preflight", {
      method: "POST",
      body: JSON.stringify(demoRunPayload()),
    });
    document.getElementById("demo-start-call").disabled = !activeDemoPreflight.eligible;
    const reason = activeDemoPreflight.after_hours_override_block_reason || activeDemoPreflight.reason;
    const message = activeDemoPreflight.eligible
      ? `Preflight passed for ${activeDemoPreflight.destination_phone_number} using ${activeDemoPreflight.agent_label}. The Start button will still use the real backend single-call endpoint.`
      : friendlyReason(reason);
    const badges = activeDemoPreflight.eligible
      ? [
          { label: "Ready", tone: "ready" },
          { label: "Demo number authorized", tone: "ready" },
          {
            label: activeDemoPreflight.agent_variant === "single_prompt" ? "Single Prompt" : "Conversation Flow",
            tone: "info",
          },
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
  const statusMatches = filter === "all" || invoice.status === filter || (filter === "paused" && customer.outreach_paused);
  const searchText = `${customer.first_name || ""} ${customer.last_name || ""} ${invoice.invoice_id || ""} ${invoice.service_description || ""}`.toLowerCase();
  return statusMatches && (!query || searchText.includes(query));
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
  const accountInvoices = (dashboardState.invoices || []).filter((item) => item.customer_id === invoice.customer_id);
  const openAccountInvoices = accountInvoices.filter((item) => ["unpaid", "payment_link_sent"].includes(item.status));
  const accountTotal = openAccountInvoices.reduce((sum, item) => sum + Number(item.amount_due_cents || 0), 0);
  const lastPaid = accountInvoices.filter((item) => item.status === "paid" && item.paid_at).sort((a, b) => String(b.paid_at).localeCompare(String(a.paid_at)))[0];

  batchSelect.value = invoice.id;
  batchSelect.setAttribute("aria-label", `Select invoice ${invoice.invoice_id} for batch dry run`);
  batchSelect.onchange = updateBatchButton;
  row.querySelector('[data-field="customer"]').textContent = `${customer.first_name || ""} ${customer.last_name || ""}`.trim();
  row.querySelector('[data-field="business"]').textContent = business.business_name || "";
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
  row.querySelector('[data-field="ids"]').textContent = `customer ${customer.id}\ninvoice ${invoice.id}\nbusiness ${business.id}`;
  row.querySelector('[data-field="service"]').textContent = `${invoice.service_description} · due ${formatDate(invoice.original_due_date)}`;
  row.querySelector('[data-field="amount"]').textContent = money.format(invoice.amount_due_cents / 100);
  row.querySelector('[data-field="amount"]').title = `Account: ${openAccountInvoices.length} open invoice(s), ${money.format(accountTotal / 100)} total due. Last payment: ${lastPaid ? formatDate(lastPaid.paid_at) : formatDate(customer.imported_last_payment_date)}.`;
  row.querySelector('[data-field="payment"]').textContent = invoice.status === "paid" ? "Payment: paid" : `Payment: ${latest(paymentLinks)?.status || "no session"}`;
  row.querySelector('[data-field="last-call"]').textContent = lastCall ? `${humanize(lastCall.outcome || lastCall.status)}${lastCall.summary ? ` · ${lastCall.summary}` : ""}` : "No calls";
  row.querySelector('[data-field="next-followup"]').textContent = `Next: ${nextTask ? formatDate(nextTask.scheduled_for) : "none"}`;
  row.querySelector('[data-field="paused"]').textContent = customer.outreach_paused ? "Outreach paused" : "Outreach active";
  const statusSelect = row.querySelector('[data-action="status"]');
  statuses.forEach((status) => statusSelect.add(new Option(humanize(status), status, false, status === invoice.status)));
  const notes = row.querySelector('[data-action="notes"]');
  notes.value = invoice.notes || customer.notes || "";

  row.querySelector('[data-action="save"]').onclick = async () => {
    try {
      await api(`/api/outbound/customers/${customer.id}`, { method: "PATCH", body: JSON.stringify({ phone_number: phone.value.trim(), email: email.value.trim() }) });
      await api(`/api/outbound/invoices/${invoice.id}`, { method: "PATCH", body: JSON.stringify({ status: statusSelect.value, notes: notes.value }) });
      setStatus(`Saved customer and invoice ${invoice.invoice_id}.`);
      await refreshAll();
    } catch (error) { setStatus(error.message, true); }
  };
  row.querySelector('[data-action="payment"]').onclick = async () => {
    try {
      const result = await api(`/api/outbound/invoices/${invoice.id}/create-checkout-session`, { method: "POST", body: "{}" });
      window.open(result.payment_link.url, "_blank", "noopener,noreferrer");
      setStatus(result.reused ? "Reused the active Checkout Session." : "Created an exact-amount Checkout Session.");
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
  const invoices = dashboardState.invoices.filter(invoiceMatches);
  document.getElementById("invoice-rows").replaceChildren(...invoices.map(renderInvoice));
  document.getElementById("invoice-empty").hidden = invoices.length > 0;
  updateBatchButton();
}

function renderCallbacks() {
  const tasks = (dashboardState.followups || []).filter((task) => task.task_type === "callback");
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
  const calls = dashboardState.calls || [];
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
  const links = dashboardState.payment_links || [];
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
    cells[2].textContent = money.format(link.amount_cents / 100);
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
  const events = (dashboardState.events || []).filter((event) => filter === "all" || event.source === filter);
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
    renderInvoices();
    await renderSettings();
    await renderPresentationPanel();
    renderCallbacks();
    renderCalls();
    renderPayments();
    renderEvents();
    document.getElementById("last-refreshed").textContent = `Last refreshed ${formatDate(dashboardState.refreshed_at)}`;
    configureActiveCallPolling();
    if (!silent) setStatus(`${dashboardState.invoices.length} invoices, ${dashboardState.calls.length} calls, and ${dashboardState.payment_links.length} payment links loaded.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function refreshAll() {
  await Promise.all([loadSetupStatus(), loadDashboard()]);
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
document.getElementById("settings-business").onchange = renderSettings;
document.getElementById("save-settings").onclick = saveSettings;
document.getElementById("demo-invoice-select").onchange = () => populateDemoEditor(selectedDemoInvoice());
document.getElementById("demo-call-mode").onchange = () => { activeDemoPreflight = null; document.getElementById("demo-start-call").disabled = true; };
document.getElementById("demo-agent-variant").onchange = () => { activeDemoPreflight = null; document.getElementById("demo-start-call").disabled = true; };
document.getElementById("demo-authorize-number").onclick = authorizeDemoNumber;
document.getElementById("demo-save-details").onclick = saveDemoDetails;
document.getElementById("demo-preflight").onclick = demoPreflight;
document.getElementById("demo-start-call").onclick = startDemoCall;
document.getElementById("invoice-filter").onchange = renderInvoices;
document.getElementById("invoice-search").oninput = renderInvoices;
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

refreshAll();
