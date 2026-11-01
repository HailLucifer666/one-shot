// Integration tests: the whole HTTP surface, with emphasis on the behaviors
// that keep the app correct when a client misbehaves - ownership checks,
// role checks, upload content checks, cookie flags, CSRF, search, and the
// summarize pipeline through the provided mock.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, Client, pngBytes, jpegBytes } from './helpers.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let cleanup;
let base;
let tmpDir;
let dataDir;
let uploadsDir;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(ROOT, '.tmp-test-'));
  dataDir = path.join(tmpDir, 'data');
  uploadsDir = path.join(tmpDir, 'uploads');
  const handle = await startServer({ dataDir, uploadsDir });
  base = handle.base;
  cleanup = async () => {
    await handle.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };
});

after(async () => {
  await cleanup();
});

const ALICE = { email: 'alice@example.com', password: 'alice-password-1', displayName: 'Alice' };
const BOB = { email: 'bob@example.com', password: 'bob-password-22', displayName: 'Bob' };
const ADMIN = { email: 'admin@recipebox.local', password: 'admin-password-123' };

// ------------------------------------------------------------ static pages

test('GET / serves the app shell with a strict CSP and no inline scripts', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  const csp = res.headers.get('content-security-policy') || '';
  assert.match(csp, /script-src 'self'/);
  const html = await res.text();
  assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>/); // no inline scripts
  assert.match(html, /src="\/app\.js"/);
});

// -------------------------------------------------------------- accounts

test('registration works and ignores a client-supplied role', async () => {
  const c = new Client(base);
  const res = await c.register(ALICE.email, ALICE.password, {
    displayName: ALICE.displayName,
    role: 'admin', // attempting privilege escalation via mass assignment
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.user.role, 'user');
});

test('a second user can register', async () => {
  const c = new Client(base);
  const res = await c.register(BOB.email, BOB.password, { displayName: BOB.displayName });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).user.role, 'user');
});

test('registration rejects short passwords and duplicate emails', async () => {
  const c = new Client(base);
  const short = await c.register('x@example.com', 'short');
  assert.equal(short.status, 400);
  const dup = await c.register(ALICE.email, 'some-other-password');
  assert.equal(dup.status, 409);
});

test('passwords are stored hashed - the db file never contains the plaintext', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  const alice = raw.users.find((u) => u.email === ALICE.email);
  assert.ok(alice);
  assert.match(alice.passwordHash, /^scrypt:/);
  assert.ok(!JSON.stringify(raw).includes(ALICE.password));
});

test('wrong password and unknown email produce the identical generic error', async () => {
  const c = new Client(base);
  const wrongPw = await c.login(ALICE.email, 'definitely-not-it');
  const unknown = await c.login('nobody@example.com', 'whatever-pass');
  assert.equal(wrongPw.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal((await wrongPw.json()).error, (await unknown.json()).error);
});

test('the session cookie is HttpOnly and SameSite=Lax', async () => {
  const c = new Client(base);
  const res = await c.register('cookiecheck@example.com', 'cookiecheck-1');
  const setCookies = res.headers.getSetCookie();
  const sid = setCookies.find((v) => v.startsWith('sid='));
  assert.ok(sid, 'a sid cookie was set');
  assert.match(sid, /HttpOnly/i);
  assert.match(sid, /SameSite=Lax/i);
});

test('logout invalidates the session server-side', async () => {
  const c = new Client(base);
  await c.register('logout@example.com', 'logout-pass-1');
  const stolenSid = c.cookies.sid;
  const out = await c.authed('POST', '/api/auth/logout');
  assert.equal(out.status, 204);
  // Replay the stolen token: the server must no longer accept it.
  const replay = new Client(base);
  replay.cookies.sid = stolenSid;
  const me = await replay.req('GET', '/api/auth/me');
  assert.equal((await me.json()).user, null);
});

test('anonymous /api/auth/me returns a signed-out user', async () => {
  const res = await new Client(base).req('GET', '/api/auth/me');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).user, null);
});

// ------------------------------------------------------------------- CSRF

test('state-changing requests without the CSRF header are rejected', async () => {
  const c = new Client(base);
  await c.register('csrf@example.com', 'csrf-pass-123');
  const noHeader = await c.req('POST', '/api/recipes', {
    json: { title: 'x', ingredients: 'y', steps: 'z' },
  });
  assert.equal(noHeader.status, 403);
  const badHeader = await c.authed('POST', '/api/recipes', {
    json: { title: 'x', ingredients: 'y', steps: 'z' },
    headers: { 'x-csrf-token': 'wrong-value' },
  });
  assert.equal(badHeader.status, 403);
});

// ---------------------------------------------------------------- recipes

let alice;
let bob;
let admin;
let carbonaraId;
let bananaId;

test('creating a recipe requires being signed in', async () => {
  const anon = new Client(base);
  await anon.prime();
  const res = await anon.req('POST', '/api/recipes', {
    json: { title: 'Sneaky', ingredients: 'x', steps: 'y' },
  });
  assert.equal(res.status, 401);
});

