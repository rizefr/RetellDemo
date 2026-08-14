import express from "express";
import path from "node:path";

const pageByHost = new Map([
  ["answer.elixis.agency", "answer"],
  ["nevermiss.elixis.agency", "nevermiss"],
  ["pestline.elixis.agency", "pestline"],
  ["hear.elixis.agency", "hear"],
]);

const privatePreviewPaths = new Set([
  "/answer",
  "/answer/",
  "/nevermiss",
  "/nevermiss/",
  "/pestline",
  "/pestline/",
  "/hear",
  "/hear/",
]);

function requestHostname(req: express.Request): string {
  const host = String(req.get("host") || "").trim().toLowerCase();
  if (!host) return "";
  if (host.startsWith("[")) {
    const closingBracket = host.indexOf("]");
    return closingBracket > 1 ? host.slice(1, closingBracket) : "";
  }
  return host.split(":", 1)[0].replace(/\.$/, "");
}

export const landingHostPageRouter = express.Router();

export function landingPreviewPathGuard(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const isProduction = process.env.VERCEL_ENV === "production";
  const isPageRequest = req.method === "GET" || req.method === "HEAD";
  if (!isProduction || !isPageRequest || !privatePreviewPaths.has(req.path)) {
    next();
    return;
  }

  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.status(404).json({ error: "Not found" });
}

landingHostPageRouter.use((req, res, next) => {
  if ((req.method !== "GET" && req.method !== "HEAD") || req.path !== "/") {
    next();
    return;
  }

  const page = pageByHost.get(requestHostname(req));
  if (!page) {
    next();
    return;
  }

  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  res.sendFile(path.join(process.cwd(), "public", page, "index.html"));
});
