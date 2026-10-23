import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextRequest } from "next/server";
import type { AdminProfile, Role } from "@/lib/types";
import { pool } from "./db";
import { forbidden, HttpError, unauthorized } from "./errors";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const SESSION_COOKIE = "ct_session";
/** Server-side session lifetime. "Remember me" also keeps the cookie across browser restarts. */
export const SESSION_TTL_DAYS = { remember: 30, default: 1 } as const;

export type SessionUser = AdminProfile;

// --- Passwords (scrypt, salted) --------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

// --- Sessions --------------------------------------------------------------

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Validated sessions are cached in memory for a few seconds so each API call
 * costs one database round-trip instead of two. Logout, role changes and user
 * deletion clear the cache for that user immediately (in this process).
 */
const CACHE_TTL_MS = 30_000;
const sessionCache = new Map<string, { user: SessionUser; until: number }>();

function cacheGet(tokenHash: string): SessionUser | null {
  const hit = sessionCache.get(tokenHash);
  if (!hit) return null;
  if (hit.until < Date.now()) {
    sessionCache.delete(tokenHash);
    return null;
  }
  return hit.user;
}

function cacheSet(tokenHash: string, user: SessionUser): void {
  if (sessionCache.size > 1000) sessionCache.clear();
  sessionCache.set(tokenHash, { user, until: Date.now() + CACHE_TTL_MS });
}

export function forgetUserSessions(userId: string): void {
  for (const [key, value] of sessionCache) if (value.user.id === userId) sessionCache.delete(key);
}

/** Create a session and return the raw token for the cookie. */
export async function createSession(userId: string, remember: boolean): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const days = remember ? SESSION_TTL_DAYS.remember : SESSION_TTL_DAYS.default;
  const expiresAt = new Date(Date.now() + days * 86_400_000);
  await pool().query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [
    hashToken(token),
    userId,
    expiresAt,
  ]);
  return { token, expiresAt };
}

export async function deleteSession(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  sessionCache.delete(tokenHash);
  await pool().query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
}

/** End every session of a user (after a password reset or deletion). */
export async function deleteUserSessions(userId: string, exceptToken?: string): Promise<void> {
  forgetUserSessions(userId);
  await pool().query("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2", [
    userId,
    exceptToken ? hashToken(exceptToken) : "",
  ]);
}

/** The signed-in user for this request, or throws 401 (403 if `role: "admin"` is required). */
export async function requireUser(request: NextRequest, options: { role?: Role } = {}): Promise<SessionUser> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) throw unauthorized();
  const tokenHash = hashToken(token);
  let user = cacheGet(tokenHash);
  if (!user) {
    const { rows } = await pool().query<SessionUser>(
      `SELECT u.id, u.name, u.email, u.role
         FROM sessions s JOIN admin_users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [tokenHash],
    );
    if (!rows[0]) throw unauthorized("Your session has expired. Please sign in again.");
    user = rows[0];
    cacheSet(tokenHash, user);
  }
  if (options.role === "admin" && user.role !== "admin") {
    throw forbidden("You have read-only access. Ask an admin to make this change.");
  }
  return user;
}

export async function findUserByEmail(email: string) {
  const { rows } = await pool().query<SessionUser & { password_hash: string }>(
    "SELECT id, name, email, role, password_hash FROM admin_users WHERE lower(email) = lower($1)",
    [email],
  );
  return rows[0] ?? null;
}

// --- Login rate limiting ---------------------------------------------------

export const LOGIN_LIMIT = { attempts: 5, windowMinutes: 15 } as const;

/** The client IP as seen by the proxy in front of the app (Vercel sets x-forwarded-for). */
export function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

/** Throw 429 after too many recent failures for this email + IP. Failures before a success don't count. */
export async function assertLoginAllowed(email: string, ip: string): Promise<void> {
  const { rows } = await pool().query<{ failures: number; oldest: string | null }>(
    `SELECT count(*)::int AS failures, min(at)::text AS oldest
       FROM login_attempts
      WHERE lower(email) = lower($1) AND ip = $2 AND NOT success
        AND at > now() - make_interval(mins => $3)
        AND at > COALESCE((SELECT max(at) FROM login_attempts
                            WHERE lower(email) = lower($1) AND ip = $2 AND success), '-infinity')`,
    [email, ip, LOGIN_LIMIT.windowMinutes],
  );
  const { failures, oldest } = rows[0];
  if (failures >= LOGIN_LIMIT.attempts && oldest) {
    const retryMs = new Date(oldest).getTime() + LOGIN_LIMIT.windowMinutes * 60_000 - Date.now();
    const minutes = Math.max(1, Math.ceil(retryMs / 60_000));
    throw new HttpError(429, `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  }
}

export async function recordLoginAttempt(email: string, ip: string, success: boolean): Promise<void> {
  await pool().query("INSERT INTO login_attempts (email, ip, success) VALUES ($1, $2, $3)", [email, ip, success]);
  if (success) await pool().query("DELETE FROM login_attempts WHERE at < now() - interval '1 day'");
}
