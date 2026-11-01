// App factory: middleware chain + routes. createApp({ dataDir }) is exported so
// tests can boot isolated instances on ephemeral ports.
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

import { config } from "./config.js";
import { createDb, findUserByEmail } from "./db.js";
import {
  attachUser,
  clearSessionCookie,
  createSession,
  createUser,
  destroySession,
  ensureAdmin,
  requireUser,
  setSessionCookie,
  verifyPassword,
} from "./auth.js";
import { rateLimit } from "./ratelimit.js";
import { renderError, renderHome, renderLogin, renderRegister } from "./views.js";
import { safeLocalPath, validateEmail, validatePassword } from "./validators.js";
import { isStoredPhotoName } from "./upload.js";
import { recipesRouter } from "./routes/recipes.js";
import { commentsRouter } from "./routes/comments.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ dataDir = config.dataDir, seedAdmin = true } = {}) {
  const db = createDb(dataDir);
  if (seedAdmin) ensureAdmin(db);

  const app = express();
  app.disable("x-powered-by");
  app.locals.db = db;

  app.use((req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    next();
  });

  app.use(express.static(path.join(__dirname, "..", "public"), { index: false, maxAge: "1h" }));

  app.use(express.urlencoded({ extended: false, limit: "256kb" }));
  app.use(attachUser);

  // State-changing requests must originate from this site (belt and braces on
  // top of SameSite=Lax cookies). Requests without these headers (curl, tests) pass.
  app.use((req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const secFetchSite = req.headers["sec-fetch-site"];
    if (typeof secFetchSite === "string" && !["same-origin", "none"].includes(secFetchSite)) {
      return res.status(403).send(renderError(403, "Blocked", "Cross-site requests are not allowed.", req.user));
    }
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) throw new Error("origin mismatch");
      } catch {
        return res.status(403).send(renderError(403, "Blocked", "Cross-site requests are not allowed.", req.user));
      }
    }
    return next();
  });

  const authLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 10 });
  const loginLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 10 });

  app.get("/health", (req, res) => res.type("text/plain").send("ok"));

  app.get("/", (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 200) : "";
    const { recipes, ownerEmails } = listRecipes(db, q);
    res.send(renderHome({ user: req.user, recipes, ownerEmails, q }));
  });

  app.get("/register", (req, res) => {
    if (req.user) return res.redirect("/");
    res.send(renderRegister({ user: req.user }));
  });

  app.post("/register", authLimiter, async (req, res, next) => {
    try {
      const emailResult = validateEmail(req.body.email);
      const passwordResult = validatePassword(req.body.password);
      const errors = [];
      if (!emailResult.ok) errors.push(emailResult.error);
      if (!passwordResult.ok) errors.push(passwordResult.error);
      if (errors.length === 0 && findUserByEmail(db.state, emailResult.value)) {
        errors.push("That email is already registered. Try logging in.");
      }
      if (errors.length > 0) {
        return res.status(400).send(renderRegister({ user: req.user, errors, values: { email: req.body.email } }));
      }
      const user = await createUser(db, { email: emailResult.value, password: passwordResult.value });
      setSessionCookie(res, createSession(db, user.id));
      return res.redirect("/");
    } catch (err) {
      return next(err);
    }
  });

  app.get("/login", (req, res) => {
    if (req.user) return res.redirect("/");
    const next = safeLocalPath(req.query.next, "");
    res.send(renderLogin({ user: req.user, next }));
  });

  app.post("/login", loginLimiter, async (req, res, next) => {
    try {
      const next = safeLocalPath(req.body.next, "/");
      const email = String(req.body.email ?? "");
      const password = String(req.body.password ?? "");
      const user = findUserByEmail(db.state, email);
      const ok = await verifyPassword(password, user ? user.passwordHash : "", Boolean(user));
      if (!ok) {
        return res
          .status(401)
          .send(renderLogin({ user: req.user, errors: ["Invalid email or password."], values: { email }, next }));
      }
      setSessionCookie(res, createSession(db, user.id));
      return res.redirect(next);
    } catch (err) {
      return next(err);
    }
  });

  app.post("/logout", (req, res) => {
    destroySession(db, req.sessionToken);
    clearSessionCookie(res);
    res.redirect("/");
  });

  app.use("/recipes", recipesRouter());
  app.use(commentsRouter());

  // Photos are served only through this route: strict server-generated name
  // check + sendFile rooted at the uploads dir. The uploads dir itself is
  // never statically served.
  app.get("/photos/:name", (req, res) => {
    const name = String(req.params.name || "");
    if (!isStoredPhotoName(name)) {
      return res.status(404).send(renderError(404, "Photo not found", "No photo at this address.", req.user));
    }
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    return res.sendFile(name, { root: db.uploadsDir }, (err) => {
      if (err && !res.headersSent) {
        res.status(404).send(renderError(404, "Photo not found", "No photo at this address.", req.user));
      }
    });
  });

  app.use((req, res) => {
    res.status(404).send(renderError(404, "Page not found", "The page you are looking for does not exist.", req.user));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(`[error] ${req.method} ${req.originalUrl}: ${err.message}`);
    if (!res.headersSent) {
      res.status(err.status && err.status >= 400 && err.status < 600 ? err.status : 500);
      res.send(renderError(res.statusCode === 500 ? 500 : res.statusCode, "Something went wrong", "Please go back and try again.", req.user));
    }
  });

  return app;
}

// Shared helper: home list with owner emails resolved (no N+1 file reads; one pass).
function listRecipes(db, q) {
  const needle = q.trim().toLowerCase();
  let recipes = db.state.recipes;
  if (needle) {
    recipes = recipes.filter(
      (r) =>
        r.title.toLowerCase().includes(needle) ||
        r.ingredients.toLowerCase().includes(needle)
    );
  }
  recipes = [...recipes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const ownerEmails = new Map(db.state.users.map((u) => [u.id, u.email]));
  return { recipes, ownerEmails };
}

export default createApp;
