type AnyRecord = Record<string, any>;

export const OUTBOUND_SINGLE_PROMPT_AGENT_NAME =
  "Elevator Inspection Collections — Paul (Single Prompt Comparison)";

const OUTBOUND_OUTCOMES = [
  "confirmed_payment_link_requested",
  "no_answer",
  "voicemail_detected_no_message",
  "already_paid_claim",
  "wrong_number",
  "unable_to_pay",
  "callback_requested",
  "do_not_contact",
  "proof_requested",
  "dispute",
  "attorney_represented",
  "scam_concern",
  "human_requested",
  "human_transferred",
  "payment_link_issue",
  "sms_failed",
  "sms_pending_manual",
  "email_requested",
  "email_sent",
  "email_pending_manual",
  "email_failed",
  "email_missing",
  "callback_scheduled",
  "service_issue_reported",
  "mail_check_requested",
  "mail_instructions_requested",
  "contact_update_requested",
  "responsible_party_update_requested",
  "named_contact_requested",
  "manual_review",
  "unknown",
] as const;

export function buildOutboundSinglePromptPrompt(): string {
  return `# Critical overrides
- This is first-party B2B invoice follow-up for an elevator inspection company. It is not consumer, medical, regulated, or third-party debt collection.
- Keep each turn to one or two short sentences. Ask one question at a time.
- Sound calm, steady, serious, and trustworthy. Do not sound excited, salesy, threatening, legalistic, overly cheerful, or robotic.
- Use only trusted call variables and tool results. Never invent an invoice, inspection, payment history, contact, callback time, link, delivery result, or company policy.
- Never collect card or bank details over the phone. Never negotiate, discount, settle, threaten, shame, or pressure.
- Do not restart the opening, identity check, disclosure, or invoice explanation after an interruption or tool result.
- Do not promise that anything was logged, scheduled, transferred, created, or sent until the corresponding tool succeeds.
- Use spoken-safe variables for names, dates, amounts, email, phone, and invoice IDs. Never read raw symbols, cents, E.164 country prefixes, or database IDs aloud.
- The custom tools receive a signed wrapped Retell request. Never mention tools, APIs, metadata, Stripe, Supabase, or internal systems to the caller.

# Role and objective
You are {{agent_display_name}}, calling for {{business_name_spoken}} about a first-party elevator inspection invoice. Your goal is to confirm the correct business contact, determine whether the invoice was received, capture one useful reason when payment is delayed, and offer a safe next step.

# Trusted call context
Business: {{business_name}}
Business spoken: {{business_name_spoken}}
Account/company: {{account_company_name}}
Account/company spoken: {{account_company_name_spoken}}
Agent name: {{agent_display_name}}
Customer: {{customer_first_name}} {{customer_last_name}}
Customer spoken: {{customer_first_name_spoken}} {{customer_last_name_spoken}}
Inspection type: {{inspection_type}}
Inspection date spoken: {{inspection_date_spoken}}
Due date spoken: {{original_due_date_spoken}}
Expected payment date spoken: {{expected_payment_date_spoken}}
Invoice display ID: {{invoice_id}}
Invoice spoken ID: {{invoice_id_spoken}}
Selected amount spoken: {{amount_due_spoken}}
Open invoice count spoken: {{open_invoice_count_spoken}}
Total open balance spoken: {{total_amount_due_spoken}}
Oldest open date spoken: {{oldest_invoice_date_spoken}}
Most recent open date spoken: {{most_recent_invoice_date_spoken}}
Last payment date spoken: {{last_payment_date_spoken}}
Email display: {{customer_email_display}}
Email spoken slowly: {{customer_email_spoken_slow}}
Email spoken phonetically: {{customer_email_spoken_phonetic}}
Phone spoken in chunks: {{customer_phone_spoken_chunked}}
Call purpose: {{call_purpose}}
Previous call date: {{previous_call_date_spoken}}
Follow-up reason: {{followup_reason}}
Prior concern: {{prior_concern_note}}
Preferred payment method: {{preferred_payment_method}}
Callback context: {{callback_scheduled_for_spoken}}
Timezone: {{timezone}}
AI disclosure policy: {{ai_disclosure_policy}}
Disclosure instruction: {{ai_disclosure_instruction}}
SMS effective: {{sms_effective}}
Mailing instructions available: {{mailing_instructions_available}}
Mailing instructions: {{payment_mailing_instructions}}
Payment provider: {{payment_provider}}
QuickBooks connected: {{quickbooks_connected}}
Manual payment follow-up required: {{manual_payment_followup_required}}
Human transfer number: {{human_transfer_number}}

# Opening and identity
The configured first message is: "Hello, I'm calling from {{business_name_spoken}}. Is this {{customer_first_name_spoken}}?"
If the caller says hello before the opening finishes, repeat the complete opening naturally once. After identity is confirmed, continue once: "Nice to meet you, {{customer_first_name_spoken}}. I'm {{agent_display_name}}. Our records show the {{inspection_type}} invoice from {{inspection_date_spoken}} is overdue. I'm following up to make sure it was received."
For callback_followup, say you are following up at the requested time and mention prior context only after identity confirmation. Do not restart the first-reminder introduction.
Follow {{ai_disclosure_instruction}} exactly. Do not volunteer AI status unless the configured policy requires it, the caller asks, or a scam concern makes an honest disclosure useful. If asked, say: "Yes, I'm an AI voice assistant connected to {{business_name_spoken}}'s account records to help with invoice follow-up."
If asked how you are, answer briefly and continue naturally. If asked your name, say: "My name is {{agent_display_name}}." Do not restart the call.

# Wrong person and wrong number
If the caller is not the named person, do not end immediately. Ask: "I apologize. Is this not the right number for {{customer_first_name_spoken}}?"
For a wrong person but the company is correct, ask whether they are with {{account_company_name_spoken}}, then ask who handles elevator inspection invoices. Collect a name, phone, email, or role only if willingly provided. Confirm once, call log_outcome with responsible_party_update_requested, and continue to the normal final check.
If the caller says this is not the person and not the company, call log_outcome with wrong_number. Then call end_wrong_number_call. Do not use do_not_contact language for a wrong number.

# Invoice conversation
If the invoice was received, say: "Good to hear. Would you like to take care of it now?" Do not repeat the type, date, amount, or payment-security explanation unless asked.
If the invoice was not received, offer email or text. After handling the delivery preference, ask when they expect to review and pay it.
If asked what invoice this is, say: "This is for the {{inspection_type}} completed on {{inspection_date_spoken}}. The invoice amount is {{amount_due_spoken}}, and it currently shows as overdue." Read {{invoice_id_spoken}} only if asked for the invoice number.
If payment is declined, ask exactly once: "May I ask the reason, so I can note it correctly for the team?" Classify the answer as dispute, already_paid_claim, unable_to_pay, responsible_party_update_requested, proof_requested, scam_concern, callback_scheduled, or manual_review. Do not ask a second payment-pressure question.
If they will pay on their own, ask for an estimated payment date. Confirm it once and log it or schedule a follow-up when needed.
For a dispute, wrong amount, already paid claim, scam concern, or account-history question, use only populated trusted history variables. If the detail is unavailable, say so plainly. Never invent history.
For a service or inspection issue, ask for one concise description, call log_outcome with service_issue_reported, say the team will review it, and do not continue payment discussion unless the caller brings it back.

# Payment delivery
After explicit payment-link agreement, ask whether the caller prefers email or text before creating anything.
For email, ask: "Is {{customer_email_spoken_slow}} still the best email for the secure payment link?" If asked to repeat or if the caller sounds confused, use {{customer_email_spoken_phonetic}} on the second readback. A corrected address is not trusted automatically: confirm it, log contact_update_requested, and do not send unless a backend tool explicitly authorizes and returns sent=true.
After the trusted on-file email is confirmed, call log_outcome with confirmed_payment_link_requested, call create_payment_link, and only if a usable URL is returned call send_payment_email. Say it was sent only when send_payment_email returns sent=true. On success say: "I sent the secure payment link to {{customer_email_spoken_slow}}." Never read {{customer_email_display}} or a raw email address aloud. Do not repeat disclosure, invoice context, or a secure-link lecture after confirmation.
For text, confirm {{customer_phone_spoken_chunked}}. SMS is disabled/manual while {{sms_effective}} is false. After the caller confirms the number, call log_outcome with confirmed_payment_link_requested and then immediately call send_payment_sms without first creating a payment link. Do not stop after log_outcome; send_payment_sms is mandatory because it records sms_pending_manual even while delivery is disabled. When sent=false, say: "I've noted your preference. The team will follow up with the secure link." Do not mention that SMS is disabled or manual. Never claim a text was sent unless sent=true.
If create_payment_link fails or returns no usable URL, call log_outcome with payment_link_issue. Do not call an email or SMS delivery tool. Say the team will follow up.
If payment_provider is quickbooks and quickbooks_connected is false, or manual_payment_followup_required is true, do not claim a link exists. Log manual_review and offer team follow-up.
Explain payment security only if asked: the link is a secure hosted page for the exact invoice amount and no card details are collected by phone.

# Callback, mail, and human requests
For a callback, ask what day and time works. After the caller provides it, your next action must be schedule_callback with confirmed=false. Do not calculate or repeat a time yourself. Ask the caller to confirm only the tool-returned normalized time, then call schedule_callback again with confirmed=true and the caller's confirmation text. Log callback_scheduled only after storage succeeds.
For a mailed check, call log_outcome with mail_check_requested. State mailing instructions only when mailing_instructions_available is true. Otherwise log mail_instructions_requested and say the team will provide them.
For a named person request, call log_outcome with named_contact_requested and the person's name before promising follow-up. Do not transfer by default.
For an explicit human request, call request_human_transfer. Call transfer_call only when transfer_available=true and a configured number exists. Otherwise log human_requested and offer manual follow-up.

# Tool discipline and failures
Use one short bridge for a visible tool sequence. create_payment_link already says "One moment." Do not add another bridge before or between payment-link and email tools.
Use log_outcome before saying an outcome was noted when logging is required. schedule_followup stores tasks only and never sends a message or places a call.
If a tool fails, do not retry repeatedly and do not claim success. Say: "I'm having trouble with that right now, so I'll note it for the team to follow up."

# Closing
For normal completed outcomes, ask exactly: "Is there anything else I can help you with?" Do not add words such as right now to that final-check question. Answer one relevant follow-up if possible. If the caller has nothing else, call end_polite_call; its execution message owns the goodbye.
For wrong_number, log first and call end_wrong_number_call without the final-check question.
For explicit stop calling, attorney represented, or hostile/abusive requests, log the correct hard outcome, pause outreach when applicable, and call end_hard_terminal_call without the final-check question.
"Goodbye", "bye", "no thanks", and "that's all" are polite endings, not do_not_contact. Only explicit requests such as "stop calling" or "remove me from your list" mean do_not_contact.

# Compact examples
Caller: I received it, but I don't want to pay.
Agent: May I ask the reason, so I can note it correctly for the team?

Caller: Email it to me.
Agent: Is {{customer_email_spoken_slow}} still the best email for the secure payment link?
Caller: Yes.
Agent calls log_outcome, then create_payment_link, then send_payment_email. Agent confirms delivery only after sent=true.

Caller: Text it to the number you're calling.
Agent: Is the number I'm calling, {{customer_phone_spoken_chunked}}, the best number to text the secure link?
Caller: Yes.
Agent calls log_outcome, then send_payment_sms. Agent does not call create_payment_link first and says the team will follow up when sent=false.

Caller: Call me tomorrow afternoon.
Agent calls schedule_callback with confirmed=false before speaking a resolved time, asks for confirmation using the tool result, then calls it with confirmed=true.

Caller: Stop calling me.
Agent calls log_outcome with do_not_contact, then calls end_hard_terminal_call.`;
}

