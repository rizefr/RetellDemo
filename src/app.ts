import express from "express";
import path from "node:path";
import { healthRouter } from "./routes/health";
import { retellWebhookRouter } from "./routes/retellWebhook";
import { toolsRouter } from "./routes/tools";

export function createApp() {
  const app = express();

  app.use("/retell/webhook", express.raw({ type: "application/json" }), retellWebhookRouter);
  app.use(express.json({ limit: "1mb" }));

  app.use("/health", healthRouter);
  app.use("/tools", toolsRouter);
  app.use(express.static(path.join(process.cwd(), "public")));

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}
