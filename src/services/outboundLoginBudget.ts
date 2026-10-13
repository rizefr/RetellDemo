import type { Response } from "express";
import { env } from "../config/env";
import { getSupabaseClient } from "./supabase";

// Token attempts share a durable budget across both login routes and server
// instances, before token comparison. No token or visitor address is stored.
// Existing authenticated sessions and provider callbacks are unaffected.
let localWindow = { started: 0, attempts: 0 };
export async function outboundLoginBudget() {
  const client = getSupabaseClient();
  if (!client) {
    if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
      throw new Error("Login protection unavailable");
    }
    const now = Date.now();
    if (now - localWindow.started >= 60_000) localWindow = { started: now, attempts: 0 };
    localWindow.attempts += 1;
    return { allowed: localWindow.attempts <= 20, retry_after_seconds: 60 };
  }
  const { data, error } = await client.rpc("outbound_record_admin_login_attempt");
  if (error || !data || typeof data.allowed !== "boolean" ||
      !Number.isInteger(data.retry_after_seconds) || data.retry_after_seconds < 1 || data.retry_after_seconds > 60) {
    throw new Error("Login protection unavailable");
  }
  return data as { allowed: boolean; retry_after_seconds: number };
}

export async function enforceOutboundLoginBudget(res: Response): Promise<boolean> {
  res.setHeader("Cache-Control", "no-store");
  try {
    const budget = await outboundLoginBudget();
    if (!budget.allowed) {
      res.setHeader("Retry-After", String(budget.retry_after_seconds));
      res.status(429).json({ error: "Too many sign-in attempts. Please wait a minute." });
      return false;
    }
    return true;
  } catch {
    res.status(503).json({ error: "Sign-in protection is temporarily unavailable." });
    return false;
  }
}
