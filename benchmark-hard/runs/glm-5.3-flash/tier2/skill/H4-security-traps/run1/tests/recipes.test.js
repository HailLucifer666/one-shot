import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startApp, attachClient, registerAndLogin, pngBytes, jpgBytes, oversizePngBytes, ADMIN } from "./helpers.js";

function form(body) {
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  };
}

function recipeFields(overrides = {}) {
  return {
    title: "Sunday Lentil Soup",
    ingredients: "1 cup lentils\n2 carrots\n1 onion",
    steps: "Chop the vegetables.\nSimmer for 30 minutes.",
    ...overrides,
  };
}

async function createRecipe(client, overrides = {}, withPhoto = null) {
  const fd = new FormData();
  const fields = recipeFields(overrides);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (withPhoto) {
    fd.set("photo", new Blob([withPhoto.bytes], { type: withPhoto.type }), withPhoto.name);
  }
  const res = await client.fetch("/recipes", { method: "POST", body: fd });
  return res;
}

function idFromLocation(res) {
  const loc = res.headers.get("location") || "";
  const m = loc.match(/^\/recipes\/([0-9a-f-]+)$/);
  return m ? m[1] : null;
}

test("anonymous users are redirected away from the new-recipe form and rejected on POST", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const anon = attachClient(ctx);

  const page = await anon.fetch("/recipes/new");
  assert.equal(page.status, 302);
  assert.match(page.headers.get("location"), /^\/login\?next=%2Frecipes%2Fnew$/);

  const post = await anon.fetch("/recipes", { method: "POST", body: new URLSearchParams(recipeFields()).toString() });
  assert.equal(post.status, 401);
});

test("signed-in user posts a recipe without a photo; anyone can read it", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const author = attachClient(ctx);
  await registerAndLogin(author, ctx.base, "maya@example.com");

  const res = await createRecipe(author);
  assert.equal(res.status, 302);
  const id = idFromLocation(res);
  assert.ok(id, "redirects to the recipe page");

  const anon = attachClient(ctx);
  const detail = await anon.fetch(`/recipes/${id}`);
  assert.equal(detail.status, 200);
  const html = await detail.text();
  assert.match(html, /Sunday Lentil Soup/);
  assert.match(html, /1 cup lentils/);
  assert.match(html, /Simmer for 30 minutes\./);
  assert.match(html, /maya@example\.com/);
  assert.match(html, /Summarize/);

  const home = await anon.fetch("/");
  assert.match(await home.text(), /Sunday Lentil Soup/);
});

test("valid PNG and JPG uploads are accepted; file stored under a server-generated name", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());

  const author = attachClient(ctx);
  await registerAndLogin(author, ctx.base, "maya@example.com");
  const res = await createRecipe(author, {}, { bytes: pngBytes(), type: "image/png", name: "my-photo.png" });
  assert.equal(res.status, 302);
  const id = idFromLocation(res);

  const detail = await author.fetch(`/recipes/${id}`);
  const html = await detail.text();
  const photoMatch = html.match(/src="\/photos\/([a-f0-9]{32}\.png)"/);
  assert.ok(photoMatch, "page references the stored photo");
  const storedName = photoMatch[1];

  const files = fs.readdirSync(path.join(ctx.dataDir, "uploads"));
  assert.deepEqual(files, [storedName], "stored under the server-generated name, not the client's");

  const anon = attachClient(ctx);
  const photo = await anon.fetch(`/photos/${storedName}`);
  assert.equal(photo.status, 200);
  assert.match(photo.headers.get("content-type") || "", /image\/png/);
  const body = Buffer.from(await photo.arrayBuffer());
  assert.deepEqual([...body.slice(0, 8)], [...pngBytes().slice(0, 8)]);
  assert.equal(photo.headers.get("x-content-type-options"), "nosniff");

  const author2 = attachClient(ctx);
  await registerAndLogin(author2, ctx.base, "raj@example.com");
  const res2 = await createRecipe(author2, { title: "Grilled Cheese" }, { bytes: jpgBytes(), type: "image/jpeg", name: "toast.jpg" });
  assert.equal(res2.status, 302);
  const detail2 = await author2.fetch(`/recipes/${idFromLocation(res2)}`);
  assert.match(await detail2.text(), /\/photos\/[a-f0-9]{32}\.jpg/);
});

test("content that is not really a JPG/PNG is rejected even when named .png and declared image/png", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const author = attachClient(ctx);
  await registerAndLogin(author, ctx.base, "maya@example.com");

  const res = await createRecipe(
    author,
    {},
    { bytes: Buffer.from('<img src=x onerror="alert(1)">'), type: "image/png", name: "evil.png" }
  );
  assert.equal(res.status, 400);
  const html = await res.text();
  assert.match(html, /Photo must be a JPG or PNG/);
  assert.equal(fs.readdirSync(path.join(ctx.dataDir, "uploads")).length, 0, "nothing written to disk");
});

