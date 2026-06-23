import { randomBytes } from "node:crypto";
import { env } from "../config/env";

const QUICKBOOKS_AUTH_BASE = "https://appcenter.intuit.com/connect/oauth2";
const QUICKBOOKS_SCOPES = "com.intuit.quickbooks.accounting";

export function outboundQuickBooksEnvStatus() {
  return {
    client_id_configured: Boolean(env.QUICKBOOKS_CLIENT_ID),
    client_secret_configured: Boolean(env.QUICKBOOKS_CLIENT_SECRET),
    redirect_uri_configured: Boolean(env.QUICKBOOKS_REDIRECT_URI),
    environment: env.QUICKBOOKS_ENVIRONMENT,
    configured: Boolean(env.QUICKBOOKS_CLIENT_ID && env.QUICKBOOKS_CLIENT_SECRET && env.QUICKBOOKS_REDIRECT_URI),
  };
}

export function buildOutboundQuickBooksStatus(business: Record<string, unknown>) {
  const envStatus = outboundQuickBooksEnvStatus();
  return {
    provider: String(business.payment_provider || "stripe"),
    configured: envStatus.configured,
    environment: String(business.quickbooks_environment || envStatus.environment),
    connected: Boolean(business.quickbooks_connected),
    realm_id_present: Boolean(business.quickbooks_realm_id),
    access_token_present: Boolean(business.quickbooks_access_token_present),
    refresh_token_present: Boolean(business.quickbooks_refresh_token_present),
    env: envStatus,
  };
}

export function buildOutboundQuickBooksConnectUrl(businessId: string): string {
  if (!outboundQuickBooksEnvStatus().configured) {
    throw new Error("QuickBooks OAuth is not configured");
  }
  const url = new URL(QUICKBOOKS_AUTH_BASE);
  url.searchParams.set("client_id", env.QUICKBOOKS_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.QUICKBOOKS_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", QUICKBOOKS_SCOPES);
  url.searchParams.set("state", `${businessId}.${randomBytes(16).toString("hex")}`);
  return url.toString();
}
