'use strict';

/**
 * Test helpers. Each test file gets its own child process (node --test), its
 * own throwaway SQLite database and outbox directory under <project>/tmp, and
 * sets APP_NOW for the documented clock override. Nothing is written outside
 * the project folder; tmp/ is removed after each run.
 */

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

const ROOT = path.resolve(__dirname, '..');

let seq = 0;

/**
 * Start the app on an ephemeral port with a fresh DB + outbox.
 * @param {object} [opts]
 * @param {string} [opts.now]  APP_NOW clock override for the whole file
 */
async function startServer(opts = {}) {
  if (opts.now !== undefined) process.env.APP_NOW = opts.now;
  const dir = path.join(ROOT, 'tmp', 'tests', `t${Date.now()}-${process.pid}-${seq++}`);
  const outboxDir = path.join(dir, 'outbox');
  fs.mkdirSync(outboxDir, { recursive: true });
  const app = createApp({ dbPath: path.join(dir, 'test.sqlite'), outboxDir });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    app,
    db: app.db,
    outboxDir,
    dir,
    async close() {
      await new Promise((r) => server.close(r));
      app.db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Cookie-jar HTTP client bound to one session. */
function client(base) {
  let cookie = null;
  return async function request(method, path, body) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of setCookies) {
      const pair = c.split(';')[0];
      if (pair.startsWith('cutwell_session=')) {
        cookie = pair.endsWith('=') ? null : pair;
      }
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data };
  };
}

const SEED = {
  admin: { email: 'admin@cutwell.example', password: 'cutwell-admin' },
  ana: { email: 'ana@cutwell.example', password: 'stylist-pass-1' },
  ben: { email: 'ben@cutwell.example', password: 'stylist-pass-1' },
  cleo: { email: 'cleo@cutwell.example', password: 'stylist-pass-1' },
  customer: { email: 'customer@example.com', password: 'customer-pass-1' },
};

let emailSeq = 0;
function uniqueEmail(prefix = 'customer') {
  emailSeq += 1;
  return `${prefix}${emailSeq}.${Date.now()}@example.com`;
}

async function registerCustomer(base, email, password = 'long-enough-password') {
  const req = client(base);
  const res = await req('POST', '/api/auth/register', {
    name: 'Test Customer',
    email,
    password,
  });
  assert.equal(res.status, 201, `register ${email}: ${JSON.stringify(res.data)}`);
  return req;
}

async function login(base, creds) {
  const req = client(base);
  const res = await req('POST', '/api/auth/login', creds);
  assert.equal(res.status, 200, `login ${creds.email}: ${JSON.stringify(res.data)}`);
  return req;
}

/** Book and assert 201; returns the booking JSON. */
async function book(req, { serviceId = 1, stylistId = 1, start }) {
  const res = await req('POST', '/api/bookings', { serviceId, stylistId, start });
  assert.equal(res.status, 201, `booking: ${JSON.stringify(res.data)}`);
  return res.data.booking;
}

function outboxFiles(outboxDir) {
  return fs.readdirSync(outboxDir).filter((f) => f.endsWith('.txt'));
}

function outboxContent(outboxDir, fragment) {
  const file = outboxFiles(outboxDir).find((f) => f.includes(fragment));
  if (!file) return null;
  return fs.readFileSync(path.join(outboxDir, file), 'utf8');
}

module.exports = {
  ROOT,
  startServer,
  client,
  SEED,
  uniqueEmail,
  registerCustomer,
  login,
  book,
  outboxFiles,
  outboxContent,
  assert,
};
