const statuses = ["unpaid", "payment_link_sent", "paid", "disputed", "manual_review", "cancelled"];
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const pageStatus = document.getElementById("page-status");
const importResult = document.getElementById("import-result");
const commitImportButton = document.getElementById("commit-import");
const batchDryRunButton = document.getElementById("batch-dry-run");
const selectedCallStatus = document.getElementById("selected-call-status");
let validatedCsvText = "";

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
  const list = document.getElementById(id);
  list.replaceChildren(...items.map((item) => checklistItem(item.label, item.ok, item.detail)));
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
    summary.className = "setup-summary";
    const setup = await api("/api/outbound/setup/status");
    summary.textContent = setup.ready_for_single_test_call
      ? "Server setup is ready for one gated test call. A selected customer must still pass call preflight."
      : "Setup is incomplete. Review the items marked “Needs setup” before attempting a call.";
    summary.className = `setup-summary ${setup.ready_for_single_test_call ? "ready" : "warning"}`;

    renderChecklist("setup-app", [
      {
        label: "APP_BASE_URL configured",
        ok: setup.app.app_base_url_configured,
        detail: setup.app.configured_base_url || "Missing",
      },
      { label: "Detected base URL", ok: true, detail: setup.app.detected_base_url },
      { label: "Configured URL matches request", ok: setup.app.base_url_matches_request },
      { label: "Runtime", ok: true, detail: setup.app.runtime },
      { label: "/health route", ok: setup.app.health.ok, detail: setup.app.health.url },
      { label: "Admin authentication", ok: setup.app.admin_auth.authenticated },
    ]);

    const tableItems = Object.entries(setup.supabase.tables).map(([name, ready]) => ({
      label: name,
      ok: ready,
    }));
    renderChecklist("setup-supabase", [
      { label: "SUPABASE_URL present", ok: setup.supabase.url_configured },
      { label: "Service role present server-side", ok: setup.supabase.service_role_configured },
      ...tableItems,
      { label: "outbound_mark_invoice_paid detected", ok: setup.supabase.paid_rpc_detected },
    ]);

    renderChecklist("setup-stripe", [
      { label: "Stripe secret key present server-side", ok: setup.stripe.secret_key_configured },
      { label: "Stripe webhook secret present server-side", ok: setup.stripe.webhook_secret_configured },
      {
        label: "Latest payment event",
        ok: true,
        detail: setup.stripe.latest_payment_event
          ? `${setup.stripe.latest_payment_event.event_type} at ${new Date(setup.stripe.latest_payment_event.created_at).toLocaleString()}`
          : "None recorded",
      },
    ]);

    renderChecklist("setup-retell", [
      { label: "Retell API key present server-side", ok: setup.retell.api_key_configured },
      {
        label: "Outbound from number",
        ok: setup.retell.from_number_correct,
        detail: setup.retell.from_number,
      },
      { label: "Outbound agent ID present", ok: setup.retell.outbound_agent_configured },
      { label: "Outbound Conversation Flow ID present", ok: setup.retell.outbound_flow_configured },
      { label: "Retell webhook secret present", ok: setup.retell.webhook_secret_configured },
      {
        label: "SMS mode",
        ok: true,
        detail: setup.retell.sms_mode === "disabled_manual" ? "Disabled/manual" : "Enabled; verify provider setup",
      },
      {
        label: "Latest Retell event",
        ok: true,
        detail: setup.retell.latest_event
          ? `${setup.retell.latest_event.event_type} at ${new Date(setup.retell.latest_event.created_at).toLocaleString()}`
          : "None recorded",
      },
    ]);

    renderChecklist("setup-safety", [
      { label: "Test mode enabled", ok: setup.call_safety.test_mode },
      {
        label: "Test phone allowlist",
        ok: setup.call_safety.allowlist_configured,
        detail: `${setup.call_safety.allowlist_count} number(s) configured`,
      },
      {
        label: "Maximum batch size",
        ok: setup.call_safety.max_batch_size > 0,
        detail: String(setup.call_safety.max_batch_size),
      },
      { label: "Calling window", ok: true, detail: setup.call_safety.calling_window },
      { label: "Real batch hidden from this UI", ok: !setup.call_safety.real_batch_available_in_ui },
    ]);

    const endpoints = document.getElementById("setup-endpoints");
    endpoints.replaceChildren();
    addEndpoint(endpoints, "Stripe webhook", setup.stripe.webhook_url);
    addEndpoint(endpoints, "Retell webhook", setup.retell.webhook_url);
    setup.retell.function_urls.forEach((url) => addEndpoint(endpoints, "Retell function", url));

    if (setup.supabase.migration_warning) {
      setStatus(setup.supabase.migration_warning, true);
    }
  } catch (error) {
    summary.textContent = error.message;
    summary.className = "setup-summary error";
  }
}

