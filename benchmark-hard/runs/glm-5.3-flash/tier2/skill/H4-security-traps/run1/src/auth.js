// Password hashing (bcryptjs), server-side sessions, cookie handling, admin seed.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { nextId, findUserByEmail, findUser } from "./db.js";
import { renderError } from "./views.js";

export const SESSION_COOKIE = "rb_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

// Constant-ish time compare even when the user does not exist: burn one
// comparison against a precomputed hash so timing does not enumerate emails.
let dummyHash = null;
export async function verifyPassword(password, hash, userExists) {
  if (!userExists) {
    dummyHash ||= await bcrypt.hash("timing-equalizer-placeholder", 10);
    await bcrypt.compare(password, dummyHash);
    return false;
  }
  return bcrypt.compare(password, hash);
}

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  db.state.sessions[token] = { userId, createdAt: new Date().toISOString() };
  db.save();
  return token;
}

export function destroySession(db, token) {
  if (token && db.state.sessions[token]) {
    delete db.state.sessions[token];
    db.save();
  }
}

export function setSessionCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  );
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    const name = part.slice(0, i).trim();
    try {
      out[name] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[name] = part.slice(i + 1).trim();
    }
  }
  return out;
}

// Expired sessions are dropped lazily on read.
export function attachUser(req, res, next) {
  const db = req.app.locals.db;
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  req.sessionToken = token || null;
  req.user = null;
  const session = token ? db.state.sessions[token] : null;
  if (session) {
    if (Date.now() - Date.parse(session.createdAt) > SESSION_TTL_MS) {
      destroySession(db, token);
    } else {
      const user = findUser(db.state, session.userId);
      if (user) req.user = user;
    }
  }
  next();
}

export function requireUser(req, res, next) {
  if (req.user) return next();
  if (req.method === "GET" || req.method === "HEAD") {
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  return res.status(401).send(renderError(401, "Sign in required", "You need to sign in to do that.", req.user));
}

export async function createUser(db, { email, password, role = "user" }) {
  const passwordHash = await hashPassword(password);
  const user = {
    id: nextId(),
    email: email.toLowerCase(),
    passwordHash,
    role,
    createdAt: new Date().toISOString(),
  };
  db.state.users.push(user);
  db.save();
  return user;
}

export async function ensureAdmin(db, { email, password } = {}) {
  const cfgEmail = (email || process.env.ADMIN_EMAIL || "admin@recipebox.local").toLowerCase();
  const cfgPassword = password || process.env.ADMIN_PASSWORD || "admin-password-123";
  const existing = findUserByEmail(db.state, cfgEmail);
  if (existing) {
    if (existing.role !== "admin") {
      existing.role = "admin";
      db.save();
    }
    return existing;
  }
  if (db.state.users.some((u) => u.role === "admin")) return null;
  return createUser(db, { email: cfgEmail, password: cfgPassword, role: "admin" });
}
