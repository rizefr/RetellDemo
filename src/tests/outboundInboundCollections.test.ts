import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { afterEach, vi } from "vitest";
import request from "supertest";
import { sign } from "retell-sdk";
import { buildInboundCollectionsConversationFlow } from "../retell/inboundCollectionsConversationFlow";
import {
  chooseInboundCollectionsMatch,
  type InboundCollectionsCandidate,
} from "../services/outboundInboundCollections";

const candidate = (overrides: Partial<InboundCollectionsCandidate> = {}): InboundCollectionsCandidate => ({
  customerId: "00000000-0000-4000-8000-000000000001",
  invoiceId: "00000000-0000-4000-8000-000000000002",
  firstName: "Pat",
  lastName: "Morgan",
  accountCompanyName: "Morgan Property Group",
  phoneNumber: "+13475550123",
  email: "pat@example.com",
  preferredEmail: "billing@example.com",
  externalInvoiceId: "PIN-1001",
  ...overrides,
});

describe("inbound collections identity matching", () => {
  it("verifies a unique phone-and-name match", () => {
    expect(
      chooseInboundCollectionsMatch(
        [candidate()],
        {
          firstName: "pat",
          lastName: "morgan",
          callingPhoneNumber: "+13475550123",
        },
      ),
    ).toMatchObject({ status: "verified", candidate: { externalInvoiceId: "PIN-1001" } });
  });

  it("does not disclose invoice context from a name alone", () => {
    expect(
      chooseInboundCollectionsMatch(
        [candidate()],
        {
          firstName: "Pat",
          lastName: "Morgan",
          callingPhoneNumber: "+19175550199",
        },
      ),
    ).toEqual({ status: "needs_verification" });
  });

  it("accepts a name plus a trusted invoice or email corroborator", () => {
    expect(
      chooseInboundCollectionsMatch(
        [candidate()],
        {
          firstName: "Pat",
          lastName: "Morgan",
          callingPhoneNumber: "+19175550199",
          invoiceId: "pin-1001",
        },
      ).status,
    ).toBe("verified");
    expect(
      chooseInboundCollectionsMatch(
        [candidate()],
        {
          firstName: "Pat",
          lastName: "Morgan",
          callingPhoneNumber: "+19175550199",
          email: "PAT@EXAMPLE.COM",
        },
    ).status,
    ).toBe("verified");
    expect(
      chooseInboundCollectionsMatch(
        [candidate()],
        {
          firstName: "Pat",
          lastName: "Morgan",
          callingPhoneNumber: "+19175550199",
          email: "BILLING@EXAMPLE.COM",
        },
      ).status,
    ).toBe("verified");
  });

  it("refuses ambiguous matches", () => {
    expect(
      chooseInboundCollectionsMatch(
        [candidate(), candidate({ customerId: "00000000-0000-4000-8000-000000000003" })],
        {
          firstName: "Pat",
          lastName: "Morgan",
          callingPhoneNumber: "+13475550123",
        },
      ),
    ).toEqual({ status: "ambiguous" });
  });
});

describe("inbound collections Conversation Flow", () => {
  it("starts with caller identification and only reveals invoice details after verified lookup", () => {
    const flow = buildInboundCollectionsConversationFlow("https://example.com");
    const serialized = JSON.stringify(flow);
    expect(flow.start_speaker).toBe("agent");
    expect(flow.start_node_id).toBe("inbound_collections_agent");
    expect(serialized).toContain("Hi, you've reached the invoice follow-up line for {{business_name_spoken}}. May I get your first and last name?");
    expect(serialized).toContain('"name":"lookup_inbound_account"');
    expect(serialized).toContain("Do not disclose an invoice amount, date, number, inspection type, customer email, or customer phone until lookup_inbound_account returns verified=true");
    expect(serialized).toContain("phone plus name");
    expect(serialized).toContain("Is there anything else I can help you with?");
    expect(serialized).toContain('"type":"end_call"');
    expect(serialized).not.toContain('"args_at_root":true');
  });

  it("keeps the existing payment, callback, email, SMS-disabled, and terminal tools", () => {
    const flow = buildInboundCollectionsConversationFlow("https://example.com");
    const names = (flow.tools ?? []).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([
      "lookup_inbound_account",
      "log_outcome",
      "create_payment_link",
      "send_payment_sms",
      "send_payment_email",
      "request_human_transfer",
      "schedule_followup",
      "schedule_callback",
    ]));
  });
});