function setGateState(row, result) {
  const gate = row.querySelector('[data-field="gate"]');
  const callButton = row.querySelector('[data-action="call"]');
  gate.textContent = result.eligible
    ? `Eligible now · ${result.recipient_local_time}`
    : `${result.reason.replaceAll("_", " ")} · ${result.recipient_local_time}`;
  gate.className = `gate-status ${result.eligible ? "ready" : "blocked"}`;
  callButton.disabled = !result.eligible;
  selectedCallStatus.textContent = result.eligible
    ? `Selected call is eligible in ${result.timezone}. The server will recheck every gate when the call starts.`
    : `Selected call is blocked: ${result.reason.replaceAll("_", " ")}. Window: ${result.calling_window}.`;
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
      body: JSON.stringify({ invoice_id: invoice.id }),
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

function renderInvoice(invoice) {
  const row = document.getElementById("invoice-row-template").content.firstElementChild.cloneNode(true);
  const customer = invoice.outbound_customers || {};
  const calls = invoice.outbound_call_attempts || [];
  const paymentLinks = invoice.outbound_payment_links || [];
  const tasks = (invoice.outbound_followup_tasks || []).filter((task) => task.status === "pending");
  const lastCall = latest(calls);
  const nextTask = [...tasks].sort((a, b) => String(a.scheduled_for).localeCompare(String(b.scheduled_for)))[0];
  const phone = row.querySelector('[data-action="phone"]');
  const callButton = row.querySelector('[data-action="call"]');
  const batchSelect = row.querySelector('[data-action="batch-select"]');

  batchSelect.value = invoice.id;
  batchSelect.setAttribute("aria-label", `Select invoice ${invoice.invoice_id} for batch dry run`);
  batchSelect.onchange = updateBatchButton;
  row.querySelector('[data-field="customer"]').textContent =
    `${customer.first_name || ""} ${customer.last_name || ""}`.trim();
  phone.value = customer.phone_number || "";
  phone.oninput = () => {
    callButton.disabled = true;
    const gate = row.querySelector('[data-field="gate"]');
    gate.textContent = "Save phone, then recheck";
    gate.className = "gate-status";
  };
  row.querySelector('[data-field="timezone"]').textContent = customer.timezone || "America/New_York";
  row.querySelector('[data-field="invoice"]').textContent = invoice.invoice_id;
  row.querySelector('[data-field="amount"]').textContent = money.format(invoice.amount_due_cents / 100);
  row.querySelector('[data-field="payment"]').textContent =
    invoice.status === "paid" ? "Paid" : latest(paymentLinks)?.status || "No session";
  row.querySelector('[data-field="last-call"]').textContent = lastCall
    ? `${lastCall.status}: ${lastCall.outcome || "pending"}`
    : "None";
  row.querySelector('[data-field="next-followup"]').textContent = nextTask
    ? new Date(nextTask.scheduled_for).toLocaleString()
    : "None";
  row.querySelector('[data-field="paused"]').textContent = customer.outreach_paused ? "Paused" : "Active";
  const statusSelect = row.querySelector('[data-action="status"]');
  statuses.forEach((status) =>
    statusSelect.add(new Option(status.replaceAll("_", " "), status, false, status === invoice.status)),
  );
  const notes = row.querySelector('[data-action="notes"]');
  notes.value = invoice.notes || customer.notes || "";

  row.querySelector('[data-action="save"]').onclick = async () => {
    try {
      await api(`/api/outbound/customers/${customer.id}`, {
        method: "PATCH",
        body: JSON.stringify({ phone_number: phone.value.trim() }),
      });
      await api(`/api/outbound/invoices/${invoice.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: statusSelect.value, notes: notes.value }),
      });
      setStatus(`Saved customer and invoice ${invoice.invoice_id}.`);
      await load();
    } catch (error) {
      setStatus(error.message, true);
    }
  };
  row.querySelector('[data-action="payment"]').onclick = async () => {
    try {
      const result = await api(`/api/outbound/invoices/${invoice.id}/create-checkout-session`, {
        method: "POST",
        body: "{}",
      });
      window.open(result.payment_link.url, "_blank", "noopener,noreferrer");
      setStatus(
        result.reused ? "Reused the active Checkout Session." : "Created an exact-amount Checkout Session.",
      );
      await loadSetupStatus();
    } catch (error) {
      setStatus(error.message, true);
    }
  };
  row.querySelector('[data-action="preflight"]').onclick = () => checkCallGates(invoice, row);
  callButton.onclick = async () => {
    const preflight = await checkCallGates(invoice, row);
    if (!preflight?.eligible) return;
    if (!confirm(`Start one gated test call to ${phone.value.trim()}?`)) return;
    try {
      const result = await api("/api/outbound/calls/start", {
        method: "POST",
        body: JSON.stringify({ invoice_id: invoice.id }),
      });
      setStatus(`Retell call registered: ${result.call_id}`);
      callButton.disabled = true;
      await load();
    } catch (error) {
      setStatus(error.message, true);
    }
  };
  const pauseButton = row.querySelector('[data-action="pause"]');
  pauseButton.textContent = customer.outreach_paused ? "Resume" : "Pause";
  pauseButton.onclick = async () => {
    try {
      await api(`/api/outbound/customers/${customer.id}/${customer.outreach_paused ? "resume" : "pause"}`, {
        method: "POST",
        body: JSON.stringify({ reason: "admin_page" }),
      });
      await load();
    } catch (error) {
      setStatus(error.message, true);
    }
  };
  return row;
}

async function load() {
  try {
    setStatus("Loading invoices...");
    const { invoices } = await api("/api/outbound/invoices");
    const body = document.getElementById("invoice-rows");
    body.replaceChildren(...invoices.map(renderInvoice));
    updateBatchButton();
    setStatus(`${invoices.length} invoice${invoices.length === 1 ? "" : "s"} loaded.`);
  } catch (error) {
    document.getElementById("invoice-rows").replaceChildren();
    updateBatchButton();
    setStatus(error.message, true);
  }
}

async function importCsv(dryRun) {
  const file = document.getElementById("csv-file").files[0];
  if (!file) return setStatus("Choose a CSV file first.", true);
  try {
    const csv = await file.text();
    const result = await api("/api/outbound/customers/import", {
      method: "POST",
      body: JSON.stringify({ csv, dry_run: dryRun }),
    });
    importResult.textContent = dryRun
      ? `${result.result.rows_valid} row(s) validated. Import is now enabled.`
      : `${result.result.customers} customer(s) and ${result.result.invoices} invoice(s) created.`;
    if (dryRun) {
      validatedCsvText = csv;
      commitImportButton.disabled = false;
    } else {
      validatedCsvText = "";
      commitImportButton.disabled = true;
      await Promise.all([load(), loadSetupStatus()]);
    }
  } catch (error) {
    validatedCsvText = "";
    commitImportButton.disabled = true;
    importResult.textContent = "";
    setStatus(error.message, true);
  }
}

document.getElementById("csv-file").onchange = () => {
  validatedCsvText = "";
  commitImportButton.disabled = true;
  importResult.textContent = "Validate the selected file before importing.";
};
document.getElementById("refresh").onclick = load;
document.getElementById("refresh-setup").onclick = loadSetupStatus;
document.getElementById("dry-run-import").onclick = () => importCsv(true);
commitImportButton.onclick = async () => {
  if (!validatedCsvText) return setStatus("Validate the CSV before importing.", true);
  try {
    const result = await api("/api/outbound/customers/import", {
      method: "POST",
      body: JSON.stringify({ csv: validatedCsvText, dry_run: false }),
    });
    importResult.textContent = `${result.result.customers} customer(s) and ${result.result.invoices} invoice(s) created.`;
    validatedCsvText = "";
    commitImportButton.disabled = true;
    await Promise.all([load(), loadSetupStatus()]);
  } catch (error) {
    setStatus(error.message, true);
  }
};
batchDryRunButton.onclick = async () => {
  const invoiceIds = [...document.querySelectorAll('[data-action="batch-select"]:checked')].map(
    (input) => input.value,
  );
  if (!invoiceIds.length) return;
  try {
    const result = await api("/api/outbound/calls/start-batch", {
      method: "POST",
      body: JSON.stringify({ mode: "dry_run", invoice_ids: invoiceIds }),
    });
    const eligible = result.results.filter((item) => item.eligible).length;
    const blocked = result.results.length - eligible;
    setStatus(`Batch dry run complete: ${eligible} eligible, ${blocked} blocked, 0 calls placed.`);
  } catch (error) {
    setStatus(error.message, true);
  }
};
document.getElementById("logout").onclick = async () => {
  await api("/api/outbound/auth/logout", { method: "POST", body: "{}" });
  location.reload();
};

Promise.all([loadSetupStatus(), load()]);
