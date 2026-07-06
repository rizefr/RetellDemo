import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import path from "node:path";
import { env, isProduction } from "../config/env";
import { isAuthorizedOutboundAdmin } from "./outboundAuth";

const COOKIE_NAME = "backend_admin";
const OUTBOUND_COOKIE_NAME = "outbound_admin";
const COOKIE_TTL_SECONDS = 8 * 60 * 60;
const BACKEND_LOGIN_PAGE = path.resolve(__dirname, "../../web/backend-login.html");

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signCookie(expiresAt: number, token: string): string {
  return crypto.createHmac("sha256", token).update(`v1.${expiresAt}`).digest("base64url");
}

function readCookie(cookieHeader: string, name: string): string {
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie ? cookie.slice(name.length + 1) : "";
}

export function createBackendAdminCookie(token: string, now = new Date(), production = isProduction()): string {
  const expiresAt = Math.floor(now.getTime() / 1000) + COOKIE_TTL_SECONDS;
  const value = `v1.${expiresAt}.${signCookie(expiresAt, token)}`;
  const secure = production ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${COOKIE_TTL_SECONDS}; HttpOnly; SameSite=Strict${secure}`;
}

export function clearBackendAdminCookie(production = isProduction()): string {
  const secure = production ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure}`;
}

export function verifyBackendAdminCookie(value: string, token: string, now = new Date()): boolean {
  if (!token) return false;
  const [version, expiresRaw, signature] = value.split(".");
  const expiresAt = Number(expiresRaw);
  if (version !== "v1" || !Number.isInteger(expiresAt) || !signature) return false;
  if (expiresAt < Math.floor(now.getTime() / 1000)) return false;
  return safeEqual(signature, signCookie(expiresAt, token));
}

export function isAuthorizedBackendAdmin(
  headers: { authorization?: string; cookie?: string },
  token = env.OUTBOUND_ADMIN_TOKEN,
): boolean {
  if (!token) return false;
  const bearer = headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  if (bearer && safeEqual(bearer, token)) return true;

  const backendCookie = readCookie(headers.cookie ?? "", COOKIE_NAME);
  if (backendCookie && verifyBackendAdminCookie(backendCookie, token)) return true;

  return isAuthorizedOutboundAdmin(headers, token);
}

export function describeBackendAuthState(headers: { authorization?: string; cookie?: string }) {
  const cookieHeader = headers.cookie ?? "";
  const cookiePresent = Boolean(
    readCookie(cookieHeader, COOKIE_NAME) || readCookie(cookieHeader, OUTBOUND_COOKIE_NAME),
  );
  const tokenConfigured = Boolean(env.OUTBOUND_ADMIN_TOKEN);
  const authenticated = isAuthorizedBackendAdmin(headers, env.OUTBOUND_ADMIN_TOKEN);
  const reason = !tokenConfigured
    ? "missing_token_config"
    : authenticated
      ? "authenticated"
      : cookiePresent
        ? "session_expired_or_invalid"
        : "missing_credentials";

  return {
    authenticated,
    token_configured: tokenConfigured,
    cookie_present: cookiePresent,
    reason,
  };
}

export function requireBackendAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthorizedBackendAdmin(req.headers, env.OUTBOUND_ADMIN_TOKEN)) {
    res.status(401).json({ error: "Backend admin authentication required" });
    return;
  }
  next();
}

export function requireBackendAdminPage(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthorizedBackendAdmin(req.headers, env.OUTBOUND_ADMIN_TOKEN)) {
    res.status(401).sendFile(BACKEND_LOGIN_PAGE);
    return;
  }
  next();
}