describe("inbound collections schema and voicemail guards", () => {
  it("contains additive inbound IDs, inbound call direction, RLS, and no browser policies", () => {
    const migration = fs.readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/20260813_outbound_inbound_collections.sql"),
      "utf8",
    );
    expect(migration).toContain("inbound_retell_agent_id");
    expect(migration).toContain("inbound_retell_conversation_flow_id");
    expect(migration).toContain("direction in ('outbound', 'inbound')");
    expect(migration).toContain("voicemail_message_left");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on public.outbound_businesses from anon, authenticated");
    expect(migration).not.toMatch(/^create policy/gm);
  });

  it("configures a short static outbound voicemail with the callback number", () => {
    const setupScript = fs.readFileSync(
      path.resolve(process.cwd(), "src/scripts/setupOutboundRetell.ts"),
      "utf8",
    );
    expect(setupScript).toContain('type: "static_text"');
    expect(setupScript).toContain('version: "latest_published"');
    expect(setupScript).toContain("nine eight four, two zero seven, five three four six");
    expect(setupScript).not.toContain('voicemail_option: { action: { type: "hangup" } }');
  });

  it("requires explicit creation and directional-binding confirmations without purchasing numbers", () => {
    const createScript = fs.readFileSync(
      path.resolve(process.cwd(), "src/scripts/setupInboundCollectionsRetell.ts"),
      "utf8",
    );
    const bindScript = fs.readFileSync(
      path.resolve(process.cwd(), "src/scripts/bindCollectionsPhoneDirections.ts"),
      "utf8",
    );
    const updateScript = fs.readFileSync(
      path.resolve(process.cwd(), "src/scripts/updateInboundCollectionsRetell.ts"),
      "utf8",
    );
    expect(createScript).toContain("CONFIRM_CREATE_RETELL_INBOUND_COLLECTIONS_AGENT");
    expect(createScript).toContain("OUTBOUND_RETELL_AGENT_ID");
    expect(createScript).toContain('version: "latest_published"');
    expect(createScript).not.toContain("agent.list(");
    expect(bindScript).toContain("I AUTHORIZE DIRECTIONAL COLLECTIONS BINDING");
    expect(bindScript).toContain("inbound_agents");
    expect(bindScript).toContain("outbound_agents");
    expect(bindScript).toContain("/api/outbound/webhooks/retell/inbound-call");
    expect(bindScript).toContain("+18887809963");
    expect(bindScript).not.toContain("phoneNumber.create");
    expect(bindScript).not.toContain("phoneNumber.delete");
    expect(updateScript).toContain("CONFIRM_UPDATE_RETELL_INBOUND_COLLECTIONS_AGENT");
    expect(updateScript).toContain("INBOUND_COLLECTIONS_RETELL_AGENT_ID");
    expect(updateScript).toContain("INBOUND_COLLECTIONS_RETELL_CONVERSATION_FLOW_ID");
    expect(updateScript).toContain('version: "latest_published"');
    expect(updateScript).not.toContain("agent.create(");
    expect(updateScript).not.toContain("conversationFlow.create(");
  });

  it("loads provider scripts from an explicit dotenv path and checks preferred contact email", () => {
    const envSource = fs.readFileSync(path.resolve(process.cwd(), "src/config/env.ts"), "utf8");
    const repositorySource = fs.readFileSync(
      path.resolve(process.cwd(), "src/services/outboundRepository.ts"),
      "utf8",
    );
    expect(envSource).toContain("DOTENV_CONFIG_PATH");
    expect(repositorySource).toContain('.ilike("preferred_email"');
  });
});

