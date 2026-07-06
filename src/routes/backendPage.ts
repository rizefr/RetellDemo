import express from "express";
import path from "node:path";
import { requireBackendAdminPage } from "../services/backendAuth";

export const backendPageRouter = express.Router();

const backendPage = path.resolve(__dirname, "../../web/backend.html");
const docs = new Map([
  ["README_backend.md", path.resolve(__dirname, "../../README_backend.md")],
  ["README_outbound.md", path.resolve(__dirname, "../../README_outbound.md")],
  ["README_INBOUND.md", path.resolve(__dirname, "../../README_INBOUND.md")],
  ["README_WEBSITE.md", path.resolve(__dirname, "../../README_WEBSITE.md")],
]);

backendPageRouter.get("/backend", requireBackendAdminPage, (_req, res) => {
  res.sendFile(backendPage);
});

backendPageRouter.get("/backend/docs/:doc", requireBackendAdminPage, (req, res) => {
  const docName = Array.isArray(req.params.doc) ? req.params.doc[0] : req.params.doc;
  const docPath = docs.get(docName);
  if (!docPath) {
    res.status(404).json({ error: "Backend doc not found" });
    return;
  }
  res.type("text/markdown").sendFile(docPath);
});
