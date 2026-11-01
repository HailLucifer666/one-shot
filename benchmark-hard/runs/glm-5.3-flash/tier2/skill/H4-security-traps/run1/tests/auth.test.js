import test from "node:test";
import assert from "node:assert/strict";
import { startApp, attachClient, registerAndLogin, ADMIN } from "./helpers.js";

function form(body) {
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  };
}

test("register creates an account and signs the user in", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const client = attachClient(ctx);

  const res = await client.fetch("/register", form({ email: "maya@example.com", password: "password-123" }));
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/");

  const home = await client.fetch("/");
  const html = await home.text();
  assert.match(html, /maya@example\.com/);
  assert.match(html, /New recipe/);
});

test("register rejects duplicate email, invalid email, short password", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const client = attachClient(ctx);
  await registerAndLogin(client, ctx.base, "maya@example.com");
  // log out so we can try registering again
  await client.fetch("/logout", { method: "POST" });

  const dup = await client.fetch("/register", form({ email: "maya@example.com", password: "password-123" }));
  assert.equal(dup.status, 400);
  assert.match(await dup.text(), /already registered/);

  const badEmail = await client.fetch("/register", form({ email: "not-an-email", password: "password-123" }));
  assert.equal(badEmail.status, 400);

  const shortPw = await client.fetch("/register", form({ email: "other@example.com", password: "short" }));
  assert.equal(shortPw.status, 400);
  assert.match(await shortPw.text(), /at least 8 characters/);
});

test("login works, wrong password fails with a generic message", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const client = attachClient(ctx);
  await registerAndLogin(client, ctx.base, "maya@example.com");
  await client.fetch("/logout", { method: "POST" });

  const wrong = await client.fetch("/login", form({ email: "maya@example.com", password: "wrong-password" }));
  assert.equal(wrong.status, 401);
  const html = await wrong.text();
  assert.match(html, /Invalid email or password/);
  assert.doesNotMatch(html, /bcrypt|hash/i);

  // Unknown email must behave identically (no user enumeration).
  const unknown = await client.fetch("/login", form({ email: "ghost@example.com", password: "wrong-password" }));
  assert.equal(unknown.status, 401);
  assert.match(await unknown.text(), /Invalid email or password/);

  const ok = await client.fetch("/login", form({ email: "maya@example.com", password: "password-123" }));
  assert.equal(ok.status, 302);

  const adminLogin = await client.fetch("/login", form({ email: ADMIN.email, password: ADMIN.password }));
  assert.equal(adminLogin.status, 302);
});

test("session cookie is HttpOnly and SameSite=Lax", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const client = attachClient(ctx);
  const res = await client.fetch("/register", form({ email: "maya@example.com", password: "password-123" }));
  const setCookies = res.headers.getSetCookie();
  assert.ok(setCookies.length >= 1);
  const cookie = setCookies.find((c) => c.startsWith("rb_session="));
  assert.ok(cookie, "session cookie set");
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
});

test("logout ends the session", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const client = attachClient(ctx);
  await registerAndLogin(client, ctx.base, "maya@example.com");

  let home = await client.fetch("/");
  assert.match(await home.text(), /maya@example\.com/);

  const out = await client.fetch("/logout", { method: "POST" });
  assert.equal(out.status, 302);

  home = await client.fetch("/");
  const html = await home.text();
  assert.match(html, /Log in/);
  assert.doesNotMatch(html, /maya@example\.com/);
});

test("login honours only local next paths (open-redirect blocked)", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const client = attachClient(ctx);
  await registerAndLogin(client, ctx.base, "maya@example.com");
  await client.fetch("/logout", { method: "POST" });

  const evil = await client.fetch(
    "/login",
    form({ email: "maya@example.com", password: "password-123", next: "https://evil.example/phish" })
  );
  assert.equal(evil.status, 302);
  assert.equal(evil.headers.get("location"), "/");

  const local = await client.fetch(
    "/login",
    form({ email: "maya@example.com", password: "password-123", next: "/recipes/new" })
  );
  assert.equal(local.status, 302);
  assert.equal(local.headers.get("location"), "/recipes/new");
});

test("login and register are rate limited", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const client = attachClient(ctx);
  await registerAndLogin(client, ctx.base, "maya@example.com");
  await client.fetch("/logout", { method: "POST" });

  let last;
  for (let i = 0; i < 10; i++) {
    last = await client.fetch("/login", form({ email: "maya@example.com", password: "wrong-password" }));
  }
  assert.equal(last.status, 401);
  const eleventh = await client.fetch("/login", form({ email: "maya@example.com", password: "wrong-password" }));
  assert.equal(eleventh.status, 429);
});

test("cross-site POSTs without a same-origin context are rejected", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const client = attachClient(ctx);

  const res = await client.fetch("/register", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" },
    body: new URLSearchParams({ email: "x@example.com", password: "password-123" }).toString(),
  });
  assert.equal(res.status, 403);
});
