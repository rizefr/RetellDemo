import type { ConversationFlowCreateParams } from "retell-sdk/resources/conversation-flow";
import { buildOutboundConversationFlow } from "./outboundConversationFlow";

const LOOKUP_TOOL_ID = "outbound_lookup_inbound_account";

const INBOUND_OPENING_AND_IDENTITY = `# Inbound callback opening and identity verification
This is an inbound callback to the collections number. The caller is not yet identified. Speak first with exactly: "Hi, you've reached the invoice follow-up line for {{business_name_spoken}}. May I get your first and last name?"
Do not say that you called the person just now, and do not assume the caller is the customer listed on any invoice.
When the caller gives a name, call lookup_inbound_account immediately. Pass the caller's first and last name and any company, invoice number, or email they voluntarily supplied. The backend also checks the signed call's calling phone number.
Do not disclose an invoice amount, date, number, inspection type, customer email, or customer phone until lookup_inbound_account returns verified=true. A name alone is not enough. Verification requires phone plus name, or name plus a matching company, invoice number, or email from the account.
If lookup_inbound_account returns needs_verification or ambiguous, ask for exactly one safe corroborator: the company/account name, invoice number, or email on the account. Never request a Social Security number, date of birth, ZIP code, card number, bank information, password, or authentication code. Call lookup_inbound_account again with the new corroborator.
If lookup_inbound_account returns not_found, ask once for the spelling of the first and last name. If the second lookup still does not verify, explain that you cannot locate a verified open invoice on this call, log manual_review, and route to the normal final check. Never invent a match.
When lookup_inbound_account returns verified=true, continue naturally: "Got it, {{customer_first_name_spoken}}. I found the account. Our records show the {{inspection_type}} invoice from {{inspection_date_spoken}} is overdue. Were you able to receive it?" Do not restart the introduction and do not repeat the identity question.
If the caller asks who is calling, say: "My name is {{agent_display_name}}. I'm helping {{business_name_spoken}} with invoice follow-up." If asked whether you are AI, answer honestly once.
If the caller is returning a voicemail, acknowledge that briefly and continue with name verification. Do not reveal invoice details before verified lookup.
After verification, follow the same invoice-received, invoice-not-received, secure-link, expected-payment-date, callback, objection, final-check, and hard-terminal rules as the outbound collections flow.
`;

function lookupTool(baseUrl: string): ConversationFlowCreateParams.CustomTool {
  return {
    tool_id: LOOKUP_TOOL_ID,
    type: "custom",
    name: "lookup_inbound_account",
    description:
      "Verify an inbound caller against open invoice records. Call immediately after the caller gives a name, and call again when the caller supplies one safe corroborator. Never disclose invoice details unless verified is true.",
    url: `${baseUrl}/api/outbound/retell/lookup-inbound-account`,
    method: "POST",
    timeout_ms: 15000,
    speak_during_execution: true,
    execution_message_type: "static_text",
    execution_message_description: "One moment.",
    speak_after_execution: true,
    response_variables: {
      inbound_lookup_status: "$.status",
      inbound_lookup_verified: "$.verified",
      customer_first_name: "$.customer_first_name",
      customer_first_name_spoken: "$.customer_first_name_spoken",
      customer_last_name: "$.customer_last_name",
      customer_last_name_spoken: "$.customer_last_name_spoken",
      account_company_name: "$.account_company_name",
      account_company_name_spoken: "$.account_company_name_spoken",
      inspection_type: "$.inspection_type",
      inspection_date_spoken: "$.inspection_date_spoken",
      original_due_date_spoken: "$.original_due_date_spoken",
      amount_due_spoken: "$.amount_due_spoken",
      invoice_id_spoken: "$.invoice_id_spoken",
      customer_email_spoken_slow: "$.customer_email_spoken_slow",
      customer_phone_spoken_chunked: "$.customer_phone_spoken_chunked",
      payment_provider: "$.payment_provider",
      expected_payment_date_spoken: "$.expected_payment_date_spoken",
      lookup_message: "$.message_for_agent",
    },
    parameters: {
      type: "object",
      properties: {
        first_name: { type: "string", description: "Caller's stated first name." },
        last_name: { type: "string", description: "Caller's stated last name, when supplied." },
        account_company_name: { type: "string", description: "Company/account name volunteered by the caller." },
        email: { type: "string", description: "Email volunteered by the caller for identity corroboration." },
        invoice_id: { type: "string", description: "Invoice number volunteered by the caller." },
      },
      required: ["first_name"],
    },
  };
}

