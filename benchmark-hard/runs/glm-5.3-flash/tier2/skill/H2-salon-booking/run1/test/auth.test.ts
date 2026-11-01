import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { startTestServer, type TestServer } from "./helpers/http.ts";
import { Client } from "./helpers/http.ts";
import { registerCustomer, signIn, SEED } from "./helpers/auth.ts";

async function withServer(fn: (ts: TestServer, db: DatabaseSync) => void | Promise<void>) {
  const ts = await startTestServer();
  try {
    const db = new DatabaseSync(join(ts.dataDir, "cutwell.db"));
    await fn(ts, db);
    db.close();
  } finally {
    ts.close();
  }
}

test("registration is rate limited per client IP (31st attempt in a minute is blocked)", async () => {
  await withServer(async (ts) => {
    const client = new Client(ts.port);
    let lastStatus = 0;
    for (let i = 0; i < 31; i++) {
      const res = await client.request("/register", {
        form: { name: `User ${i}`, email: `flood-${i}@example.com`, password: "test-password-123" },
      });
      lastStatus = res.status;
    }
    assert.equal(lastStatus, 429, "the 31st registration attempt in a minute is throttled");
  });
});

test("the homepage redirects each role to its home page", async () => {
  await withServer(async (ts) => {
    const anonymous = await fetch(`http://127.0.0.1:${ts.port}/`, { redirect: "manual" });
    assert.equal(anonymous.status, 303);
    assert.equal(anonymous.headers.get("location"), "/login");

    const client = new Client(ts.port);
    await registerCustomer(client, "home@example.com");
    const customerHome = await client.request("/");
    assert.equal(customerHome.status, 303);
    assert.equal(customerHome.location, "/bookings");
  });
});

test("seed creates admin and three stylist accounts with hashed passwords", async () => {
  await withServer((_ts, db) => {
    const roles = db.prepare("SELECT email, role FROM users").all() as Array<{ email: string; role: string }>;
    assert.ok(roles.some((r) => r.email === SEED.adminEmail && r.role === "admin"));
    for (const name of ["ana", "ben", "cleo"]) {
      assert.ok(roles.some((r) => r.email === `${name}@cutwell.test` && r.role === "stylist"));
    }
    const admin = db.prepare("SELECT password_hash FROM users WHERE email = ?").get(SEED.adminEmail) as {
      password_hash: string;
    };
    assert.ok(bcrypt.compareSync(SEED.adminPassword, admin.password_hash), "seed password verifies against its hash");
  });
});

test("register creates a customer with a hashed password and signs them in", async () => {
  await withServer(async (ts, db) => {
    const client = new Client(ts.port);
    const res = await registerCustomer(client, "Ada@example.com", "long-enough-pass", "Ada Lovelace");
    assert.equal(res.status, 303);
    assert.equal(res.location, "/bookings");
    const user = db.prepare("SELECT id, email, role, password_hash FROM users WHERE email = ?").get("ada@example.com") as {
      id: number;
      role: string;
      password_hash: string;
    };
    assert.equal(user.role, "customer");
    assert.notEqual(user.password_hash, "long-enough-pass", "password must not be stored in plain text");
    assert.ok(bcrypt.compareSync("long-enough-pass", user.password_hash));
    const sessions = db.prepare("SELECT user_id FROM sessions WHERE user_id = ?").all(user.id);
    assert.equal(sessions.length, 1, "registering signs the customer in");
  });
});

test("register refuses passwords under 10 characters", async () => {
  await withServer(async (ts, db) => {
    const client = new Client(ts.port);
    const res = await registerCustomer(client, "short@example.com", "short9");
    assert.equal(res.status, 400);
    assert.match(res.text, /at least 10 characters/);
    const rows = db.prepare("SELECT id FROM users WHERE email = ?").all("short@example.com");
    assert.equal(rows.length, 0, "no account is created");
  });
});

test("register refuses a duplicate email", async () => {
  await withServer(async (ts) => {
    const client = new Client(ts.port);
    await registerCustomer(client, "dupe@example.com");
    const res = await registerCustomer(client, "dupe@example.com");
    assert.equal(res.status, 400);
    assert.match(res.text, /already exists/);
  });
});

test("login redirects each role to its home page", async () => {
  await withServer(async (ts) => {
    // Customer
    const customer = new Client(ts.port);
    await registerCustomer(customer, "role@example.com");
    const customerLogout = await customer.request("/logout", { method: "POST", form: {} });
    assert.equal(customerLogout.status, 303);
    const customerLogin = await signIn(customer, "role@example.com", "test-password-123");
    assert.equal(customerLogin.status, 303);
    assert.equal(customerLogin.location, "/bookings");
    // Stylist
    const stylist = new Client(ts.port);
    const stylistLogin = await signIn(stylist, "ana@cutwell.test", SEED.stylistPassword);
    assert.equal(stylistLogin.location, "/stylist");
    // Admin
    const admin = new Client(ts.port);
    const adminLogin = await signIn(admin, SEED.adminEmail, SEED.adminPassword);
    assert.equal(adminLogin.location, "/admin/bookings");
  });
});

test("login with a wrong password shows a generic error that does not leak which part failed", async () => {
  await withServer(async (ts) => {
    const client = new Client(ts.port);
    await registerCustomer(client, "generic@example.com");
    const wrongPassword = await signIn(client, "generic@example.com", "not-the-password");
    assert.equal(wrongPassword.status, 401);
    assert.match(wrongPassword.text, /Invalid email or password/);
    const unknownEmail = await signIn(client, "nobody@example.com", "whatever-password");
    assert.equal(unknownEmail.status, 401);
    assert.match(unknownEmail.text, /Invalid email or password/);
  });
});

test("the 6th failed sign-in within a minute is blocked, even with the correct password", async () => {
  await withServer(async (ts) => {
    const client = new Client(ts.port);
    await registerCustomer(client, "throttle@example.com");
    const attacker = new Client(ts.port);
    for (let i = 0; i < 5; i++) {
      const res = await signIn(attacker, "throttle@example.com", `wrong-${i}-pass`);
      assert.equal(res.status, 401, `attempt ${i + 1} shows the normal error`);
    }
    const blocked = await signIn(attacker, "throttle@example.com", "test-password-123");
    assert.equal(blocked.status, 429, "6th attempt is blocked even though the password is now correct");
    assert.match(blocked.text, /Too many failed sign-in attempts/);
  });
});

test("logout destroys the session server-side", async () => {
  await withServer(async (ts, db) => {
    const client = new Client(ts.port);
    await registerCustomer(client, "logout@example.com");
    const sessionsBefore = (db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n;
    assert.equal(sessionsBefore, 1);
    const res = await client.request("/logout", { method: "POST", form: {} });
    assert.equal(res.status, 303);
    assert.equal(res.location, "/login");
    const sessionsAfter = (db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n;
    assert.equal(sessionsAfter, 0, "the session row is deleted, not just the cookie");
  });
});

test("malformed bodies are rejected without crashing the server", async () => {
  await withServer(async (ts) => {
    const res = await fetch(`http://127.0.0.1:${ts.port}/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json-but-form-endpoint-ignores-body-shape",
    });
    assert.equal(res.status, 400, "a JSON body on a form endpoint parses as empty -> validation error");
    const health = await fetch(`http://127.0.0.1:${ts.port}/health`);
    assert.equal(health.status, 200, "server still healthy");
  });
});
