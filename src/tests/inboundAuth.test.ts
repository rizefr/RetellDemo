import { describe, expect, it } from "vitest";
import {
  createInboundAdminCookie,
  isAuthorizedInboundAdmin,
  verifyInboundAdminCookie,
} from "../services/inboundAuth";

describe("inbound admin auth", () => {
  it("authorizes bearer token and signed cookie independently from outbound auth", () => {
    const token = "inbound-test-token";
    const cookie = createInboundAdminCookie(token, new Date("2026-06-01T12:00:00Z"), false);
    const cookieValue = cookie.match(/inbound_admin=([^;]+)/)?.[1] ?? "";

    expect(isAuthorizedInboundAdmin({ authorization: `Bearer ${token}` }, token)).toBe(true);
    expect(verifyInboundAdminCookie(cookieValue, token, new Date("2026-06-01T12:05:00Z"))).toBe(true);
    expect(isAuthorizedInboundAdmin({ cookie }, token)).toBe(true);
    expect(isAuthorizedInboundAdmin({ authorization: "Bearer wrong" }, token)).toBe(false);
  });
});