test("photos over 2 MB are rejected with 413", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const author = attachClient(ctx);
  await registerAndLogin(author, ctx.base, "maya@example.com");

  const res = await createRecipe(author, {}, { bytes: oversizePngBytes(), type: "image/png", name: "big.png" });
  assert.equal(res.status, 413);
  assert.match(await res.text(), /2 MB/);
});

test("invalid recipe fields are rejected with messages", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const author = attachClient(ctx);
  await registerAndLogin(author, ctx.base, "maya@example.com");

  const res = await createRecipe(author, { title: "", ingredients: "", steps: "" });
  assert.equal(res.status, 400);
  const html = await res.text();
  assert.match(html, /Title is required/);
  assert.match(html, /Ingredients are required/);
  assert.match(html, /Steps are required/);
});

test("only the owner can edit; the edit works", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const author = attachClient(ctx);
  await registerAndLogin(author, ctx.base, "maya@example.com");
  const res = await createRecipe(author, {}, { bytes: pngBytes(), type: "image/png", name: "a.png" });
  const id = idFromLocation(res);

  const other = attachClient(ctx);
  await registerAndLogin(other, ctx.base, "raj@example.com");
  assert.equal((await other.fetch(`/recipes/${id}/edit`)).status, 403);
  assert.equal((await other.fetch(`/recipes/${id}/edit`, form(recipeFields({ title: "Hacked" })))).status, 403);

  const editPage = await author.fetch(`/recipes/${id}/edit`);
  assert.equal(editPage.status, 200);
  assert.match(await editPage.text(), /Sunday Lentil Soup/);

  const saved = await author.fetch(
    `/recipes/${id}/edit`,
    form(recipeFields({ title: "Best Lentil Soup", ingredients: "2 cups lentils\n1 onion" }))
  );
  assert.equal(saved.status, 302);
  const html = await (await author.fetch(`/recipes/${id}`)).text();
  assert.match(html, /Best Lentil Soup/);
  assert.match(html, /2 cups lentils/);
  assert.match(html, /edited/);
});

test("edit can remove or replace the photo", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const author = attachClient(ctx);
  await registerAndLogin(author, ctx.base, "maya@example.com");
  const res = await createRecipe(author, {}, { bytes: pngBytes(), type: "image/png", name: "a.png" });
  const id = idFromLocation(res);

  const fd = new FormData();
  for (const [k, v] of Object.entries(recipeFields())) fd.set(k, v);
  fd.set("removePhoto", "1");
  const removed = await author.fetch(`/recipes/${id}/edit`, { method: "POST", body: fd });
  assert.equal(removed.status, 302);
  const html = await (await author.fetch(`/recipes/${id}`)).text();
  assert.doesNotMatch(html, /\/photos\//);
  assert.equal(fs.readdirSync(path.join(ctx.dataDir, "uploads")).length, 0, "old file deleted");
});

test("non-owner cannot delete; owner and admin can", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());

  const author = attachClient(ctx);
  await registerAndLogin(author, ctx.base, "maya@example.com");
  const r1 = await createRecipe(author, { title: "Maya Soup" });
  const id1 = idFromLocation(r1);

  const other = attachClient(ctx);
  await registerAndLogin(other, ctx.base, "raj@example.com");
  const r2 = await createRecipe(other, { title: "Raj Stew" });
  const id2 = idFromLocation(r2);

  assert.equal((await other.fetch(`/recipes/${id1}/delete`, { method: "POST" })).status, 403);

  const admin = attachClient(ctx);
  const adminLogin = await admin.fetch("/login", form({ email: ADMIN.email, password: ADMIN.password }));
  assert.equal(adminLogin.status, 302);
  const deleted = await admin.fetch(`/recipes/${id2}/delete`, { method: "POST" });
  assert.equal(deleted.status, 302);
  assert.equal((await attachClient(ctx).fetch(`/recipes/${id2}`)).status, 404);

  const own = await author.fetch(`/recipes/${id1}/delete`, { method: "POST" });
  assert.equal(own.status, 302);
  const home = await (await attachClient(ctx).fetch("/")).text();
  assert.doesNotMatch(home, /Maya Soup/);
  assert.doesNotMatch(home, /Raj Stew/);
});

test("admin signs in with the seeded credentials", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const admin = attachClient(ctx);
  const res = await admin.fetch(
    "/login",
    form({ email: ADMIN.email, password: ADMIN.password })
  );
  assert.equal(res.status, 302);
  const home = await (await admin.fetch("/")).text();
  assert.match(home, /admin@recipebox\.local/);
});

test("photo route refuses anything that is not a server-generated name", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const anon = attachClient(ctx);

  assert.equal((await anon.fetch("/photos/..%2Fdb.json")).status, 404);
  assert.equal((await anon.fetch("/photos/ ../../db.json")).status, 404);
  assert.equal((await anon.fetch("/photos/0123456789abcdef0123456789abcdef.png")).status, 404);
  assert.equal((await anon.fetch("/photos/short.png")).status, 404);
  assert.equal((await anon.fetch("/photos/0123456789abcdef0123456789abcdef.txt")).status, 404);
});