test('a signed-in user can post a recipe with a photo', async () => {
  alice = new Client(base);
  bob = new Client(base);
  admin = new Client(base);
  assert.equal((await alice.login(ALICE.email, ALICE.password)).status, 200);
  assert.equal((await bob.login(BOB.email, BOB.password)).status, 200);
  assert.equal((await admin.login(ADMIN.email, ADMIN.password)).status, 200);

  const res = await alice.form('POST', '/api/recipes', {
    fields: {
      title: 'Pasta Carbonara',
      ingredients: 'spaghetti\negg\npancetta\nparmesan',
      steps: 'Boil pasta.\nFry pancetta.\nMix with eggs and cheese.',
    },
    file: { buffer: pngBytes(), type: 'image/png', name: 'photo.png' },
  });
  assert.equal(res.status, 201);
  const { recipe } = await res.json();
  carbonaraId = recipe.id;
  assert.match(recipe.photoUrl, /^\/uploads\/[0-9a-f-]{36}\.png$/);
  assert.equal(recipe.ownerName, 'Alice');
  assert.equal(recipe.canEdit, true);
  assert.equal(recipe.canDelete, true);
});

test('a recipe can also be posted as JSON without a photo', async () => {
  const res = await alice.authed('POST', '/api/recipes', {
    json: {
      title: 'Banana Bread',
      ingredients: 'flour\nbananas\nchocolate chips',
      steps: 'Mash bananas.\nMix.\nBake 45 minutes.',
    },
  });
  assert.equal(res.status, 201);
  bananaId = (await res.json()).recipe.id;
});

test('anyone - even signed out - can read recipes', async () => {
  const anon = new Client(base);
  const list = await anon.req('GET', '/api/recipes');
  assert.equal(list.status, 200);
  const { recipes } = await list.json();
  assert.ok(recipes.some((r) => r.id === carbonaraId));
  const detail = await anon.req('GET', `/api/recipes/${carbonaraId}`);
  assert.equal(detail.status, 200);
  const body = await detail.json();
  assert.equal(body.recipe.title, 'Pasta Carbonara');
  assert.equal(body.recipe.canEdit, false); // anonymous sees no edit affordance
  assert.equal(body.recipe.canDelete, false);
});

test('search matches title or ingredient, case-insensitively', async () => {
  const titlesFor = async (q) => {
    const res = await fetch(`${base}/api/recipes?q=${encodeURIComponent(q)}`);
    const { recipes } = await res.json();
    return recipes.map((r) => r.title);
  };
  assert.deepEqual(await titlesFor('banana'), ['Banana Bread']);
  assert.deepEqual(await titlesFor('PANCETTA'), ['Pasta Carbonara']);
  assert.deepEqual(await titlesFor('chocolate'), ['Banana Bread']);
  assert.deepEqual(await titlesFor('zzz-nothing'), []);
});

test('only the owner can edit a recipe', async () => {
  const fields = { title: 'Hacked title', ingredients: 'x', steps: 'y' };
  const anonTry = await new Client(base).req('PUT', `/api/recipes/${carbonaraId}`, { json: fields });
  assert.equal(anonTry.status, 401);
  const bobTry = await bob.authed('PUT', `/api/recipes/${carbonaraId}`, { json: fields });
  assert.equal(bobTry.status, 403);
  const ok = await alice.authed('PUT', `/api/recipes/${carbonaraId}`, {
    json: { title: 'Pasta Carbonara (classic)' },
  });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).recipe.title, 'Pasta Carbonara (classic)');
});

test('only the owner or an admin can delete a recipe', async () => {
  const bobTry = await bob.authed('DELETE', `/api/recipes/${carbonaraId}`);
  assert.equal(bobTry.status, 403);

  // Admin deletes a recipe they do not own.
  const victim = await alice.authed('POST', '/api/recipes', {
    json: { title: 'Temporary dish', ingredients: 'x', steps: 'y' },
  });
  const victimId = (await victim.json()).recipe.id;
  const adminDelete = await admin.authed('DELETE', `/api/recipes/${victimId}`);
  assert.equal(adminDelete.status, 204);
  const gone = await alice.req('GET', `/api/recipes/${victimId}`);
  assert.equal(gone.status, 404);

  // The owner can delete their own recipe.
  const res = await alice.form('POST', '/api/recipes', {
    fields: { title: 'Self-deleting dish', ingredients: 'x', steps: 'y' },
    file: { buffer: jpegBytes(), type: 'image/jpeg', name: 'photo.jpg' },
  });
  const ownId = (await res.json()).recipe.id;
  const own = await alice.authed('DELETE', `/api/recipes/${ownId}`);
  assert.equal(own.status, 204);
  assert.equal((await alice.req('GET', `/api/recipes/${ownId}`)).status, 404);
});

test('admin can delete any recipe; admin still cannot edit someone else\'s', async () => {
  const detail = await admin.req('GET', `/api/recipes/${carbonaraId}`);
  const body = await detail.json();
  assert.equal(body.recipe.canDelete, true);
  assert.equal(body.recipe.canEdit, false);

  const adminEdit = await admin.authed('PUT', `/api/recipes/${carbonaraId}`, {
    json: { title: 'nope' },
  });
  assert.equal(adminEdit.status, 403);
});

