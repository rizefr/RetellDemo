import { describe, expect, it } from "vitest";
import { buildOutboundConversationFlow } from "../retell/outboundConversationFlow";
import { buildInboundCollectionsConversationFlow } from "../retell/inboundCollectionsConversationFlow";

describe("collections native tool and terminal boundaries", () => {
  const outbound = buildOutboundConversationFlow("https://example.test");
  const inbound = buildInboundCollectionsConversationFlow("https://example.test");
  it("uses Retell dot paths so tool results replace initial dynamic variables", () => {
    for (const flow of [outbound, inbound]) {
      for (const tool of flow.tools || []) {
        if (!("response_variables" in tool)) continue;
        for (const path of Object.values(tool.response_variables || {})) {
          expect(path).toMatch(/^[A-Za-z_][A-Za-z0-9_.[\]]*$/);
          expect(path).not.toMatch(/^\$\./);
        }
      }
      expect(flow.tools?.find(tool => tool.name === "schedule_followup")).toMatchObject({response_variables:{resolved_expected_payment_date_spoken:"expected_payment_date_spoken"}});
    }
    expect(inbound.tools?.find(tool => tool.name === "lookup_inbound_account")).toMatchObject({response_variables:{inbound_lookup_verified:"verified",payment_provider:"payment_provider",quickbooks_connected:"quickbooks_connected"}});
  });
  it("makes full readback and separate confirmation the only email-send route", () => {
    for (const flow of [outbound, inbound]) {
      const main = flow.nodes.find(n => n.id === "outbound_collections_agent");
      expect(main).toMatchObject({ tool_ids: expect.not.arrayContaining(["outbound_send_payment_email", "outbound_create_payment_link"]) });
      for (const id of ["outbound_email_confirmation", "outbound_email_phonetic_confirmation"]) {
        const node = flow.nodes.find(n => n.id === id);
        expect(node).toMatchObject({ type: "conversation", instruction: { type: "static_text" }, edges: expect.arrayContaining([
          expect.objectContaining({ destination_node_id: "outbound_email_create_link", transition_condition: { type: "prompt", prompt: expect.stringContaining("NEW separate answer") } }),
        ]) });
        expect(node).not.toHaveProperty("tool_ids");
      }
      for (const id of ["outbound_email_create_link", "outbound_email_send_confirmed"]) expect(flow.nodes.find(n => n.id === id)).toMatchObject({ type: "function", wait_for_result: true, else_edge: { destination_node_id: "outbound_email_delivery_unavailable" } });
      expect(flow.nodes.find(n => n.id === "outbound_email_contact_correction")).toMatchObject({ tool_ids: ["outbound_log_outcome"] });
      expect(flow.tools?.find(t => t.name === "send_payment_email")).toMatchObject({ parameters: { required: ["recipient_confirmed", "confirmed_email"] } });
      expect(flow.nodes.find(n => n.id === "outbound_normal_terminal_final_check")).toMatchObject({ edges: expect.arrayContaining([expect.objectContaining({ destination_node_id: "outbound_email_confirmation" })]) });
    }
  });
  it("records date refusal without another question or invented promise", () => {
    expect(outbound.nodes.find(n => n.id === "outbound_no_payment_date_function")).toMatchObject({ type: "function", instruction: { text: expect.stringContaining("omit expected_payment_date_phrase") }, else_edge: { destination_node_id: "outbound_no_payment_date_end" } });
    expect(outbound.nodes.find(n => n.id === "outbound_no_payment_date_end")?.type).toBe("end");
    expect(outbound.nodes.find(n => n.id === "outbound_expected_payment_date_clarification")).toMatchObject({ edges: expect.arrayContaining([expect.objectContaining({ destination_node_id: "outbound_no_payment_date_function" })]) });
  });
  it("persists confirmed callback before result-gated native close", () => {
    expect(outbound.nodes.find(n => n.id === "outbound_callback_confirm_function")).toMatchObject({ type: "function", wait_for_result: true, instruction: { text: expect.stringContaining("confirmed=true") }, else_edge: { destination_node_id: "outbound_callback_result_end" } });
    expect(outbound.nodes.find(n => n.id === "outbound_callback_result_end")).toMatchObject({ type: "end", instruction: { text: expect.stringContaining("Only if scheduled is true") } });
  });
  it("ends unverified callbacks without account-bound logging or a third identity request", () => {
    const node = inbound.nodes.find(n => n.id === "inbound_identity_unverified_explanation");
    expect(node).toMatchObject({ type: "end", instruction: { type: "static_text" } });
    expect(node).not.toHaveProperty("tool_ids");
    expect(inbound.nodes.find(n => n.id === "inbound_identity_retry_lookup_function")).toMatchObject({ else_edge: { destination_node_id: "inbound_identity_unverified_explanation" } });
  });
  it("answers bundled AI questions before lookup without disclosing invoice values", () => {
    const node = inbound.nodes.find(n => n.id === "inbound_identity_ai_answer");
    expect(node).toMatchObject({ type: "conversation", skip_response_edge: { destination_node_id: "inbound_identity_lookup_function" } });
    expect(JSON.stringify(node)).not.toMatch(/amount_due|customer_email|invoice_id_spoken/);
  });
  it("isolates signed-number opt-outs to the callback agent and gates the success claim", () => {
    expect(outbound.tools?.some(t => t.name === "suppress_inbound_caller")).toBe(false);
    expect(inbound.tools?.find(t => t.name === "suppress_inbound_caller")).toMatchObject({ url: "https://example.test/api/outbound/retell/suppress-inbound-caller", parameters: { required: ["explicit_opt_out"] } });
    expect(inbound.nodes.find(n => n.id === "inbound_suppress_caller_function")).toMatchObject({ type: "function", wait_for_result: true, tool_id: "outbound_suppress_inbound_caller" });
    expect(inbound.nodes.find(n => n.id === "inbound_suppression_result_end")).toMatchObject({ type: "end", instruction: { text: expect.stringContaining("Only if suppressed=true") } });
    expect(inbound.tools?.find(t => t.name === "lookup_inbound_account")).toMatchObject({ response_variables: { quickbooks_connected: "quickbooks_connected", manual_payment_followup_required: "manual_payment_followup_required", customer_email_display: "customer_email_display", customer_email_spoken_phonetic: "customer_email_spoken_phonetic", email_on_file: "email_on_file" } });
  });
});
