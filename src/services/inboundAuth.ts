import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import path from "node:path";
import { env, isProduction } from "../config/env";

const COOKIE_NAME = "inbound_admin";
const COOKIE_TTL_SECONDS = 8 * 60 * 60;
const INBOUND_LOGIN_PAGE = path.resolve(__dirname, "../../web/inbound-login.html");

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signCookie(expiresAt: number, token: string): string {
  return crypto.createHmac("sha256", token).update(`v1.${expiresAt}`).digest("base64url");
}

export function createInboundAdminCookie(token: string, now = new Date(), production = isProduction()): string {
  const expiresAt = Math.floor(now.getTime() / 1000) + COOKIE_TTL_SECONDS;
  const value = `v1.${expiresAt}.${signCookie(expiresAt, token)}`;
  const secure = production ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${COOKIE_TTL_SECONDS}; HttpOnly; SameSite=Strict${secure}`;
}

export function clearInboundAdminCookie(production = isProduction()): string {
  const secure = production ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure}`;
}

export function verifyInboundAdminCookie(value: string, token: string, now = new Date()): boolean {
  if (!token) return false;
  const [version, expiresRaw, signature] = value.split(".");
  const expiresAt = Number(expiresRaw);
  if (version !== "v1" || !Number.isInteger(expiresAt) || !signature) return false;
  if (expiresAt < Math.floor(now.getTime() / 1000)) return false;
  return safeEqual(signature, signCookie(expiresAt, token));
}

function readCookie(cookieHeader: string): string {
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  return cookie ? cookie.slice(COOKIE_NAME.length + 1) : "";
}

export function isAuthorizedInboundAdmin(
  headers: { authorization?: string; cookie?: string },
  token = env.INBOUND_ADMIN_TOKEN,
): boolean {
  if (!token) return false;
  const bearer = headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  if (bearer && safeEqual(bearer, token)) return true;
  const cookieValue = readCookie(headers.cookie ?? "");
  return cookieValue ? verifyInboundAdminCookie(cookieValue, token) : false;
}

export function requireInboundAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthorizedInboundAdmin(req.headers, env.INBOUND_ADMIN_TOKEN)) {
    res.status(401).json({ error: "Inbound admin authentication required" });
    return;
  }
  next();
}

export function requireInboundAdminPage(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthorizedInboundAdmin(req.headers, env.INBOUND_ADMIN_TOKEN)) {
    res.status(401).sendFile(INBOUND_LOGIN_PAGE);
    return;
  }
  next();
}

export function requireTrustedInboundBrowserOrigin(req: Request, res: Response, next: NextFunction): void {
  if (/^Bearer\s+/i.test(req.headers.authorization ?? "")) {
    next();
    return;
  }
  const configured = env.APP_BASE_URL;
  const origin = req.headers.origin ?? "";
  const requestOrigin = `${req.protocol}://${req.get("host")}`;
  const allowedOrigins = [configured ? new URL(configured).origin : "", isProduction() ? "" : requestOrigin].filter(Boolean);
  if (origin && !allowedOrigins.includes(origin)) {
    res.status(403).json({ error: "Untrusted browser origin" });
    return;
  }
  next();
}
