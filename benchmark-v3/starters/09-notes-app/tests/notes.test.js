"use strict";

// Happy-path suite for the notes app: 12 tests, zero external dependencies.
// Every test runs the real server over HTTP. The server is bound to an
// ephemeral port and each test starts from a fresh data file (DATA_FILE
// points into a per-run temp directory that is wiped before every test).

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "notes-app-tests-"));
const DATA_FILE = path.join(TMP_DIR, "data.json");

process.env.DATA_FILE = DATA_FILE;
const { server, createApp } = require("../server");

let baseUrl;

function listen(app) {
  return new Promise((resolve) => {
    app.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${app.address().port}`));
  });
}

function close(app) {
  return new Promise((resolve) => {
    app.closeIdleConnections();
    app.close(() => resolve());
  });
}

async function postNote(body) {
  const res = await fetch(`${baseUrl}/api/notes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function listNotes() {
  const res = await fetch(`${baseUrl}/api/notes`);
  assert.equal(res.status, 200);
  return res.json();
}

function flatNotes(groups) {
  return groups.flatMap((group) => group.notes);
}

before(async () => {
  baseUrl = await listen(server);
});

beforeEach(() => {
  fs.rmSync(DATA_FILE, { force: true });
});

after(async () => {
  await close(server);
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

test("POST /api/notes creates a note with id 0 and it appears in the list", async () => {
  const created = await postNote({ title: "First note", body: "Hello world" });
  assert.equal(created.status, 201);
  assert.equal(created.data.id, 0);
  assert.equal(created.data.title, "First note");
  assert.equal(created.data.body, "Hello world");
  assert.equal(typeof created.data.createdAt, "string");

  const groups = await listNotes();
  const notes = flatNotes(groups);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].id, 0);
  assert.equal(notes[0].title, "First note");
  assert.equal(notes[0].body, "Hello world");
});

test("two notes created on the same day share one date group", async () => {
  await postNote({ title: "Morning pages", body: "Wrote a page", createdAt: "2026-11-05T09:30:00.000Z" });
  await postNote({ title: "Evening pages", body: "Wrote another", createdAt: "2026-11-05T12:15:00.000Z" });

  const groups = await listNotes();
  assert.equal(groups.length, 1);
  assert.equal(groups[0].date, "2026-11-05");
  assert.equal(groups[0].notes.length, 2);
});

test("notes from different days land in separate groups, newest day first", async () => {
  await postNote({ title: "Older", body: "From the third", createdAt: "2026-11-03T10:00:00.000Z" });
  await postNote({ title: "Newer", body: "From the fifth", createdAt: "2026-11-05T10:00:00.000Z" });

  const groups = await listNotes();
  assert.equal(groups.length, 2);
  assert.equal(groups[0].date, "2026-11-05");
  assert.deepEqual(groups[0].notes.map((n) => n.title), ["Newer"]);
  assert.equal(groups[1].date, "2026-11-03");
  assert.deepEqual(groups[1].notes.map((n) => n.title), ["Older"]);
});

test("within a group, notes are listed newest first", async () => {
  await postNote({ title: "Earlier", body: "Nine o'clock", createdAt: "2026-11-04T09:00:00.000Z" });
  await postNote({ title: "Later", body: "Two in the afternoon", createdAt: "2026-11-04T14:00:00.000Z" });

  const groups = await listNotes();
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].notes.map((n) => n.id), [1, 0]);
});

test("deleting the newest note returns 200, removes exactly it, and the list leads with the next note", async () => {
  await postNote({ title: "One", body: "First", createdAt: "2026-11-05T08:30:00.000Z" });
  await postNote({ title: "Two", body: "Second", createdAt: "2026-11-05T10:30:00.000Z" });
  await postNote({ title: "Three", body: "Third", createdAt: "2026-11-05T12:30:00.000Z" });

  const del = await fetch(`${baseUrl}/api/notes/2`, { method: "DELETE" });
  assert.equal(del.status, 200);
  const deleted = await del.json();
  assert.equal(deleted.id, 2);
  assert.equal(deleted.title, "Three");

  const groups = await listNotes();
  assert.deepEqual(flatNotes(groups).map((n) => n.id), [1, 0]);
});

test("deleting the oldest note (id 0) returns 200 and removes it", async () => {
  await postNote({ title: "One", body: "First", createdAt: "2026-11-05T08:30:00.000Z" });
  await postNote({ title: "Two", body: "Second", createdAt: "2026-11-05T10:30:00.000Z" });
  await postNote({ title: "Three", body: "Third", createdAt: "2026-11-05T12:30:00.000Z" });

  const del = await fetch(`${baseUrl}/api/notes/0`, { method: "DELETE" });
  assert.equal(del.status, 200);
  const deleted = await del.json();
  assert.equal(deleted.id, 0);

  const groups = await listNotes();
  assert.deepEqual(flatNotes(groups).map((n) => n.id), [2, 1]);
});

test("POST without a title is rejected with 400 and a reason", async () => {
  const { status, data } = await postNote({ body: "no title given" });
  assert.equal(status, 400);
  assert.equal(typeof data.error, "string");
  assert.match(data.error, /title/i);
});

test("search finds a note by an exact-case substring of the title", async () => {
  await postNote({ title: "Shopping ToDo list", body: "milk, eggs, bread" });

  const res = await fetch(`${baseUrl}/api/notes/search?q=${encodeURIComponent("ToDo")}`);
  assert.equal(res.status, 200);
  const results = await res.json();
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 0);
  assert.equal(results[0].title, "Shopping ToDo list");
});

test("search matches a substring in the body as well", async () => {
  await postNote({ title: "Groceries", body: "Buy bananas and chocolate" });

  const res = await fetch(`${baseUrl}/api/notes/search?q=bananas`);
  assert.equal(res.status, 200);
  const results = await res.json();
  assert.equal(results.length, 1);
  assert.equal(results[0].body, "Buy bananas and chocolate");
});

test("search with no matches returns an empty array", async () => {
  await postNote({ title: "Alpha", body: "beta content" });

  const res = await fetch(`${baseUrl}/api/notes/search?q=zzz-nothing-here`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});

test("GET / serves the single-page frontend", async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  assert.ok((res.headers.get("content-type") || "").startsWith("text/html"));
  const html = await res.text();
  assert.match(html, /<title>Notes<\/title>/);
  assert.match(html, /id="note-form"/);
});

test("notes persist across server restarts via the data file", async () => {
  await postNote({ title: "Durable", body: "Survives restart", createdAt: "2026-11-05T11:00:00.000Z" });
  await postNote({ title: "Also durable", body: "Still here", createdAt: "2026-11-05T13:00:00.000Z" });

  const second = createApp();
  try {
    const secondUrl = await listen(second);
    const res = await fetch(`${secondUrl}/api/notes`);
    assert.equal(res.status, 200);
    const groups = await res.json();
    assert.deepEqual(flatNotes(groups).map((n) => n.title), ["Also durable", "Durable"]);
  } finally {
    await close(second);
  }
});
