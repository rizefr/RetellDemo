import { Router } from "express";
import { env, isProduction } from "../config/env";
import { isSupabaseConfigured } from "../services/supabase";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "retell-pest-control-demo",
    environment: isProduction() ? "production" : env.NODE_ENV,
    supabase_configured: isSupabaseConfigured(),
    sms_mode: env.SMS_MODE,
    calendar_provider: env.CALENDAR_PROVIDER,
  });
});
