import { describe, expect, it } from "vitest";
import {
  createInboundAdminCookie,
  isAuthorizedInboundAdmin,
  verifyInboundAdminCookie,
} from "../services/inboundAuth";

describe("inbound admin auth", () => {
  it("authorizes bearer token and signed cookie independently from outbound auth", () => {
    const token = "inbound-test-token";
    const now = new Date();
    const cookie = createInboundAdminCookie(token, now, false);
    const cookieValue = cookie.match(/inbound_admin=([^;]+)/)?.[1] ?? "";
    const cookieHeader = `inbound_admin=${cookieValue}`;

    expect(cookieValue).not.toBe("");
    expect(isAuthorizedInboundAdmin({ authorization: `Bearer ${token}` }, token)).toBe(true);
    expect(verifyInboundAdminCookie(cookieValue, token, new Date(now.getTime() + 5 * 60 * 1000))).toBe(true);
    expect(isAuthorizedInboundAdmin({ cookie: cookieHeader }, token)).toBe(true);
    expect(isAuthorizedInboundAdmin({ authorization: "Bearer wrong" }, token)).toBe(false);
  });
});