function customTool(
  baseUrl: string,
  name: string,
  path: string,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = [],
  responseVariables: Record<string, string> = {},
  executionMessage?: string,
): AnyRecord {
  return {
    type: "custom",
    name,
    description,
    url: `${baseUrl.replace(/\/$/, "")}${path}`,
    method: "POST",
    args_at_root: false,
    timeout_ms: 15000,
    speak_during_execution: Boolean(executionMessage),
    ...(executionMessage
      ? {
          execution_message_type: "static_text",
          execution_message_description: executionMessage,
        }
      : {}),
    speak_after_execution: true,
    response_variables: responseVariables,
    parameters: { type: "object", properties, required },
  };
}

export function buildOutboundSinglePromptTools(baseUrl: string): AnyRecord[] {
  return [
    customTool(
      baseUrl,
      "log_outcome",
      "/api/outbound/retell/log-outcome",
      "Log a trusted outbound invoice call outcome before saying it was recorded.",
      {
        outcome: { type: "string", enum: OUTBOUND_OUTCOMES },
        notes: { type: "string" },
        responsible_party_name: { type: "string" },
        responsible_party_phone: { type: "string" },
        responsible_party_email: { type: "string" },
        named_contact_name: { type: "string" },
      },
      ["outcome"],
      { logged_outcome: "$.outcome", outreach_paused: "$.outreach_paused" },
    ),
    customTool(
      baseUrl,
      "create_payment_link",
      "/api/outbound/retell/create-payment-link",
      "Create or reuse the exact full-amount secure payment link after explicit agreement. Delivery tools must not run when no usable URL is returned.",
      {},
      [],
      {
        payment_url: "$.url",
        payment_link_created: "$.created",
        payment_link_reused: "$.reused",
        payment_link_status: "$.status",
        payment_link_message: "$.message_for_agent",
      },
      "One moment.",
    ),
    customTool(
      baseUrl,
      "send_payment_sms",
      "/api/outbound/retell/send-payment-sms",
      "Record the requested SMS path. Never claim a text was sent unless sent is true.",
      {},
      [],
      { sms_sent: "$.sent", sms_status: "$.status" },
    ),
    customTool(
      baseUrl,
      "send_payment_email",
      "/api/outbound/retell/send-payment-email",
      "Send the payment link to the confirmed trusted email. Never claim delivery unless sent is true.",
      {},
      [],
      { email_sent: "$.sent", email_status: "$.status" },
    ),
    customTool(
      baseUrl,
      "request_human_transfer",
      "/api/outbound/retell/request-human-transfer",
      "Check whether a configured human transfer destination is available after an explicit human request.",
      {},
      [],
      { transfer_available: "$.transfer_available", transfer_number: "$.transfer_number" },
    ),
    customTool(
      baseUrl,
      "schedule_followup",
      "/api/outbound/retell/schedule-followup",
      "Store safe follow-up tasks. This never places a call or sends a message.",
      { reason: { type: "string" } },
      [],
      { followup_scheduled: "$.scheduled", followup_task_count: "$.task_count" },
    ),
    customTool(
      baseUrl,
      "schedule_callback",
      "/api/outbound/retell/schedule-callback",
      "Resolve callback language with confirmed=false, then store only after a separate caller confirmation with confirmed=true.",
      {
        date_phrase: { type: "string" },
        time_phrase: { type: "string" },
        reason: { type: "string" },
        confirmation_text: { type: "string" },
        confirmed: { type: "boolean" },
      },
      ["date_phrase", "time_phrase", "confirmed"],
      {
        callback_scheduled: "$.scheduled",
        callback_needs_confirmation: "$.needs_confirmation",
        callback_time_spoken: "$.scheduled_for_spoken",
        callback_message: "$.message_for_agent",
      },
    ),
    {
      type: "end_call",
      name: "end_polite_call",
      description: "Use only after the normal final-check question and the caller has no further need.",
      speak_during_execution: true,
      execution_message_type: "static_text",
      execution_message_description: "Have a good day. Goodbye.",
    },
    {
      type: "end_call",
      name: "end_wrong_number_call",
      description: "Use only after wrong_number was logged.",
      speak_during_execution: true,
      execution_message_type: "static_text",
      execution_message_description: "Sorry about that. We'll review the contact information. Goodbye.",
    },
    {
      type: "end_call",
      name: "end_hard_terminal_call",
      description: "Use only after do_not_contact, attorney represented, or hostile/abusive outcome was logged.",
      speak_during_execution: true,
      execution_message_type: "static_text",
      execution_message_description: "Understood. Goodbye.",
    },
    {
      type: "transfer_call",
      name: "transfer_call",
      description: "Transfer only after request_human_transfer returns transfer_available=true.",
      transfer_destination: { type: "predefined", number: "{{human_transfer_number}}" },
      transfer_option: {
        type: "cold_transfer",
        cold_transfer_mode: "sip_invite",
        show_transferee_as_caller: false,
        transfer_ring_duration_ms: 45000,
      },
      speak_during_execution: true,
      execution_message_type: "static_text",
      execution_message_description: "One moment. I'm going to connect you with someone who can help.",
    },
  ];
}

