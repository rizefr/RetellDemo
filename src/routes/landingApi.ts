import express from "express";
import {
  LandingStorageError,
  landingEventSchema,
  landingLeadSchema,
  recordLandingEvent,
  recordLandingLead,
} from "../services/landingPages";

export const landingApiRouter = express.Router();

type RateBucket = { startedAt: number; count: number };
const rateBuckets = new Map<string, RateBucket>();

export function resetLandingRateLimitsForTests(): void {
  rateBuckets.clear();
}

function requestKey(req: express.Request): string {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  return forwarded || req.ip || "unknown";
}

function rateLimited(req: express.Request, group: "event" | "lead", limit: number, windowMs: number): boolean {
  const now = Date.now();
  const key = `${group}:${requestKey(req)}`;
  const current = rateBuckets.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > limit;
}

function requestAllowed(req: express.Request, res: express.Response): boolean {
  res.setHeader("Cache-Control", "no-store");
  if (req.get("x-elixis-form") !== "landing-v1") {
    res.status(400).json({ error: "Missing landing-page request header" });
    return false;
  }
  if (!req.is("application/json")) {
    res.status(415).json({ error: "Use application/json" });
    return false;
  }
  if (req.get("sec-fetch-site") === "cross-site") {
    res.status(403).json({ error: "Cross-site submission blocked" });
    return false;
  }

  const origin = req.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== req.get("host")) {
        res.status(403).json({ error: "Origin does not match this site" });
        return false;
      }
    } catch {
      res.status(403).json({ error: "Invalid request origin" });
      return false;
    }
  }
  return true;
}

function validationError(res: express.Response, issues: Array<{ path: PropertyKey[] }>): void {
  const fields = [...new Set(issues.map((issue) => String(issue.path[0] || "request")))];
  res.status(422).json({ error: "Check the highlighted information and try again", fields });
}

landingApiRouter.post("/events", async (req, res) => {
  if (!requestAllowed(req, res)) return;
  if (rateLimited(req, "event", 120, 60_000)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Event rate limit reached" });
    return;
  }

  const parsed = landingEventSchema.safeParse(req.body);
  if (!parsed.success) {
    validationError(res, parsed.error.issues);
    return;
  }

  try {
    await recordLandingEvent(parsed.data);
    res.status(201).json({ recorded: true });
  } catch (error) {
    console.error("Landing-page event could not be recorded", {
      event_name: parsed.data.event_name,
      variant: parsed.data.variant,
      error: error instanceof Error ? error.message : "unknown error",
    });
    res.status(503).json({ error: "Analytics storage is temporarily unavailable" });
  }
});

landingApiRouter.post("/leads", async (req, res) => {
  if (!requestAllowed(req, res)) return;

  const parsed = landingLeadSchema.safeParse(req.body);
  if (!parsed.success) {
    validationError(res, parsed.error.issues);
    return;
  }

  if (parsed.data.website) {
    res.status(202).json({ accepted: true });
    return;
  }
  if (rateLimited(req, "lead", 5, 15 * 60_000)) {
    res.setHeader("Retry-After", "900");
    res.status(429).json({ error: "Too many requests. Please use the booking link instead." });
    return;
  }

  const dwellMs = Date.now() - Date.parse(parsed.data.started_at);
  if (!Number.isFinite(dwellMs) || dwellMs < 750 || dwellMs > 24 * 60 * 60_000) {
    res.status(422).json({ error: "Please review the form before sending it", fields: ["form"] });
    return;
  }

  try {
    const lead = await recordLandingLead(parsed.data);
    res.status(lead.duplicate ? 200 : 201).json({
      submitted: true,
      duplicate: lead.duplicate,
      lead_id: lead.id,
      booking_url: "/booking/",
    });
  } catch (error) {
    if (!(error instanceof LandingStorageError)) {
      res.status(422).json({
        error: error instanceof Error ? error.message : "Check the form and try again",
        fields: ["phone"],
      });
      return;
    }

    console.error("Landing-page lead could not be recorded", {
      variant: parsed.data.variant,
      submission_id: parsed.data.submission_id,
      error: error.message,
    });
    res.status(503).json({ error: "We could not save the request. Please use the booking link instead." });
  }
});
