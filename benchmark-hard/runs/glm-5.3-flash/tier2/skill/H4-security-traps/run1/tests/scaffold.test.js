import test from "node:test";
import assert from "node:assert/strict";
import { startApp, attachClient, ADMIN } from "./helpers.js";

test("boots and serves the home page", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const client = attachClient(ctx);

  const health = await client.fetch("/health");
  assert.equal(health.status, 200);
  assert.equal(await health.text(), "ok");

  const home = await client.fetch("/");
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /RecipeBox/);
  assert.match(html, /No recipes yet/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /<link rel="stylesheet" href="\/styles.css">/);
});

test("admin account is seeded on first start", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const admins = ctx.db.state.users.filter((u) => u.role === "admin");
  assert.equal(admins.length, 1);
  assert.equal(admins[0].email, ADMIN.email);
});

test("unknown pages render a 404 page", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const client = attachClient(ctx);
  const res = await client.fetch("/definitely-not-here");
  assert.equal(res.status, 404);
  const html = await res.text();
  assert.match(html, /Page not found/);
  assert.doesNotMatch(html, /at \w+ \(/); // no stack traces
});

test("static assets are served", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const client = attachClient(ctx);
  const css = await client.fetch("/styles.css");
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type") || "", /text\/css/);
});
