import type { SessionUser } from "./auth.ts";

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
}

export type NavSection = "book" | "bookings" | "schedule" | "admin" | null;

export type PageOptions = {
  title: string;
  user: SessionUser | null;
  active?: NavSection;
  content: string;
};

function navLink(href: string, label: string, active: boolean): string {
  return `<a href="${href}"${active ? ' aria-current="page"' : ""}>${label}</a>`;
}

export function page(opts: PageOptions): string {
  const { user, title, active = null } = opts;
  const links: string[] = [];
  if (user && (user.role === "customer" || user.role === "admin")) {
    links.push(navLink("/book", "Book an appointment", active === "book"));
  }
  if (user && user.role === "customer") {
    links.push(navLink("/bookings", "My bookings", active === "bookings"));
  }
  if (user && user.role === "stylist") {
    links.push(navLink("/stylist", "My schedule", active === "schedule"));
  }
  if (user && user.role === "admin") {
    links.push(navLink("/admin/bookings", "Admin", active === "admin"));
  }

  const auth = user
    ? `<span class="whoami">${esc(user.name)} (${esc(user.role)})</span>
       <form method="post" action="/logout" class="inline-form"><button type="submit" class="link-button">Sign out</button></form>`
    : `${navLink("/login", "Sign in", false)}${navLink("/register", "Register", false)}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · Cutwell</title>
  <meta name="description" content="Cutwell salon — book haircuts, color and beard trims with Ana, Ben or Cleo.">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="/">Cutwell</a>
      <nav aria-label="Main navigation" class="main-nav">${links.join("")}</nav>
      <div class="auth-nav">${auth}</div>
    </div>
  </header>
  <main id="main" class="container">
    ${opts.content}
  </main>
  <footer class="site-footer">
    <div class="container">
      <p>Cutwell · 9:00–18:00 Monday to Saturday · 105 Elm Street · All times shown in salon time (America/Chicago).</p>
    </div>
  </footer>
  <script src="/app.js" defer></script>
</body>
</html>`;
}

export function errorSummary(errors: string[]): string {
  if (errors.length === 0) return "";
  const items = errors.map((e) => `<li>${esc(e)}</li>`).join("");
  return `<div class="error-summary" role="alert">
    <h2>There is a problem</h2>
    <ul>${items}</ul>
  </div>`;
}

/** A success/info notice, typically after a redirect. */
export function flash(message: string, kind: "success" | "info" = "success"): string {
  if (!message) return "";
  return `<p class="flash flash-${kind}" role="status">${esc(message)}</p>`;
}

export type FieldOptions = {
  name: string;
  label: string;
  type?: string;
  value?: string;
  required?: boolean;
  error?: string;
  autocomplete?: string;
  hint?: string;
  attrs?: string;
};

export function textField(opts: FieldOptions): string {
  const id = `field-${opts.name}`;
  const describedBy: string[] = [];
  if (opts.hint) describedBy.push(`${id}-hint`);
  if (opts.error) describedBy.push(`${id}-error`);
  const aria = describedBy.length ? ` aria-describedby="${describedBy.join(" ")}"` : "";
  return `<div class="field${opts.error ? " field-error" : ""}">
  <label for="${id}">${esc(opts.label)}</label>
  ${opts.hint ? `<p class="hint" id="${id}-hint">${esc(opts.hint)}</p>` : ""}
  <input id="${id}" name="${esc(opts.name)}" type="${opts.type ?? "text"}"${opts.value !== undefined ? ` value="${esc(opts.value)}"` : ""}${opts.required ? " required" : ""}${opts.autocomplete ? ` autocomplete="${opts.autocomplete}"` : ""}${aria}${opts.error ? ' aria-invalid="true"' : ""}${opts.attrs ? ` ${opts.attrs}` : ""}>
  ${opts.error ? `<p class="field-error-message" id="${id}-error">${esc(opts.error)}</p>` : ""}
</div>`;
}

export function buttonRow(label: string, secondary?: string): string {
  return `<div class="button-row">
  <button type="submit" class="button">${esc(label)}</button>
  ${secondary ? `<a class="button-secondary" href="${secondary}">Cancel</a>` : ""}
</div>`;
}
