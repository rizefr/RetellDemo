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
    text: "Identity has already been verified by the inbound identity node. On entry, continue naturally with: Got it, {{customer_first_name_spoken}}. I found the account. Our records show the {{inspection_type}} invoice from {{inspection_date_spoken}} is overdue. Were you able to receive it? Do not use the outbound opening, ask for identity again, or restart the conversation. Then preserve the existing invoice, payment, expected-payment-date, final-check, wrong-number, and hard-terminal routes.",
  };
  const identityNode: ConversationFlowCreateParams.SubagentNode = {
    id: "inbound_identity_agent",
    type: "subagent",
    name: "Inbound caller identity verification",
    instruction: {
      type: "prompt",
      text: "Ask for the caller's first and last name, then call lookup_inbound_account immediately. This node owns identity verification only. Never discuss an invoice, payment, date, amount, email, or phone from account records here. A name alone is not verified. If lookup asks for one safe corroborator, collect exactly one and call the lookup again. Once inbound_lookup_verified is true, do not speak another introduction; transition to the verified collections node. After a second failed lookup, explain that no verified open invoice can be located and transition to manual review. For an explicit stop-calling request, transition to the hard terminal node.",
    },
    tool_ids: [LOOKUP_TOOL_ID],
    edges: [
      {
        id: "inbound_identity_verified_edge",
        destination_node_id: "outbound_collections_agent",
        transition_condition: {
          type: "equation",
          equations: [
            {
              left: "{{inbound_lookup_verified}}",
              operator: "==",
              right: "true",
            },
          ],
          operator: "&&",
        },
      },
      {
        id: "inbound_identity_manual_review_edge",
        destination_node_id: "outbound_normal_terminal_final_check",
        transition_condition: {
          type: "prompt",
          prompt: "Transition only after two lookup attempts failed to verify the caller and the agent explained that no verified open invoice could be located. Do not use this before the second lookup result.",
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
        id: "inbound_identity_verified_transition_example",
        destination_node_id: "outbound_collections_agent",
        transcript: [
          { role: "agent", content: "Hi, you've reached the invoice follow-up line for {{business_name_spoken}}. May I get your first and last name?" },
          { role: "user", content: "Pat Morgan." },
          { role: "tool_call_invocation", name: "lookup_inbound_account", tool_call_id: "tool_1", arguments: "{\"first_name\":\"Pat\",\"last_name\":\"Morgan\"}" },
          { role: "tool_call_result", tool_call_id: "tool_1", content: "{\"status\":\"verified\",\"verified\":true,\"customer_first_name_spoken\":\"Pat\"}" },
        ],
      },
    ],
    finetune_conversation_examples: [
    {
      id: "inbound_verified_phone_and_name_example",
      transcript: [
        { role: "agent", content: "Hi, you've reached the invoice follow-up line for {{business_name_spoken}}. May I get your first and last name?" },
        { role: "user", content: "Pat Morgan." },
        { role: "tool_call_invocation", name: "lookup_inbound_account", tool_call_id: "tool_1", arguments: "{\"first_name\":\"Pat\",\"last_name\":\"Morgan\"}" },
        { role: "tool_call_result", tool_call_id: "tool_1", content: "{\"status\":\"verified\",\"verified\":true,\"customer_first_name_spoken\":\"Pat\",\"inspection_type\":\"Category 1\",\"inspection_date_spoken\":\"July first, twenty twenty-six\"}" },
        { role: "agent", content: "Got it, Pat. I found the account. Our records show the Category 1 invoice from July first, twenty twenty-six is overdue. Were you able to receive it?" },
      ],
    },
    {
      id: "inbound_name_only_needs_verification_example",
      transcript: [
        { role: "agent", content: "Hi, you've reached the invoice follow-up line for {{business_name_spoken}}. May I get your first and last name?" },
        { role: "user", content: "Pat Morgan." },
        { role: "tool_call_invocation", name: "lookup_inbound_account", tool_call_id: "tool_1", arguments: "{\"first_name\":\"Pat\",\"last_name\":\"Morgan\"}" },
        { role: "tool_call_result", tool_call_id: "tool_1", content: "{\"status\":\"needs_verification\",\"verified\":false}" },
        { role: "agent", content: "What company or account name is this regarding?" },
      ],
    },
    ],
    display_position: { x: -400, y: 0 },
  };

  return {
    ...outbound,
    start_node_id: "inbound_identity_agent",
    global_prompt: `${outboundPrompt.slice(0, openingStart)}${INBOUND_OPENING_AND_IDENTITY}\n${outboundPrompt.slice(discussionStart)}`,
    tools: [lookupTool(baseUrl), ...(outbound.tools ?? [])],
    nodes: [identityNode, ...nodes],
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