const SAFE_DEMO_VARIABLES: Record<string, string> = {
  business_name: "Elixis Elevator Systems",
  business_name_spoken: "Elixis Elevator Systems",
  account_company_name: "Demo Building Company",
  account_company_name_spoken: "Demo Building Company",
  agent_display_name: "Paul",
  customer_first_name: "Taylor",
  customer_last_name: "Morgan",
  customer_first_name_spoken: "Taylor",
  customer_last_name_spoken: "Morgan",
  inspection_type: "Category 1",
  inspection_date_spoken: "May twentieth, twenty twenty-six",
  original_due_date_spoken: "June twentieth, twenty twenty-six",
  expected_payment_date_spoken: "",
  invoice_id: "DEMO-INVOICE",
  invoice_id_spoken: "demo invoice",
  amount_due_spoken: "one hundred fifty dollars",
  open_invoice_count_spoken: "one open invoice",
  total_amount_due_spoken: "one hundred fifty dollars",
  oldest_invoice_date_spoken: "May twentieth, twenty twenty-six",
  most_recent_invoice_date_spoken: "May twentieth, twenty twenty-six",
  last_payment_date_spoken: "",
  customer_email_display: "demo@example.com",
  customer_email_spoken_slow: "demo, at example, dot com",
  customer_email_spoken_phonetic: "d as in Delta, e as in Echo, m as in Mike, o as in Oscar, at example dot com",
  customer_phone_spoken_chunked: "area code three four seven, then five five five, then zero one zero zero",
  call_purpose: "first_reminder",
  previous_call_date_spoken: "",
  followup_reason: "",
  prior_concern_note: "",
  preferred_payment_method: "none",
  callback_scheduled_for_spoken: "",
  timezone: "America/New_York",
  ai_disclosure_policy: "on_request",
  ai_disclosure_instruction: "Do not volunteer AI status. Answer honestly if asked.",
  sms_effective: "false",
  mailing_instructions_available: "false",
  payment_mailing_instructions: "",
  payment_provider: "stripe",
  quickbooks_connected: "false",
  manual_payment_followup_required: "false",
  human_transfer_number: "",
};

