import { Router } from "express";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import {
  LoginLimiter,
  clearSessionCookieHeader,
  createSession,
  destroySession,
  hashPassword,
  sessionCookieHeader,
  verifyPassword,
  type SessionUser,
} from "../auth.ts";
import { buttonRow, errorSummary, esc, page, textField } from "../render.ts";

const registerSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(80, "Name must be 80 characters or fewer."),
  email: z.email("Enter a valid email address.").trim().toLowerCase().max(120),
  password: z.string().min(10, "Password must be at least 10 characters.").max(200),
});

const loginSchema = z.object({
  email: z.email("Enter a valid email address.").trim().toLowerCase(),
  password: z.string().min(1, "Enter your password."),
});

type FieldErrors = Record<string, string>;

function fieldErrorsFromZod(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in out)) out[key] = issue.message;
  }
  return out;
}

function registerForm(values: { name?: string; email?: string }, fieldErrors: FieldErrors, globalErrors: string[]): string {
  return `
  <h1>Create your Cutwell account</h1>
  ${errorSummary(globalErrors)}
  <form method="post" action="/register" novalidate>
    ${textField({ name: "name", label: "Full name", value: values.name, required: true, autocomplete: "name", error: fieldErrors.name })}
    ${textField({ name: "email", label: "Email address", type: "email", value: values.email, required: true, autocomplete: "email", error: fieldErrors.email })}
    ${textField({
      name: "password",
      label: "Password",
      type: "password",
      required: true,
      autocomplete: "new-password",
      hint: "At least 10 characters.",
      error: fieldErrors.password,
    })}
    ${buttonRow("Create account", "/login")}
  </form>`;
}

function loginForm(values: { email?: string }, fieldErrors: FieldErrors, globalErrors: string[]): string {
  return `
  <h1>Sign in</h1>
  ${errorSummary(globalErrors)}
  <form method="post" action="/login" novalidate>
    ${textField({ name: "email", label: "Email address", type: "email", value: values.email, required: true, autocomplete: "email", error: fieldErrors.email })}
    ${textField({ name: "password", label: "Password", type: "password", required: true, autocomplete: "current-password", error: fieldErrors.password })}
    ${buttonRow("Sign in", "/register")}
  </form>`;
}

function homeForRole(user: SessionUser): string {
  if (user.role === "stylist") return "/stylist";
  if (user.role === "admin") return "/admin/bookings";
  return "/bookings";
}

export function authRoutes(deps: { db: DatabaseSync; limiter: LoginLimiter }): Router {
  const router = Router();
  const { db, limiter } = deps;
  // Signup throttle: at most 30 registrations per minute per client IP.
  const signupLimiter = new LoginLimiter({ maxEvents: 30 });

  router.get("/register", (req, res) => {
    res.send(
      page({ title: "Register", user: req.user ?? null, content: registerForm({}, {}, []) }),
    );
  });

  router.post("/register", (req, res) => {
    if (signupLimiter.isBlocked(ipOf(req))) {
      res.status(429).send(
        page({
          title: "Register",
          user: null,
          content: registerForm({}, {}, ["Too many sign-up attempts. Please wait a minute and try again."]),
        }),
      );
      return;
    }
    signupLimiter.recordFailure(ipOf(req));
    const parsed = registerSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const fieldErrors = fieldErrorsFromZod(parsed.error);
      const values = { name: str(req.body?.name), email: str(req.body?.email) };
      res.status(400).send(
        page({
          title: "Register",
          user: req.user ?? null,
          content: registerForm(values, fieldErrors, Object.values(fieldErrors)),
        }),
      );
      return;
    }
    const { name, email, password } = parsed.data;
    try {
      const result = db
        .prepare("INSERT INTO users (email, password_hash, name, role, created_at_utc) VALUES (?, ?, ?, 'customer', ?)")
        .run(email, hashPassword(password), name, new Date().toISOString());
      const token = createSession(db, Number(result.lastInsertRowid));
      res.set("set-cookie", sessionCookieHeader(token)).redirect(303, "/bookings");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("UNIQUE")) {
        const fieldErrors = { email: "An account with this email already exists." };
        res.status(400).send(
          page({
            title: "Register",
            user: null,
            content: registerForm({ name, email }, fieldErrors, Object.values(fieldErrors)),
          }),
        );
        return;
      }
      throw err;
    }
  });

  router.get("/login", (req, res) => {
    res.send(page({ title: "Sign in", user: req.user ?? null, content: loginForm({}, {}, []) }));
  });

  router.post("/login", (req, res) => {
    const email = str(req.body?.email);
    const password = str(req.body?.password);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const fieldErrors = fieldErrorsFromZod(parsed.error);
      res.status(400).send(
        page({ title: "Sign in", user: null, content: loginForm({ email }, fieldErrors, Object.values(fieldErrors)) }),
      );
      return;
    }
    if (limiter.isBlocked(parsed.data.email)) {
      res.status(429).send(
        page({
          title: "Sign in",
          user: null,
          content: loginForm(
            { email: parsed.data.email },
            {},
            ["Too many failed sign-in attempts for this account. Please wait a minute and try again."],
          ),
        }),
      );
      return;
    }
    const row = db
      .prepare("SELECT id, email, name, role, password_hash FROM users WHERE email = ?")
      .get(parsed.data.email) as { id: number; email: string; name: string; role: SessionUser["role"]; password_hash: string } | undefined;
    if (!row || !verifyPassword(parsed.data.password, row.password_hash)) {
      limiter.recordFailure(parsed.data.email);
      res.status(401).send(
        page({
          title: "Sign in",
          user: null,
          content: loginForm({ email: parsed.data.email }, {}, ["Invalid email or password."]),
        }),
      );
      return;
    }
    limiter.clear(parsed.data.email);
    const user: SessionUser = { id: row.id, email: row.email, name: row.name, role: row.role };
    const token = createSession(db, row.id);
    res.set("set-cookie", sessionCookieHeader(token)).redirect(303, homeForRole(user));
  });

  router.post("/logout", (req, res) => {
    const token = readSessionToken(req.headers.cookie);
    if (token) destroySession(db, token);
    res.set("set-cookie", clearSessionCookieHeader()).redirect(303, "/login");
  });

  return router;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function ipOf(req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string } }): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket?.remoteAddress ?? "unknown";
}

function readSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() === "cutwell_sid") return part.slice(eq + 1).trim();
  }
  return null;
}
