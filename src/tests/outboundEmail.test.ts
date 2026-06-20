import { describe, expect, it, vi } from "vitest";
import {
  deliverOutboundPaymentEmail,
  ResendOutboundEmailProvider,
  type OutboundEmailProvider,
  type OutboundPaymentEmail,
} from "../services/outboundEmail";

const message: OutboundPaymentEmail = {
  to: "demo@example.test",
  from: "billing@elixis.agency",
  businessName: "Elixis Elevator Systems",
  invoiceNumber: "ELV-TEST",
  serviceDescription: "annual elevator inspection",
  amount: "$150.00",
  paymentUrl: "https://checkout.stripe.test/session",
  callbackNumber: "+19842075346",
  dueDate: "May 20, 2026",
};

describe("outbound payment email", () => {
  it("returns a controlled manual status when sending is disabled", async () => {
    const provider: OutboundEmailProvider = { send: vi.fn() };
    const result = await deliverOutboundPaymentEmail(message, {
      enabled: false,
      providerName: "none",
      provider,
    });

    expect(result).toEqual({ sent: false, status: "email_pending_manual", provider_message_id: null });
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("reports provider failures without claiming the email was sent", async () => {
    const provider: OutboundEmailProvider = {
      send: vi.fn().mockRejectedValue(new Error("provider unavailable")),
    };
    const result = await deliverOutboundPaymentEmail(message, {
      enabled: true,
      providerName: "resend",
      provider,
    });

    expect(result).toEqual({ sent: false, status: "email_failed", provider_message_id: null });
  });

  it("returns success only after the configured provider succeeds", async () => {
    const provider: OutboundEmailProvider = {
      send: vi.fn().mockResolvedValue({ id: "email_test_1" }),
    };
    const result = await deliverOutboundPaymentEmail(message, {
      enabled: true,
      providerName: "resend",
      provider,
    });

    expect(result).toEqual({ sent: true, status: "email_sent", provider_message_id: "email_test_1" });
    expect(provider.send).toHaveBeenCalledWith(message);
  });

  it("sends only the expected safe payload and keeps the API key out of the body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "email_test_2" }),
    });
    const provider = new ResendOutboundEmailProvider("resend-test-secret", fetchImpl as unknown as typeof fetch);

    await expect(provider.send(message)).resolves.toEqual({ id: "email_test_2" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(request.headers).toMatchObject({ authorization: "Bearer resend-test-secret" });
    expect(String(request.body)).not.toContain("resend-test-secret");
    expect(JSON.parse(String(request.body))).toMatchObject({
      from: message.from,
      to: [message.to],
      subject: "Elixis Elevator Systems invoice ELV-TEST",
    });
  });
});