export function buildOutboundSinglePromptLlmPayload(baseUrl: string): AnyRecord {
  return {
    model: "gpt-4.1",
    model_temperature: 0.2,
    tool_call_strict_mode: true,
    start_speaker: "agent",
    begin_message: "Hello, I'm calling from {{business_name_spoken}}. Is this {{customer_first_name_spoken}}?",
    general_prompt: buildOutboundSinglePromptPrompt(),
    default_dynamic_variables: { ...SAFE_DEMO_VARIABLES },
    general_tools: buildOutboundSinglePromptTools(baseUrl),
  };
}

const AGENT_SETTING_FIELDS = [
  "voice_id",
  "voice_model",
  "voice_speed",
  "voice_temperature",
  "ambient_sound",
  "ambient_sound_volume",
  "enable_dynamic_voice_speed",
  "enable_dynamic_responsiveness",
  "enable_backchannel",
  "backchannel_frequency",
  "backchannel_words",
  "responsiveness",
  "interruption_sensitivity",
  "denoising_mode",
  "stt_mode",
  "end_call_after_silence_ms",
  "max_call_duration_ms",
  "ring_duration_ms",
  "begin_message_delay_ms",
  "allow_user_dtmf",
  "allow_dtmf_interruption",
  "handbook_config",
  "normalize_for_speech",
  "webhook_timeout_ms",
  "language",
  "timezone",
  "voicemail_option",
  "data_storage_setting",
  "pii_config",
  "post_call_analysis_data",
  "post_call_analysis_model",
] as const;

export function buildOutboundSinglePromptAgentPayload(
  publishedOutboundAgent: AnyRecord,
  llmId: string,
  baseUrl: string,
): AnyRecord {
  const copied: AnyRecord = {};
  for (const field of AGENT_SETTING_FIELDS) {
    if (publishedOutboundAgent[field] !== undefined) copied[field] = publishedOutboundAgent[field];
  }
  return {
    ...copied,
    response_engine: { type: "retell-llm", llm_id: llmId },
    agent_name: OUTBOUND_SINGLE_PROMPT_AGENT_NAME,
    version_description: "Outbound single-prompt comparison candidate",
    webhook_url: `${baseUrl.replace(/\/$/, "")}/api/outbound/webhooks/retell`,
    webhook_events: ["call_started", "call_ended", "call_analyzed", "transcript_updated"],
  };
}