// --------------------------------------------------------------- comments

test('commenting requires being signed in; others can read comments', async () => {
  const anon = new Client(base);
  await anon.prime();
  const denied = await anon.req('POST', `/api/recipes/${carbonaraId}/comments`, {
    json: { body: 'anonymous comment' },
  });
  assert.equal(denied.status, 401);

  const ok = await bob.authed('POST', `/api/recipes/${carbonaraId}/comments`, {
    json: { body: 'Tried it - used guanciale. Great!' },
  });
  assert.equal(ok.status, 201);
  const { comment } = await ok.json();
  assert.equal(comment.authorName, 'Bob');

  const anonDetail = await new Client(base).req('GET', `/api/recipes/${carbonaraId}`);
  const body = await anonDetail.json();
  assert.equal(body.comments.length, 1);
  assert.equal(body.comments[0].canDelete, false);
});

test('only the author or an admin can delete a comment', async () => {
  const posted = await bob.authed('POST', `/api/recipes/${carbonaraId}/comments`, {
    json: { body: 'Bob was here' },
  });
  const commentId = (await posted.json()).comment.id;

  const aliceTry = await alice.authed('DELETE', `/api/comments/${commentId}`);
  assert.equal(aliceTry.status, 403); // neither author nor admin

  const author = await bob.authed('DELETE', `/api/comments/${commentId}`);
  assert.equal(author.status, 204);

  // Admin can delete any comment.
  const second = await alice.authed('POST', `/api/recipes/${carbonaraId}/comments`, {
    json: { body: 'Alice was here' },
  });
  const secondId = (await second.json()).comment.id;
  const adminDelete = await admin.authed('DELETE', `/api/comments/${secondId}`);
  assert.equal(adminDelete.status, 204);
});

// -------------------------------------------------------------- summarize

test('summarize requires sign-in and goes through the provided mock', async () => {
  const anon = new Client(base);
  await anon.prime();
  const denied = await anon.req('POST', `/api/recipes/${carbonaraId}/summary`);
  assert.equal(denied.status, 401);

  const ok = await bob.authed('POST', `/api/recipes/${carbonaraId}/summary`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type') || '', /application\/json/);
  const { summary } = await ok.json();
  assert.ok(summary.startsWith('Summary:'));
});

test('hostile mock output arrives as JSON data, never as HTML', async () => {
  // The mock returns active HTML when the recipe text contains RENDER-TEST.
  const marker = await alice.authed('POST', '/api/recipes', {
    json: {
      title: 'Marker recipe RENDER-TEST',
      ingredients: 'RENDER-TEST flour',
      steps: 'RENDER-TEST steps',
    },
  });
  const markerId = (await marker.json()).recipe.id;
  const res = await alice.authed('POST', `/api/recipes/${markerId}/summary`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
  const { summary } = await res.json();
  assert.ok(summary.includes('<img src=x onerror=')); // delivered intact as data
  // The mock itself was really called and logged it.
  assert.ok(fs.existsSync(path.join(process.cwd(), 'llm-calls.log')));
});

// ----------------------------------------------------------------- uploads

test('uploads are checked by content, not by name or mimetype', async () => {
  const asPng = (buffer, name) =>
    bob.form('POST', '/api/recipes', {
      fields: { title: 'upload probe', ingredients: 'x', steps: 'y' },
      file: { buffer, type: 'image/png', name },
    });

  const htmlInPng = await asPng(Buffer.from('<script>alert(1)</script>'), 'innocent.png');
  assert.equal(htmlInPng.status, 400);

  const svg = await asPng(
    Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    'image.svg.png'
  );
  assert.equal(svg.status, 400);

  const empty = await asPng(Buffer.alloc(0), 'zero.png');
  assert.equal(empty.status, 400);

  const big = await asPng(
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2 * 1024 * 1024, 1)]),
    'big.png'
  );
  assert.equal(big.status, 413);

  const goodJpeg = await asPng(jpegBytes(), 'actually-fine.jpg');
  assert.equal(goodJpeg.status, 201);
});

test('uploads directory cannot be escaped via path traversal', async () => {
  for (const attempt of ['/uploads/..%2fdata%2fdb.json', '/uploads/%2e%2e%2fdata%2fdb.json', '/uploads/..%2f..%2fserver.js']) {
    const res = await fetch(`${base}${attempt}`, { redirect: 'manual' });
    assert.notEqual(res.status, 200, attempt);
    const text = await res.text();
    assert.ok(!text.includes('scrypt'), `${attempt} leaked db contents`);
    assert.ok(!text.includes('RecipeBox server entry'), `${attempt} leaked server source`);
  }
});

// ------------------------------------------------------------ misc API

test('unknown API routes return JSON 404s and bad JSON returns 400', async () => {
  const missing = await new Client(base).req('GET', '/api/definitely-not-a-route');
  assert.equal(missing.status, 404);
  assert.ok((await missing.json()).error);

  const bad = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'csrf=x', 'x-csrf-token': 'x' },
    body: '{not json',
  });
  assert.equal(bad.status, 400);
});
