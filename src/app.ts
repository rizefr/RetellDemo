import express from "express";
import path from "node:path";
import { backendApiRouter } from "./routes/backendApi";
import { backendPageRouter } from "./routes/backendPage";
import { healthRouter } from "./routes/health";
import { inboundApiRouter } from "./routes/inboundApi";
import { inboundPageRouter } from "./routes/inboundPage";
import { outboundApiRouter } from "./routes/outboundApi";
import { outboundPageRouter } from "./routes/outboundPage";
import { outboundRetellToolsRouter } from "./routes/outboundRetellTools";
import { outboundRetellWebhookRouter } from "./routes/outboundRetellWebhook";
import { outboundStripeWebhookRouter } from "./routes/outboundStripeWebhook";
import { retellWebhookRouter } from "./routes/retellWebhook";
import { toolsRouter } from "./routes/tools";

const staticAssetOptions: Parameters<typeof express.static>[1] = {
  setHeaders(res, filePath) {
    if (!/\.(?:css|js)$/i.test(filePath)) return;
    res.setHeader("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400");
  },
};

export function createApp() {
  const app = express();

  app.use(
    "/api/outbound/webhooks/stripe",
    express.raw({ type: "application/json", limit: "1mb" }),
    outboundStripeWebhookRouter,
  );
  app.use(
    "/api/outbound/webhooks/retell",
    express.raw({ type: "application/json", limit: "2mb" }),
    outboundRetellWebhookRouter,
  );
  app.use(
    "/api/outbound/retell",
    express.raw({ type: "application/json", limit: "1mb" }),
    outboundRetellToolsRouter,
  );
  app.use("/retell/webhook", express.raw({ type: "application/json" }), retellWebhookRouter);
  app.use(express.json({ limit: "2mb" }));

  app.use("/health", healthRouter);
  app.use("/tools", toolsRouter);
  app.use("/api/backend", backendApiRouter);
  app.use("/api/inbound", inboundApiRouter);
  app.use("/api/outbound", outboundApiRouter);
  app.use(backendPageRouter);
  app.use(inboundPageRouter);
  app.use(outboundPageRouter);
  app.get(["/ai-seo", "/ai-seo/"], (_req, res) => {
    res.redirect(301, "/");
  });
  app.use("/backend-assets", express.static(path.join(process.cwd(), "public", "backend"), staticAssetOptions));
  app.use("/inbound-assets", express.static(path.join(process.cwd(), "public", "inbound"), staticAssetOptions));
  app.use("/outbound-assets", express.static(path.join(process.cwd(), "public", "outbound"), staticAssetOptions));
  app.use(express.static(path.join(process.cwd(), "public"), staticAssetOptions));

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}