export function buildInboundCollectionsConversationFlow(baseUrl: string): ConversationFlowCreateParams {
  const outbound = buildOutboundConversationFlow(baseUrl);
  const outboundPrompt = String(outbound.global_prompt || "");
  const openingStart = outboundPrompt.indexOf("# Opening and disclosure");
  const discussionStart = outboundPrompt.indexOf("# Inspection invoice discussion");
  if (openingStart < 0 || discussionStart < 0) {
    throw new Error("Outbound collections prompt headings changed; inbound prompt composition must be reviewed.");
  }

  const nodes = structuredClone(outbound.nodes ?? []);
  const main = nodes.find((node) => node.id === "outbound_collections_agent");
  if (!main || main.type !== "subagent") throw new Error("Outbound collections start node is missing.");
  main.name = "Verified inbound collections conversation";
  main.instruction = {
    type: "prompt",
    text: "Identity has already been verified by the inbound identity nodes. Inspect everything the caller said before lookup and continue naturally with only the unresolved step. When invoice receipt is still unknown, say: Got it, {{customer_first_name_spoken}}. I found the account. Our records show the {{inspection_type}} invoice from {{inspection_date_spoken}} is overdue. Were you able to receive it? Do not use the outbound opening, ask for identity again, or restart the conversation. Then preserve the existing invoice, payment, expected-payment-date, final-check, wrong-number, and hard-terminal routes.",
  };
  const identityNode: ConversationFlowCreateParams.SubagentNode = {
    id: "inbound_identity_agent",
    type: "subagent",
    name: "Collect inbound caller identity",
    instruction: {
      type: "prompt",
      text: "Ask for the caller's first and last name. This node only collects identity input. Never discuss an invoice, payment, date, amount, email, or phone from account records here. As soon as the caller supplies a name, transition to the lookup function without acknowledging or repeating it. For an explicit stop-calling request, transition to the hard terminal node.",
    },
    edges: [
      {
        id: "inbound_identity_name_supplied_edge",
        destination_node_id: "inbound_identity_lookup_function",
        transition_condition: {
          type: "prompt",
          prompt: "Transition immediately when the caller supplies a first name, with or without a last name or other identity details. Do not speak before transitioning.",
        },
      },
      {
        id: "inbound_identity_hard_terminal_edge",
        destination_node_id: "outbound_hard_terminal_end",
        transition_condition: {
          type: "prompt",
          prompt: "Transition immediately for an explicit stop-calling, attorney-represented, or hostile hard-terminal request. A polite goodbye is not a hard-terminal request.",
        },
      },
    ],
    finetune_transition_examples: [
      {
        id: "inbound_identity_lookup_transition_example",
        destination_node_id: "inbound_identity_lookup_function",
        transcript: [
          { role: "agent", content: "Hi, you've reached the invoice follow-up line for {{business_name_spoken}}. May I get your first and last name?" },
          { role: "user", content: "Pat Morgan." },
        ],
      },
    ],
    display_position: { x: -400, y: 0 },
  };

  const verifiedBundledDateEdge = (id: string) => ({
    id,
    destination_node_id: "outbound_expected_payment_date_function",
    transition_condition: {
      type: "prompt" as const,
      prompt: "Transition here only when lookup returned verified and the caller already stated before lookup that the invoice was received, they declined or did not need the payment link, and they supplied an expected payment date. All three facts must be present. Do not acknowledge or restate the date before transitioning.",
    },
  });

  const verifiedEdge = (id: string) => ({
    id,
    destination_node_id: "outbound_collections_agent",
    transition_condition: {
      type: "equation" as const,
      equations: [{ left: "{{inbound_lookup_status}}", operator: "==" as const, right: "verified" }],
      operator: "&&" as const,
    },
  });

  const firstLookupNode: ConversationFlowCreateParams.FunctionNode = {
    id: "inbound_identity_lookup_function",
    type: "function",
    name: "Verify inbound caller account",
    tool_id: LOOKUP_TOOL_ID,
    tool_type: "local",
    wait_for_result: true,
    speak_during_execution: false,
    instruction: {
      type: "prompt",
      text: "Call lookup_inbound_account using the caller's stated first and last name plus any company, invoice number, or email they volunteered. Do not disclose account details before a verified result.",
    },
    edges: [
      verifiedBundledDateEdge("inbound_verified_bundled_expected_date_edge"),
      verifiedEdge("inbound_identity_verified_edge"),
    ],
    else_edge: {
      id: "inbound_identity_needs_corroboration_edge",
      destination_node_id: "inbound_identity_corroboration_agent",
      transition_condition: { type: "prompt", prompt: "Else" },
    },
    display_position: { x: -180, y: 0 },
  };

  const corroborationNode: ConversationFlowCreateParams.SubagentNode = {
    id: "inbound_identity_corroboration_agent",
    type: "subagent",
    name: "Collect one inbound identity corroborator",
    instruction: {
      type: "prompt",
      text: "The first lookup did not verify the caller. If inbound_lookup_status is not_found, ask once for the spelling of the first and last name. Otherwise ask for exactly one safe corroborator: company/account name, invoice number, or email on the account. Never ask for a Social Security number, date of birth, ZIP code, card or bank information, password, or authentication code. As soon as the caller supplies the requested detail, transition to the retry lookup without acknowledging it.",
    },
    edges: [
      {
        id: "inbound_identity_corroborator_supplied_edge",
        destination_node_id: "inbound_identity_retry_lookup_function",
        transition_condition: {
          type: "prompt",
          prompt: "Transition immediately when the caller supplies the requested spelling or one safe corroborator. Do not speak before transitioning.",
        },
      },
      {
        id: "inbound_corroboration_hard_terminal_edge",
        destination_node_id: "outbound_hard_terminal_end",
        transition_condition: {
          type: "prompt",
          prompt: "Transition immediately for an explicit stop-calling, attorney-represented, or hostile hard-terminal request. A polite goodbye is not a hard-terminal request.",
        },
      },
    ],
    display_position: { x: 40, y: 80 },
  };

  const secondLookupNode: ConversationFlowCreateParams.FunctionNode = {
    id: "inbound_identity_retry_lookup_function",
    type: "function",
    name: "Retry inbound caller verification",
    tool_id: LOOKUP_TOOL_ID,
    tool_type: "local",
    wait_for_result: true,
    speak_during_execution: false,
    instruction: {
      type: "prompt",
      text: "Call lookup_inbound_account again using the caller's stated name and the latest spelling or safe corroborator. Do not disclose account details before a verified result.",
    },
    edges: [
      verifiedBundledDateEdge("inbound_retry_verified_bundled_expected_date_edge"),
      verifiedEdge("inbound_identity_retry_verified_edge"),
    ],
    else_edge: {
      id: "inbound_identity_retry_unverified_edge",
      destination_node_id: "inbound_identity_unverified_explanation",
      transition_condition: { type: "prompt", prompt: "Else" },
    },
    display_position: { x: 260, y: 80 },
  };

  const unverifiedNode: ConversationFlowCreateParams.SubagentNode = {
    id: "inbound_identity_unverified_explanation",
    type: "subagent",
    name: "Unverified inbound caller close",
    instruction: {
      type: "prompt",
      text: "Explain once that you could not locate a verified open invoice on this call. Call log_outcome with outcome manual_review and concise notes before saying it was noted. Then ask exactly: Is there anything else I can help you with? If the caller has no further need, use the native end-call tool. Never disclose any account details.",
    },
    tool_ids: ["outbound_log_outcome"],
    tools: [
      {
        type: "end_call",
        name: "end_unverified_inbound_call",
        description: "End an unverified inbound call after the final check.",
        speak_during_execution: true,
        execution_message_type: "static_text",
        execution_message_description: "Have a good day. Goodbye.",
      },
    ],
    display_position: { x: 480, y: 100 },
  };

  return {
    ...outbound,
    start_node_id: "inbound_identity_agent",
    global_prompt: `${outboundPrompt.slice(0, openingStart)}${INBOUND_OPENING_AND_IDENTITY}\n${outboundPrompt.slice(discussionStart)}`,
    tools: [lookupTool(baseUrl), ...(outbound.tools ?? [])],
    nodes: [identityNode, firstLookupNode, corroborationNode, secondLookupNode, unverifiedNode, ...nodes],
    default_dynamic_variables: {
      ...(outbound.default_dynamic_variables ?? {}),
      business_name: "Pinnacle Elevator Solutions",
      business_name_spoken: "Pinnacle Elevator Solutions",
      agent_display_name: "Paul",
      inbound_lookup_status: "unverified",
      inbound_lookup_verified: "false",
      call_purpose: "inbound_callback",
      demo_call_mode: "inbound_callback",
    },
  };
}
