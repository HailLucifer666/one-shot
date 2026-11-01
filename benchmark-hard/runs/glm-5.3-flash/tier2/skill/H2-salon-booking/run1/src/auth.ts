import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { DatabaseSync } from "node:sqlite";

export type Role = "customer" | "stylist" | "admin";

export type SessionUser = {
  id: number;
  email: string;
  name: string;
  role: Role;
};

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

export const SESSION_COOKIE = "cutwell_sid";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 3600;

export function createSession(db: DatabaseSync, userId: number): string {
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id, created_at_utc) VALUES (?, ?, ?)").run(
    token,
    userId,
    new Date().toISOString(),
  );
  return token;
}

export function destroySession(db: DatabaseSync, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Returns the signed-in user for this request's cookie, or null. */
export function userForRequest(db: DatabaseSync, cookieHeader: string | undefined): SessionUser | null {
  if (!cookieHeader) return null;
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`,
    )
    .get(token) as { id: number; email: string; name: string; role: Role } | undefined;
  return row ?? null;
}

function readCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * Per-account sign-in throttle: at most 5 failed attempts per rolling minute.
 * The check happens before password verification, so the 6th attempt is
 * blocked even if the password is correct. A successful sign-in clears the
 * count. Keyed on the submitted email, so it also throttles guessing against
 * accounts that do not exist.
 */
export class LoginLimiter {
  private failures = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly maxEvents: number;

  constructor(opts: { maxEvents?: number; windowMs?: number } = {}) {
    this.maxEvents = opts.maxEvents ?? 5;
    this.windowMs = opts.windowMs ?? 60_000;
  }

  isBlocked(key: string, at: Date = new Date()): boolean {
    const list = this.recentEvents(key, at);
    return list.length >= this.maxEvents;
  }

  /** Records a failed attempt (or, for generic throttles, any counted event). */
  recordFailure(key: string, at: Date = new Date()): void {
    const list = this.recentEvents(key, at);
    list.push(at.getTime());
    this.failures.set(key.toLowerCase(), list);
  }

  clear(key: string): void {
    this.failures.delete(key.toLowerCase());
  }

  private recentEvents(key: string, at: Date): number[] {
    const normalized = key.toLowerCase();
    const list = (this.failures.get(normalized) ?? []).filter((t) => at.getTime() - t < this.windowMs);
    this.failures.set(normalized, list);
    return list;
  }
}
