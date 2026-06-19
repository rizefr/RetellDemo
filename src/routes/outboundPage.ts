import express from "express";
import path from "node:path";
import { requireOutboundAdminPage } from "../services/outboundAuth";

export const outboundPageRouter = express.Router();

const paymentSuccessPage = path.resolve(__dirname, "../../web/outbound-payment-success.html");
const paymentCancelledPage = path.resolve(__dirname, "../../web/outbound-payment-cancelled.html");
const outboundAdminPage = path.resolve(__dirname, "../../web/outbound.html");

outboundPageRouter.get("/outbound/payment/success", (_req, res) => {
  res.sendFile(paymentSuccessPage);
});

outboundPageRouter.get("/outbound/payment/cancelled", (_req, res) => {
  res.sendFile(paymentCancelledPage);
});

outboundPageRouter.get("/outbound", requireOutboundAdminPage, (_req, res) => {
  res.sendFile(outboundAdminPage);
});