describe("signed inbound collections routes", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) delete process.env[key];
    });
    Object.assign(process.env, originalEnv);
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("returns the configured inbound collections agent from the signed phone webhook", async () => {
    process.env.NODE_ENV = "test";
    process.env.RETELL_API_KEY = "retell-inbound-key";
    vi.doMock("../services/outboundRepository", async () => {
      const actual = await vi.importActual<typeof import("../services/outboundRepository")>(
        "../services/outboundRepository",
      );
      return {
        ...actual,
        getOutboundBusinessByCallbackNumber: vi.fn().mockResolvedValue({
          id: "00000000-0000-4000-8000-000000000001",
          business_name: "Pinnacle Elevator Solutions",
          agent_display_name: "Paul",
          inbound_retell_agent_id: "agent_inbound_collections",
          inbound_retell_conversation_flow_id: "flow_inbound_collections",
        }),
        insertOutboundEvent: vi.fn().mockResolvedValue({}),
      };
    });
    vi.resetModules();
    const { createApp } = await import("../app");
    const payload = JSON.stringify({
      event: "call_inbound",
      call_inbound: {
        agent_id: "agent_inbound_collections",
        from_number: "+13475550123",
        to_number: "+19842075346",
      },
    });
    const signature = await sign(payload, "retell-inbound-key");
    const response = await request(createApp())
      .post("/api/outbound/webhooks/retell/inbound-call")
      .set("content-type", "application/json")
      .set("x-retell-signature", signature)
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body.call_inbound).toMatchObject({
      override_agent_id: "agent_inbound_collections",
      override_agent_version: "latest_published",
      dynamic_variables: {
        business_name: "Pinnacle Elevator Solutions",
        business_name_spoken: "Pinnacle Elevator Solutions",
        agent_display_name: "Paul",
      },
      metadata: {
        business_id: "00000000-0000-4000-8000-000000000001",
        direction: "inbound_collections",
      },
    });
  });

  it("creates a trusted inbound call attempt only after verified lookup", async () => {
    process.env.NODE_ENV = "test";
    process.env.RETELL_API_KEY = "retell-inbound-key";
    const createOutboundCallAttempt = vi.fn().mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000004",
    });
    vi.doMock("../services/outboundRepository", async () => {
      const actual = await vi.importActual<typeof import("../services/outboundRepository")>(
        "../services/outboundRepository",
      );
      return {
        ...actual,
        getOutboundBusinessSettings: vi.fn().mockResolvedValue({
          id: "00000000-0000-4000-8000-000000000001",
          business_name: "Pinnacle Elevator Solutions",
          inbound_retell_agent_id: "agent_inbound_collections",
          payment_provider: "stripe",
        }),
        findInboundCollectionsCandidates: vi.fn().mockResolvedValue([candidate()]),
        getOutboundInvoiceContext: vi.fn().mockResolvedValue({
          invoice: {
            id: "00000000-0000-4000-8000-000000000002",
            invoice_id: "PIN-1001",
            status: "unpaid",
            inspection_type: "Category 1",
            inspection_date: "2026-07-01",
            original_due_date: "2026-07-15",
            amount_due_cents: 48000,
            currency: "usd",
          },
          customer: {
            id: "00000000-0000-4000-8000-000000000001",
            first_name: "Pat",
            last_name: "Morgan",
            account_company_name: "Morgan Property Group",
            phone_number: "+13475550123",
            email: "pat@example.com",
            timezone: "America/New_York",
          },
          business: {
            id: "00000000-0000-4000-8000-000000000001",
            business_name: "Pinnacle Elevator Solutions",
            payment_provider: "stripe",
          },
          account: { openInvoiceCount: 1, totalAmountDueCents: 48000 },
        }),
        findOutboundCallAttempt: vi.fn().mockResolvedValue(null),
        nextOutboundAttemptNumber: vi.fn().mockResolvedValue(1),
        createOutboundCallAttempt,
        insertOutboundEvent: vi.fn().mockResolvedValue({}),
      };
    });
    vi.resetModules();
    const { createApp } = await import("../app");
    const payload = JSON.stringify({
      name: "lookup_inbound_account",
      args: { first_name: "Pat", last_name: "Morgan" },
      call: {
        call_id: "call_inbound_verified",
        agent_id: "agent_inbound_collections",
        from_number: "+13475550123",
        to_number: "+19842075346",
        start_timestamp: Date.parse("2026-08-13T12:00:00Z"),
        metadata: {
          business_id: "00000000-0000-4000-8000-000000000001",
          direction: "inbound_collections",
        },
      },
    });
    const signature = await sign(payload, "retell-inbound-key");
    const response = await request(createApp())
      .post("/api/outbound/retell/lookup-inbound-account")
      .set("content-type", "application/json")
      .set("x-retell-signature", signature)
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "verified",
      verified: true,
      customer_first_name_spoken: "Pat",
      inspection_type: "Category 1",
      inspection_date_spoken: "July first, twenty twenty-six",
      amount_due_spoken: "four hundred eighty dollars",
    });
    expect(createOutboundCallAttempt).toHaveBeenCalledWith(expect.objectContaining({
      direction: "inbound",
      retell_call_id: "call_inbound_verified",
      from_number: "+13475550123",
      to_number: "+19842075346",
    }));
  });
});
