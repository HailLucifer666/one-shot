import express from "express";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { openDb } from "./db.ts";
import { ensureSeed, type SeedConfig } from "./seed.ts";
import { LoginLimiter, userForRequest } from "./auth.ts";
import { authRoutes } from "./routes/authRoutes.ts";
import { bookRoutes } from "./routes/book.ts";
import { myRoutes } from "./routes/my.ts";
import { stylistRoutes } from "./routes/stylist.ts";
import { adminRoutes } from "./routes/admin.ts";

export type AppOptions = {
  dataDir: string;
  outboxDir: string;
  seed?: SeedConfig;
};

export function seedConfigFromEnv(): SeedConfig {
  return {
    adminEmail: process.env.SEED_ADMIN_EMAIL ?? "admin@cutwell.test",
    adminPassword: process.env.SEED_ADMIN_PASSWORD ?? "cutwell-admin-1",
    stylistPassword: process.env.SEED_STYLIST_PASSWORD ?? "cutwell-stylist-1",
  };
}

const PUBLIC_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..", "public");

export function createApp(opts: AppOptions): express.Express {
  const db = openDb(opts.dataDir);
  ensureSeed(db, opts.seed ?? seedConfigFromEnv());
  const limiter = new LoginLimiter();

  const app = express();
  app.disable("x-powered-by");
  // Exposed for test harnesses so they can release the SQLite handle.
  app.set("db", db);

  // Security headers. HTTPS terminates at the host (see README deploy notes).
  app.use((_req, res, next) => {
    res.set(
      "content-security-policy",
      "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'",
    );
    res.set("x-content-type-options", "nosniff");
    res.set("referrer-policy", "no-referrer");
    res.set("x-frame-options", "DENY");
    next();
  });

  // One structured log line per request, with a request id.
  let requestSeq = 0;
  app.use((req, res, next) => {
    const requestId = `req-${++requestSeq}`;
    const started = Date.now();
    res.set("x-request-id", requestId);
    res.on("finish", () => {
      console.log(
        JSON.stringify({ requestId, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started }),
      );
    });
    next();
  });

  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(PUBLIC_DIR));

  // Attach the signed-in user (if any) from the session cookie.
  app.use((req, _res, next) => {
    req.user = userForRequest(db, req.headers.cookie);
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // The brand link points here: send each visitor to their home page.
  app.get("/", (req, res) => {
    const user = req.user;
    if (!user) {
      res.redirect(303, "/login");
    } else if (user.role === "stylist") {
      res.redirect(303, "/stylist");
    } else if (user.role === "admin") {
      res.redirect(303, "/admin/bookings");
    } else {
      res.redirect(303, "/bookings");
    }
  });

  app.use(authRoutes({ db, limiter }));
  app.use(bookRoutes({ db, outboxDir: opts.outboxDir }));
  app.use(myRoutes({ db, outboxDir: opts.outboxDir }));
  app.use(stylistRoutes({ db }));
  app.use(adminRoutes({ db, outboxDir: opts.outboxDir }));

  // 404 — no stack, no internals.
  app.use((_req, res) => {
    res.status(404).send(simpleErrorPage("Page not found", "The page you asked for does not exist."));
  });

  // 500 — log details server-side, show a generic message.
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(`[error] ${req.method} ${req.path}:`, err);
    res.status(500).send(simpleErrorPage("Something went wrong", "An unexpected error occurred. Please try again."));
  });

  return app;
}

function simpleErrorPage(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · Cutwell</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="site-header"><div class="container header-inner"><a class="brand" href="/">Cutwell</a></div></header>
  <main class="container">
    <h1>${title}</h1>
    <p>${message}</p>
    <p><a class="button-secondary" href="/">Back to the homepage</a></p>
  </main>
</body>
</html>`;
}
