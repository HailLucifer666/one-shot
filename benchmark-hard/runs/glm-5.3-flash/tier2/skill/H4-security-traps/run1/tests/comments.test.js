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

async function seedRecipe(client) {
  const fd = new FormData();
  fd.set("title", "Pancakes");
  fd.set("ingredients", "flour\nmilk\neggs");
  fd.set("steps", "Mix.\nFry.");
  const res = await client.fetch("/recipes", { method: "POST", body: fd });
  return res.headers.get("location");
}

async function postComment(client, recipePath, body = "Tried it — delicious!") {
  return client.fetch(`${recipePath}/comments`, form({ body }));
}

test("anonymous visitors cannot comment (server-side rejection)", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const author = attachClient(ctx);
  await registerAndLogin(author, ctx.base, "maya@example.com");
  const recipePath = await seedRecipe(author);

  const anon = attachClient(ctx);
  const res = await postComment(anon, recipePath);
  assert.equal(res.status, 401);

  const page = await anon.fetch(recipePath);
  const html = await page.text();
  assert.match(html, /Log in<\/a> to join the conversation/);
  assert.doesNotMatch(html, /<form[^>]*action="[^"]*\/comments"/);
});

test("signed-in users comment; the comment shows with author and date", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const author = attachClient(ctx);
  await registerAndLogin(author, ctx.base, "maya@example.com");
  const recipePath = await seedRecipe(author);

  const commenter = attachClient(ctx);
  await registerAndLogin(commenter, ctx.base, "raj@example.com");
  const res = await postComment(commenter, recipePath, "Subbed oat milk — worked great.");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), recipePath);

  const html = await (await author.fetch(recipePath)).text();
  assert.match(html, /Subbed oat milk — worked great\./);
  assert.match(html, /raj@example\.com/);
  assert.match(html, /Comments \(1\)/);
});

test("comment validation: empty and overlong comments are rejected", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const author = attachClient(ctx);
  await registerAndLogin(author, ctx.base, "maya@example.com");
  const recipePath = await seedRecipe(author);

  const empty = await postComment(author, recipePath, "   ");
  assert.equal(empty.status, 400);
  assert.match(await empty.text(), /cannot be empty/);

  const long = await postComment(author, recipePath, "x".repeat(2001));
  assert.equal(long.status, 400);
  assert.match(await long.text(), /2,000 characters/);
});

test("comment authors cannot delete their own comments; only an admin can", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const author = attachClient(ctx);
  await registerAndLogin(author, ctx.base, "maya@example.com");
  const recipePath = await seedRecipe(author);

  const commenter = attachClient(ctx);
  await registerAndLogin(commenter, ctx.base, "raj@example.com");
  await postComment(commenter, recipePath, "Nice one!");

  // Only the admin view carries delete buttons; grab the comment id there.
  const admin = attachClient(ctx);
  await admin.fetch("/login", form({ email: ADMIN.email, password: ADMIN.password }));
  const adminHtml = await (await admin.fetch(recipePath)).text();
  const realId = adminHtml.match(/action="\/comments\/([0-9a-f-]+)\/delete"/)?.[1];
  assert.ok(realId);

  // The commenter's own view must not offer deletion.
  const commenterHtml = await (await commenter.fetch(recipePath)).text();
  assert.doesNotMatch(commenterHtml, /\/comments\/[0-9a-f-]+\/delete/);

  const selfDelete = await commenter.fetch(`/comments/${realId}/delete`, { method: "POST" });
  assert.equal(selfDelete.status, 403);

  const adminDelete = await admin.fetch(`/comments/${realId}/delete`, { method: "POST" });
  assert.equal(adminDelete.status, 302);
  const after = await (await author.fetch(recipePath)).text();
  assert.doesNotMatch(after, /Nice one!/);
  assert.match(after, /Comments \(0\)/);
});

test("deleting a recipe removes its comments", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const author = attachClient(ctx);
  await registerAndLogin(author, ctx.base, "maya@example.com");
  const recipePath = await seedRecipe(author);
  await postComment(author, recipePath, "First!");
  assert.equal(ctx.db.state.comments.length, 1);

  const del = await author.fetch(`${recipePath}/delete`, { method: "POST" });
  assert.equal(del.status, 302);
  assert.equal(ctx.db.state.comments.length, 0);
});

test("comment text is rendered escaped", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const author = attachClient(ctx);
  await registerAndLogin(author, ctx.base, "maya@example.com");
  const recipePath = await seedRecipe(author);
  await postComment(author, recipePath, '<script>window.__xss=1</script>');

  const html = await (await author.fetch(recipePath)).text();
  assert.doesNotMatch(html, /<script>window\.__xss/);
  assert.match(html, /&lt;script&gt;window\.__xss=1/);
});
