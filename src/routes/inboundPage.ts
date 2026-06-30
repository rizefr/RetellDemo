import express from "express";
import path from "node:path";
import { requireInboundAdminPage } from "../services/inboundAuth";

export const inboundPageRouter = express.Router();

const inboundAdminPage = path.resolve(__dirname, "../../web/inbound.html");

inboundPageRouter.get("/inbound", requireInboundAdminPage, (_req, res) => {
  res.sendFile(inboundAdminPage);
});
