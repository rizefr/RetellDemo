const summary = document.querySelector("#summary");
const retellCard = document.querySelector("#retell-card");
const voiceCard = document.querySelector("#voice-card");
const calCard = document.querySelector("#cal-card");
const storageCard = document.querySelector("#storage-card");
const checksList = document.querySelector("#checks");
const callRows = document.querySelector("#call-rows");
const leadRows = document.querySelector("#lead-rows");
const endpointList = document.querySelector("#endpoint-list");
const callDebug = document.querySelector("#call-debug");
const lastUpdated = document.querySelector("#last-updated");
let refreshTimer = null;

function text(value, fallback = "Not set") {
  if (value === null || value === undefined || value === "") return escapeHtml(fallback);
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) return value.length ? escapeHtml(value.join(", ")) : escapeHtml(fallback);
  return escapeHtml(String(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function kv(container, rows) {
  container.innerHTML = rows
    .map(([label, value]) => `<div class="kv"><dt>${label}</dt><dd>${text(value)}</dd></div>`)
    .join("");
}

function renderChecks(checks) {
  checksList.innerHTML = checks
    .map(
      (item) => `
        <li class="check-item ${item.pass ? "pass" : "fail"}">
          <span class="check-marker">${item.pass ? "pass" : "fail"}</span>
          <span><strong>${text(item.label, "")}</strong><br />${text(item.detail, "")}</span>
        </li>
      `,
    )
    .join("");
}

function cell(value) {
  return `<td>${text(value, "")}</td>`;
}

function renderCalls(calls) {
  callRows.innerHTML = calls.length
    ? calls
        .map(
          (call) => `
          <tr>
            ${cell(formatTime(call.created_at))}
            <td><span class="status-pill">${text(call.status_label || "Pending analysis", "")}</span><br /><small>${text(`${call.event_count || 1} event${(call.event_count || 1) === 1 ? "" : "s"}`, "")}</small></td>
            ${cell(call.caller_phone)}
            ${cell(call.caller_name)}
            ${cell(call.pest_issue)}
            ${cell(call.property_address)}
            ${cell(call.service_area_or_zip)}
            ${cell(call.appointment_status)}
            ${cell(call.transfer_status)}
            ${cell(call.outcome)}
            ${cell(call.summary || "Pending analysis")}
          </tr>
        `,
        )
        .join("")
    : `<tr><td colspan="11">No meaningful inbound call summaries yet. Raw blank/partial webhook events are hidden by default.</td></tr>`;
}

function renderLeads(leads) {
  leadRows.innerHTML = leads.length
    ? leads
        .map(
          (lead) => `
          <tr>
            ${cell(formatTime(lead.created_at))}
            ${cell(lead.caller_name)}
            ${cell(lead.caller_phone)}
            ${cell(lead.pest_issue)}
            ${cell(lead.property_address || [lead.property_city, lead.property_zip].filter(Boolean).join(" "))}
            ${cell(lead.service_area || lead.zip_code || lead.property_zip)}
            ${cell(lead.preferred_datetime)}
            ${cell(lead.preferred_booking_method)}
            ${cell(lead.call_summary)}
          </tr>
        `,
        )
        .join("")
    : `<tr><td colspan="9">No inbound leads found yet.</td></tr>`;
}

function curlFor(url, method = "GET") {
  if (method === "POST") {
    return `curl -s -X POST ${url} \\\n  -H 'content-type: application/json' \\\n  -d '{}'`;
  }
  return `curl -s ${url}`;
}

function renderEndpoints(status) {
  const endpoints = [
    ["Health", "GET", status.endpoints.health, "Backend health check."],
    ["Retell webhook", "POST", status.endpoints.webhook, "Requires a valid Retell signature; direct invalid tests should return 401."],
    ...status.endpoints.custom_tools.map((url) => [url.split("/").pop(), "POST", url, "Custom backend tool endpoint."]),
  ];
  const nativeTools = status.endpoints.native_tools.map((tool) => [
    tool.name,
    "NATIVE_RETELL",
    `event_type_id=${tool.event_type_id}`,
    "Configured inside Retell. There is no backend webhook URL to open.",
  ]);
  endpointList.innerHTML = [...endpoints, ...nativeTools]
    .map(
      ([name, method, url, note]) => `
        <div class="endpoint-item">
          <strong>${text(name, "")}</strong>
          <div>
            <div><code>${text(method, "")} ${text(url, "")}</code></div>
            <p>${text(note, "")}</p>
            ${method === "NATIVE_RETELL" ? "" : `<pre>${text(curlFor(url, method), "")}</pre>`}
          </div>
        </div>
      `,
    )
    .join("");
}

async function loadStatus() {
  summary.textContent = "Refreshing inbound status...";
  const response = await fetch("/api/inbound/status");
  if (response.status === 401) {
    location.reload();
    return;
  }
  if (!response.ok) {
    summary.className = "setup-summary warning";
    summary.textContent = "Inbound status request failed.";
    return;
  }
  const status = await response.json();
  lastUpdated.textContent = `Updated ${formatTime(status.checked_at)}`;
  summary.className = `setup-summary ${status.ready ? "ready" : "warning"}`;
  summary.textContent = status.ready
    ? `Ready. Checked ${formatTime(status.checked_at)}.`
    : `Review needed. Checked ${formatTime(status.checked_at)}.`;

  kv(retellCard, [
    ["Phone", status.retell.phone_number],
    ["Agent", status.retell.agent?.agent_id],
    ["Version", status.retell.agent?.version],
    ["Binding", JSON.stringify(status.retell.phone_binding)],
    ["Webhook", status.retell.agent?.webhook_url],
  ]);
  kv(voiceCard, [
    ["Voice", status.retell.agent?.voice_id],
    ["Model", status.retell.agent?.voice_model],
    ["Speed", status.retell.agent?.voice_speed],
    ["Volume", status.retell.agent?.volume],
    ["Backchannel", status.retell.agent?.enable_backchannel ? `on @ ${status.retell.agent?.backchannel_frequency}` : "off"],
    ["Interrupt", status.retell.agent?.interruption_sensitivity],
    ["Background", `${text(status.retell.agent?.ambient_sound)} @ ${text(status.retell.agent?.ambient_sound_volume)}`],
  ]);
  kv(calCard, [
    ["LLM", status.retell.llm?.llm_id],
    ["Model", status.retell.llm?.model],
    ["KB", status.retell.llm?.knowledge_base_ids?.join(", ")],
    ["Native tools", status.endpoints.native_tools.map((tool) => tool.name).join(", ")],
  ]);
  kv(storageCard, [
    ["Leads", status.supabase.tables.leads.count],
    ["Calls", status.supabase.tables.call_events.count],
    ["SMS events", status.supabase.tables.sms_events.count],
    ["Bookings", status.supabase.tables.booking_requests.count],
    ["Sheets", status.google_sheets.configured ? "configured" : "not configured"],
  ]);
  renderChecks(status.checks);
  renderCalls(status.recent.calls);
  callDebug.textContent = `${status.recent.calls.length} summarized call${status.recent.calls.length === 1 ? "" : "s"} shown. ${status.recent.hidden_blank_call_event_count || 0} blank/partial webhook event${(status.recent.hidden_blank_call_event_count || 0) === 1 ? "" : "s"} hidden from this table.`;
  renderLeads(status.recent.leads);
  renderEndpoints(status);
}

document.querySelector("#refresh").addEventListener("click", loadStatus);
document.querySelector("#logout").addEventListener("click", async () => {
  await fetch("/api/inbound/auth/logout", { method: "POST" });
  location.reload();
});

function scheduleRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    loadStatus().catch((error) => {
      summary.className = "setup-summary warning";
      summary.textContent = error instanceof Error ? error.message : "Inbound dashboard failed to refresh.";
    });
  }, 8000);
}

loadStatus().then(scheduleRefresh).catch((error) => {
  summary.className = "setup-summary warning";
  summary.textContent = error instanceof Error ? error.message : "Inbound dashboard failed to load.";
});
