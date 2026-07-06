const views = {
  overview: document.querySelector("#view-overview"),
  outbound: document.querySelector("#view-outbound"),
  inbound: document.querySelector("#view-inbound"),
  settings: document.querySelector("#view-settings"),
  docs: document.querySelector("#view-docs"),
};
const titles = {
  overview: "Overview",
  outbound: "Outbound Collections",
  inbound: "Inbound Receptionist",
  settings: "Settings / Setup",
  docs: "Docs / Runbooks",
};

let latestStatus = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function text(value, fallback = "Not set") {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

function formatTime(value) {
  if (!value) return "None recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function pill(state, label = state) {
  return `<span class="pill ${escapeHtml(state || "neutral")}">${escapeHtml(label || "unknown")}</span>`;
}

function metric(label, value, detail = "", state = "neutral") {
  return `
    <article class="metric-card">
      <div>${pill(state)}</div>
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(value)}</span>
      ${detail ? `<span>${escapeHtml(detail)}</span>` : ""}
    </article>
  `;
}

function statusRow(label, value, state = "neutral") {
  return `
    <div class="status-row">
      <div>${pill(state)}</div>
      <div><strong>${escapeHtml(label)}</strong><br /><span>${escapeHtml(value)}</span></div>
    </div>
  `;
}

function endpointRow(label, value) {
  return `
    <div class="endpoint-row">
      <strong>${escapeHtml(label)}</strong>
      <code>${escapeHtml(value)}</code>
    </div>
  `;
}

function checkRow(item) {
  return `
    <div class="check-row">
      ${pill(item.pass ? "ready" : "warning", item.pass ? "pass" : "fail")}
      <div><strong>${escapeHtml(item.label)}</strong><br /><span>${escapeHtml(item.detail || "")}</span></div>
    </div>
  `;
}

function cell(value) {
  return `<td>${escapeHtml(text(value, ""))}</td>`;
}

function setView(id) {
  Object.entries(views).forEach(([viewId, node]) => node.classList.toggle("active", viewId === id));
  document.querySelectorAll("[data-view-button]").forEach((button) => {
    button.classList.toggle("active", button.dataset.viewButton === id);
  });
  document.querySelector("#view-title").textContent = titles[id] || "Backend";
  if (id === "outbound") {
    const frame = document.querySelector("#outbound-frame");
    if (!frame.src) frame.src = frame.dataset.src;
  }
  history.replaceState(null, "", `#${id}`);
}

function renderOverview(status) {
  const outbound = status.overview.outbound;
  const inbound = status.overview.inbound;
  document.querySelector("#environment-badge").textContent = status.app.runtime;
  document.querySelector("#environment-badge").className = `status-badge ${status.app.runtime === "production" ? "ready" : "neutral"}`;
  document.querySelector("#last-updated").textContent = `Updated ${formatTime(status.checked_at)}`;
  document.querySelector("#overview-cards").innerHTML = [
    metric("Production / base URL", status.app.base_url, status.app.detected_base_url, "neutral"),
    metric("Outbound status", outbound.message, outbound.error || "", outbound.state),
    metric("Inbound status", inbound.message, inbound.error || "", inbound.state),
    metric("Session", "Authenticated with backend HttpOnly cookie", "Backend uses OUTBOUND_ADMIN_TOKEN.", "ready"),
  ].join("");

  const integrations = status.integrations;
  document.querySelector("#integration-list").innerHTML = [
    statusRow("Retell", `Outbound: ${text(integrations.retell.outbound_ready)}. Inbound: ${text(integrations.retell.inbound_ready)}. SMS: ${integrations.retell.sms_mode}.`, integrations.retell.state),
    statusRow("Supabase", `Outbound tables: ${text(integrations.supabase.outbound_tables_ready)}. Inbound tables: ${text(integrations.supabase.inbound_tables_ready)}.`, integrations.supabase.state),
    statusRow("Stripe", integrations.stripe.configured ? "Configured server-side." : "Missing or incomplete.", integrations.stripe.state),
    statusRow("Email", integrations.email.message, integrations.email.state),
    statusRow("SMS", `Outbound ${integrations.sms.outbound_mode}; inbound normal flow ${integrations.sms.inbound_normal_flow}.`, integrations.sms.state),
    statusRow("QuickBooks", integrations.quickbooks.message, integrations.quickbooks.state),
  ].join("");

  const latestPayment = integrations.stripe.latest_payment_event;
  const latestRetell = status.outbound.data?.retell?.latest_event;
  const latestInboundCall = status.inbound.data?.recent?.calls?.[0];
  const latestLead = status.inbound.data?.recent?.leads?.[0];
  document.querySelector("#activity-list").innerHTML = [
    statusRow("Latest Stripe event", latestPayment ? `${latestPayment.event_type} at ${formatTime(latestPayment.created_at)}` : "None recorded", "neutral"),
    statusRow("Latest outbound Retell event", latestRetell ? `${latestRetell.event_type} at ${formatTime(latestRetell.created_at)}` : "None recorded", "neutral"),
    statusRow("Latest inbound call", latestInboundCall ? `${latestInboundCall.status_label} at ${formatTime(latestInboundCall.created_at)}` : "None recorded", "neutral"),
    statusRow("Latest inbound lead", latestLead ? `${latestLead.caller_name || "Unnamed"} at ${formatTime(latestLead.created_at)}` : "None recorded", "neutral"),
  ].join("");
}

function renderOutbound(status) {
  const data = status.outbound.data;
  if (!status.outbound.available || !data) {
    document.querySelector("#outbound-summary").innerHTML = metric("Outbound unavailable", status.outbound.error || "Status failed.", "", "warning");
    return;
  }
  document.querySelector("#outbound-summary").innerHTML = [
    metric("Setup", data.ready_for_single_test_call ? "Ready for one gated test call" : "Review setup before calls", "", data.ready_for_single_test_call ? "ready" : "warning"),
    metric("Supabase", data.supabase.tables_ready ? "Outbound tables ready" : "Migration/table issue", data.supabase.migration_warning || "", data.supabase.tables_ready ? "ready" : "warning"),
    metric("Stripe", data.stripe.webhook_secret_configured ? "Webhook secret configured" : "Webhook secret missing", data.stripe.webhook_url, data.stripe.webhook_secret_configured ? "ready" : "warning"),
    metric("Call safety", `Test mode ${text(data.call_safety.test_mode)}`, `${data.call_safety.allowlist_count} allowlisted number(s); max batch ${data.call_safety.max_batch_size}`, data.call_safety.test_mode ? "ready" : "warning"),
  ].join("");
}

function renderInbound(status) {
  const data = status.inbound.data;
  if (!status.inbound.available || !data) {
    document.querySelector("#inbound-summary").innerHTML = metric("Inbound unavailable", status.inbound.error || "Status failed.", "", "warning");
    return;
  }
  document.querySelector("#inbound-summary").innerHTML = [
    metric("Agent", data.retell.agent?.agent_id || data.retell.expected_agent_id, `Version ${text(data.retell.agent?.version)}`, data.ready ? "ready" : "warning"),
    metric("Phone", data.retell.phone_number, "No binding changes are made here.", data.retell.phone_binding ? "ready" : "warning"),
    metric("Supabase", `${text(data.supabase.tables.leads.count)} leads`, `${text(data.supabase.tables.call_events.count)} call events`, data.supabase.tables.leads.reachable ? "ready" : "warning"),
    metric("Booking", "Native Cal.com phone booking", "SMS is not offered in normal inbound flow.", "neutral"),
  ].join("");

  document.querySelector("#inbound-checks").innerHTML = data.checks.map(checkRow).join("");
  document.querySelector("#inbound-endpoints").innerHTML = [
    endpointRow("Health", data.endpoints.health),
    endpointRow("Webhook", data.endpoints.webhook),
    ...data.endpoints.custom_tools.map((url) => endpointRow(url.split("/").pop(), url)),
    ...data.endpoints.native_tools.map((tool) => endpointRow(tool.name, `Retell native event_type_id=${tool.event_type_id}`)),
  ].join("");

  const calls = data.recent.calls || [];
  document.querySelector("#inbound-call-debug").textContent = `${calls.length} summarized call${calls.length === 1 ? "" : "s"} shown. ${data.recent.hidden_blank_call_event_count || 0} blank/partial event${(data.recent.hidden_blank_call_event_count || 0) === 1 ? "" : "s"} hidden.`;
  document.querySelector("#inbound-call-rows").innerHTML = calls.length
    ? calls
        .map(
          (call) => `
            <tr>
              ${cell(formatTime(call.created_at))}
              ${cell(call.status_label)}
              ${cell(call.caller_phone)}
              ${cell(call.caller_name)}
              ${cell(call.pest_issue)}
              ${cell(call.property_address)}
              ${cell(call.summary || call.outcome || "Pending analysis")}
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="7">No meaningful inbound call summaries yet.</td></tr>`;

  const leads = data.recent.leads || [];
  document.querySelector("#inbound-lead-rows").innerHTML = leads.length
    ? leads
        .map(
          (lead) => `
            <tr>
              ${cell(formatTime(lead.created_at))}
              ${cell(lead.caller_name)}
              ${cell(lead.caller_phone)}
              ${cell(lead.pest_issue)}
              ${cell(lead.property_address || [lead.property_city, lead.property_zip].filter(Boolean).join(" "))}
              ${cell(lead.preferred_datetime)}
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="6">No inbound leads found yet.</td></tr>`;
}

function renderSettings(status) {
  const routes = status.app.routes;
  document.querySelector("#settings-grid").innerHTML = [
    metric("Backend auth", status.auth.outbound_token_configured ? "OUTBOUND_ADMIN_TOKEN configured" : "Missing OUTBOUND_ADMIN_TOKEN", status.auth.cookie, status.auth.outbound_token_configured ? "ready" : "warning"),
    metric("Legacy inbound auth", status.auth.inbound_token_configured ? "INBOUND_ADMIN_TOKEN configured" : "Missing INBOUND_ADMIN_TOKEN", "Old /inbound behavior is preserved.", status.auth.inbound_token_configured ? "ready" : "warning"),
    metric("Environment", status.app.environment, status.app.runtime, "neutral"),
    metric("Base URL", status.app.base_url, "Used for dashboard status links.", "neutral"),
  ].join("");
  document.querySelector("#route-map").innerHTML = [
    endpointRow("Backend", routes.backend),
    endpointRow("Outbound", routes.outbound),
    endpointRow("Inbound", routes.inbound),
    endpointRow("Health", routes.health),
  ].join("");
}

function renderDocs(status) {
  document.querySelector("#docs-list").innerHTML = status.navigation.docs
    .map(
      (doc) => `
        <article class="doc-card">
          <a href="${escapeHtml(doc.href)}" target="_blank" rel="noreferrer">${escapeHtml(doc.label)}</a>
          <p>Open runbook in a new tab.</p>
        </article>
      `,
    )
    .join("");
}

async function loadStatus() {
  document.querySelector("#refresh").disabled = true;
  try {
    const response = await fetch("/api/backend/status", { credentials: "same-origin" });
    if (response.status === 401) {
      location.reload();
      return;
    }
    if (!response.ok) throw new Error(`Backend status failed (${response.status})`);
    latestStatus = await response.json();
    renderOverview(latestStatus);
    renderOutbound(latestStatus);
    renderInbound(latestStatus);
    renderSettings(latestStatus);
    renderDocs(latestStatus);
  } catch (error) {
    document.querySelector("#overview-cards").innerHTML = metric(
      "Backend unavailable",
      error instanceof Error ? error.message : "Status failed.",
      "",
      "warning",
    );
  } finally {
    document.querySelector("#refresh").disabled = false;
  }
}

document.querySelectorAll("[data-view-button]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.viewButton));
});

document.querySelector("#refresh").addEventListener("click", loadStatus);
document.querySelector("#logout").addEventListener("click", async () => {
  await fetch("/api/backend/auth/logout", { method: "POST", credentials: "same-origin" });
  location.reload();
});

setView(location.hash.replace("#", "") in views ? location.hash.replace("#", "") : "overview");
loadStatus();
