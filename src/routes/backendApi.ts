import express from "express";
import { env } from "../config/env";
import {
  clearBackendAdminCookie,
  createBackendAdminCookie,
  describeBackendAuthState,
  requireBackendAdmin,
} from "../services/backendAuth";
import { getBackendNavigation, getBackendStatus } from "../services/backendStatus";
import {
  clearOutboundAdminCookie,
  createOutboundAdminCookie,
  isAuthorizedOutboundAdmin,
} from "../services/outboundAuth";

export const backendApiRouter = express.Router();

function requestBaseUrl(req: express.Request): string {
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol;
  return `${protocol}://${req.get("host")}`;
}

function sendError(res: express.Response, error: unknown) {
  res.status(400).json({ error: error instanceof Error ? error.message : "Backend request failed" });
}

backendApiRouter.post("/auth/login", (req, res) => {
  if (!env.OUTBOUND_ADMIN_TOKEN) {
    res.status(503).json({ error: "Backend admin token is not configured" });
    return;
  }

  const token = typeof req.body?.token === "string" ? req.body.token : "";
  if (!token) {
    res.status(400).json({ error: "Missing admin token" });
    return;
  }

  if (!isAuthorizedOutboundAdmin({ authorization: `Bearer ${token}` }, env.OUTBOUND_ADMIN_TOKEN)) {
    res.status(401).json({ error: "Wrong admin token" });
    return;
  }

  res.setHeader("Set-Cookie", [
    createBackendAdminCookie(env.OUTBOUND_ADMIN_TOKEN),
    createOutboundAdminCookie(env.OUTBOUND_ADMIN_TOKEN),
  ]);
  res.json({ authenticated: true });
});

backendApiRouter.post("/auth/logout", (_req, res) => {
  res.setHeader("Set-Cookie", [clearBackendAdminCookie(), clearOutboundAdminCookie()]);
  res.json({ authenticated: false });
});

backendApiRouter.get("/session", (req, res) => {
  res.json(describeBackendAuthState(req.headers));
});

backendApiRouter.use(requireBackendAdmin);

backendApiRouter.get("/navigation", (_req, res) => {
  res.json(getBackendNavigation());
});

backendApiRouter.get("/status", async (req, res) => {
  try {
    res.json(await getBackendStatus(requestBaseUrl(req)));
  } catch (error) {
    sendError(res, error);
  }
});
