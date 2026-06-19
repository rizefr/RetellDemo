const statuses = ["unpaid", "payment_link_sent", "paid", "disputed", "manual_review", "cancelled"];
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const AFTER_HOURS_CONFIRMATION = "I UNDERSTAND THIS IS AN AFTER-HOURS TEST";
const pageStatus = document.getElementById("page-status");
const importResult = document.getElementById("import-result");
const commitImportButton = document.getElementById("commit-import");
const batchDryRunButton = document.getElementById("batch-dry-run");
const selectedCallStatus = document.getElementById("selected-call-status");
let validatedCsvText = "";
let dashboardState = { invoices: [], calls: [], payment_links: [], events: [] };
let setupState = null;
let activeCallPoll = null;

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
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Unknown" : date.toLocaleString();
}

function humanize(value) {
  return String(value || "unknown").replaceAll("_", " ");
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
    : `${humanize(result.after_hours_override_block_reason || result.reason)} · ${formatDate(result.recipient_local_time)}`;
  gate.className = `gate-status ${result.eligible ? "ready" : "blocked"}`;
  callButton.disabled = !result.eligible;
  selectedCallStatus.textContent = result.eligible
    ? `Selected call is eligible in ${result.timezone}${overrideLabel}. The server will recheck every gate when starting.`
    : `Selected call is blocked: ${humanize(result.after_hours_override_block_reason || result.reason)}. Window: ${result.calling_window}.`;
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

  batchSelect.value = invoice.id;
  batchSelect.setAttribute("aria-label", `Select invoice ${invoice.invoice_id} for batch dry run`);
  batchSelect.onchange = updateBatchButton;
  row.querySelector('[data-field="customer"]').textContent = `${customer.first_name || ""} ${customer.last_name || ""}`.trim();
  row.querySelector('[data-field="business"]').textContent = business.business_name || "";
  phone.value = customer.phone_number || "";
  email.value = customer.email || "";
  for (const input of [phone, email]) input.oninput = () => { callButton.disabled = true; row.querySelector('[data-field="gate"]').textContent = "Save changes, then recheck"; };
  row.querySelector('[data-field="invoice"]').textContent = invoice.invoice_id;
  row.querySelector('[data-field="ids"]').textContent = `customer ${customer.id}\ninvoice ${invoice.id}\nbusiness ${business.id}`;
  row.querySelector('[data-field="service"]').textContent = invoice.service_description;
  row.querySelector('[data-field="amount"]').textContent = money.format(invoice.amount_due_cents / 100);
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

document.getElementById("csv-file").onchange = () => { validatedCsvText = ""; commitImportButton.disabled = true; importResult.textContent = "Validate the selected file before importing."; };
document.getElementById("refresh-all").onclick = refreshAll;
document.getElementById("refresh-setup").onclick = loadSetupStatus;
document.getElementById("invoice-filter").onchange = renderInvoices;
document.getElementById("invoice-search").oninput = renderInvoices;
document.getElementById("event-filter").onchange = renderEvents;
document.getElementById("after-hours-ack").onchange = invalidateCallGates;
document.getElementById("after-hours-confirmation").oninput = invalidateCallGates;
document.getElementById("dry-run-import").onclick = () => importCsv(true);
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
