const views = {
  overview: document.querySelector("#view-overview"),
  outbound: document.querySelector("#view-outbound"),
  inbound: document.querySelector("#view-inbound"),
  "landing-pages": document.querySelector("#view-landing-pages"),
  settings: document.querySelector("#view-settings"),
  docs: document.querySelector("#view-docs"),
};
const titles = {
  overview: "Overview",
  outbound: "Outbound Collections",
  inbound: "Inbound Receptionist",
  "landing-pages": "Landing Pages",
  settings: "Settings / Setup",
  docs: "Docs / Runbooks",
};

let latestStatus = null;
let landingLoaded = false;

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

function rate(value) {
  return typeof value === "number" ? `${value.toFixed(1)}%` : "—";
}

function landingLabel(value) {
  const labels = {
    answer: "Availability",
    ready: "Scenario proof / QA",
    coverage: "Coverage / Backup path",
    full_receptionist: "Full receptionist",
    defined_coverage_gap: "Defined gap / Backup",
    explore_both: "Explore both",
    owner_or_techs: "Owner / technicians",
    office_team: "Office team",
    answering_service: "Answering service",
    voicemail_or_mix: "Voicemail / mix",
    after_hours: "After-hours",
    overflow: "Overflow",
    lunch_weekends: "Lunch / weekends",
    missed_or_unsure: "Missed / unsure",
    under_50: "Under 50",
    "50_150": "50–150",
    "151_400": "151–400",
    "400_plus": "400+",
    unsure: "Unsure",
  };
  return labels[value] || String(value || "—").replaceAll("_", " ");
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
  if (id === "landing-pages" && !landingLoaded) loadLandingPages();
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

function renderLandingPages(data) {
  const diagnostics = data.diagnostics || {};
  document.querySelector("#landing-availability").innerHTML = statusRow(
    "Analytics storage",
    data.available
      ? `Reachable. Showing ${data.range_days} day${data.range_days === 1 ? "" : "s"}${data.include_test ? " with test data" : " excluding test data"}.`
      : [diagnostics.events_error, diagnostics.leads_error].filter(Boolean).join(" · ") || "Unavailable",
    data.available ? "ready" : "warning",
  );

  const totals = data.totals || {};
  document.querySelector("#landing-total-cards").innerHTML = [
    metric("Page views", text(totals.page_views, "0"), "First-party recorded views", "neutral"),
    metric("Unique-session estimate", text(totals.unique_session_estimates, "0"), "Random sessionStorage UUID; not people", "neutral"),
    metric("Form starts", text(totals.form_starts, "0"), "First meaningful form interaction", "neutral"),
    metric("Lead submissions", text(totals.submissions, "0"), "Deduplicated lead rows", "ready"),
    metric("View → submit", rate(totals.view_to_submit_rate), "Directional while traffic is low", "neutral"),
    metric("Booking / demo clicks", `${text(totals.booking_clicks, "0")} / ${text(totals.demo_clicks, "0")}`, "Click intent; not completed bookings", "neutral"),
  ].join("");

  const variants = data.variants || [];
  document.querySelector("#landing-variant-rows").innerHTML = variants.length
    ? variants
        .map(
          (item) => `<tr>
            <td><strong>${escapeHtml(landingLabel(item.variant))}</strong><br /><code>${escapeHtml(item.route)}</code></td>
            ${cell(item.page_views)}${cell(item.unique_sessions)}${cell(item.form_starts)}${cell(item.submissions)}
            ${cell(item.booking_clicks)}${cell(item.demo_clicks)}${cell(rate(item.view_to_submit_rate))}${cell(rate(item.start_to_submit_rate))}
          </tr>`,
        )
        .join("")
    : `<tr><td colspan="9">No variant data in this range.</td></tr>`;

  const sources = data.sources || [];
  document.querySelector("#landing-source-rows").innerHTML = sources.length
    ? sources
        .map((item) => `<tr>${cell(item.source)}${cell(item.medium)}${cell(item.campaign)}${cell(item.page_views)}${cell(item.submissions)}</tr>`)
        .join("")
    : `<tr><td colspan="5">No source data in this range.</td></tr>`;

  const privacy = diagnostics.privacy || {};
  const eventCounts = diagnostics.event_counts || {};
  document.querySelector("#landing-diagnostics").innerHTML = [
    statusRow("Events table", diagnostics.events_table_reachable ? "Reachable" : diagnostics.events_error || "Unavailable", diagnostics.events_table_reachable ? "ready" : "warning"),
    statusRow("Leads table", diagnostics.leads_table_reachable ? "Reachable" : diagnostics.leads_error || "Unavailable", diagnostics.leads_table_reachable ? "ready" : "warning"),
    statusRow("Latest event", formatTime(diagnostics.latest_event_at), "neutral"),
    statusRow("Latest submission", formatTime(diagnostics.latest_lead_at), "neutral"),
    statusRow("Event alignment", `Successful-event minus lead delta: ${text(diagnostics.successful_event_lead_delta, "0")}`, diagnostics.successful_event_lead_delta === 0 ? "ready" : "warning"),
    statusRow("Attribution", `${rate(diagnostics.missing_utm_page_view_rate)} of page views have no UTM values (direct/referrer may still be present).`, "neutral"),
    statusRow("Form health", `${text(eventCounts.form_error, "0")} form_error event(s); ${text(eventCounts.form_submit, "0")} form_submit event(s).`, eventCounts.form_error ? "warning" : "ready"),
    statusRow("Test exclusions", `${text(diagnostics.test_events_excluded, "0")} event(s), ${text(diagnostics.test_leads_excluded, "0")} lead(s) excluded.`, "neutral"),
    statusRow("Data caps", `Events: ${diagnostics.event_data_cap_reached ? "reached" : "not reached"}. Leads: ${diagnostics.lead_data_cap_reached ? "reached" : "not reached"}.`, diagnostics.event_data_cap_reached || diagnostics.lead_data_cap_reached ? "warning" : "ready"),
    statusRow("Privacy", `Cookies ${privacy.cookies || "none"}; fingerprinting ${privacy.fingerprinting || "none"}; raw IP stored ${text(privacy.raw_ip_stored, "no")}; user agent stored ${text(privacy.user_agent_stored, "no")}; fbclid stored ${text(privacy.fbclid_stored, "no")}.`, "ready"),
  ].join("");

  const leads = data.recent_leads || [];
  document.querySelector("#landing-lead-rows").innerHTML = leads.length
    ? leads
        .map(
          (lead) => `<tr>${cell(formatTime(lead.created_at))}${cell(landingLabel(lead.variant))}${cell(lead.business_name)}${cell(lead.full_name)}${cell(lead.email)}${cell(lead.phone)}${cell(landingLabel(lead.interest))}${cell(landingLabel(lead.current_handling))}${cell(landingLabel(lead.coverage_gap))}${cell(landingLabel(lead.call_volume_band))}${cell(lead.source)}</tr>`,
        )
        .join("")
    : `<tr><td colspan="11">No landing-page leads in this range.</td></tr>`;

  const events = data.recent_events || [];
  document.querySelector("#landing-event-rows").innerHTML = events.length
    ? events
        .map(
          (event) => `<tr>${cell(formatTime(event.created_at))}${cell(event.event_name)}${cell(landingLabel(event.variant))}${cell(event.route)}${cell(event.source)}${cell(event.utm_campaign)}${cell(JSON.stringify(event.metadata || {}))}${cell(event.is_test ? "test" : "live")}</tr>`,
        )
        .join("")
    : `<tr><td colspan="8">No landing-page events in this range.</td></tr>`;
}

async function loadLandingPages() {
  const range = document.querySelector("#landing-range").value;
  const includeTest = document.querySelector("#landing-include-test").checked;
  document.querySelector("#landing-availability").innerHTML = statusRow("Analytics storage", "Loading…", "neutral");
  try {
    const response = await fetch(`/api/backend/landing-pages?range=${encodeURIComponent(range)}&include_test=${includeTest}`, { credentials: "same-origin" });
    if (response.status === 401) {
      location.reload();
      return;
    }
    if (!response.ok) throw new Error(`Landing-page analytics failed (${response.status})`);
    renderLandingPages(await response.json());
    landingLoaded = true;
  } catch (error) {
    document.querySelector("#landing-availability").innerHTML = statusRow(
      "Landing-page analytics unavailable",
      error instanceof Error ? error.message : "Status failed.",
      "warning",
    );
  }
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

document.querySelector("#refresh").addEventListener("click", async () => {
  await loadStatus();
  if (document.querySelector("#view-landing-pages").classList.contains("active")) await loadLandingPages();
});
document.querySelector("#landing-range").addEventListener("change", loadLandingPages);
document.querySelector("#landing-include-test").addEventListener("change", loadLandingPages);
document.querySelector("#logout").addEventListener("click", async () => {
  await fetch("/api/backend/auth/logout", { method: "POST", credentials: "same-origin" });
  location.reload();
});

setView(location.hash.replace("#", "") in views ? location.hash.replace("#", "") : "overview");
loadStatus();
