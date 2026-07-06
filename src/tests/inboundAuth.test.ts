import { describe, expect, it } from "vitest";
import {
  createInboundAdminCookie,
  isAuthorizedInboundAdmin,
  verifyInboundAdminCookie,
} from "../services/inboundAuth";

describe("inbound admin auth", () => {
  it("authorizes bearer token and signed cookie independently from outbound auth", () => {
    const token = "inbound-test-token";
    const issuedAt = new Date();
    const checkedAt = new Date(issuedAt.getTime() + 5 * 60 * 1000);
    const cookie = createInboundAdminCookie(token, issuedAt, false);
    const cookieValue = cookie.match(/inbound_admin=([^;]+)/)?.[1] ?? "";

    expect(isAuthorizedInboundAdmin({ authorization: `Bearer ${token}` }, token)).toBe(true);
    expect(verifyInboundAdminCookie(cookieValue, token, checkedAt)).toBe(true);
    expect(isAuthorizedInboundAdmin({ cookie }, token)).toBe(true);
    expect(isAuthorizedInboundAdmin({ authorization: "Bearer wrong" }, token)).toBe(false);
  });
});
