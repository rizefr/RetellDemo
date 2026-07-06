import express from "express";
import { env } from "../config/env";
import {
  clearInboundAdminCookie,
  createInboundAdminCookie,
  isAuthorizedInboundAdmin,
  requireInboundAdmin,
  requireTrustedInboundBrowserOrigin,
} from "../services/inboundAuth";
import { getInboundStatus } from "../services/inboundStatus";

export const inboundApiRouter = express.Router();

function requestBaseUrl(req: express.Request): string {
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol;
  return `${protocol}://${req.get("host")}`;
}

function sendError(res: express.Response, error: unknown) {
  res.status(400).json({ error: error instanceof Error ? error.message : "Inbound request failed" });
}

inboundApiRouter.post("/auth/login", (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  if (!isAuthorizedInboundAdmin({ authorization: `Bearer ${token}` }, env.INBOUND_ADMIN_TOKEN)) {
    res.status(401).json({ error: "Invalid admin token" });
    return;
  }
  res.setHeader("Set-Cookie", createInboundAdminCookie(env.INBOUND_ADMIN_TOKEN));
  res.json({ authenticated: true });
});

inboundApiRouter.post("/auth/logout", (_req, res) => {
  res.setHeader("Set-Cookie", clearInboundAdminCookie());
  res.json({ authenticated: false });
});

inboundApiRouter.use(requireInboundAdmin);
inboundApiRouter.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  requireTrustedInboundBrowserOrigin(req, res, next);
});

inboundApiRouter.get("/status", async (req, res) => {
  try {
    res.json(await getInboundStatus(requestBaseUrl(req)));
  } catch (error) {
    sendError(res, error);
  }
});

inboundApiRouter.get("/calls", async (req, res) => {
  try {
    const status = await getInboundStatus(requestBaseUrl(req));
    res.json(status.recent);
  } catch (error) {
    sendError(res, error);
  }
});
