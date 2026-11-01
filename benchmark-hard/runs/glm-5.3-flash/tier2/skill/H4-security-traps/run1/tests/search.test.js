import test from "node:test";
import assert from "node:assert/strict";
import { startApp, attachClient, registerAndLogin } from "./helpers.js";

async function seedBoard(client) {
  const recipes = [
    { title: "Sunday Lentil Soup", ingredients: "1 cup lentils\n2 carrots\n1 onion", steps: "Simmer everything." },
    { title: "Chocolate Cake", ingredients: "200g dark chocolate\nflour\nsugar", steps: "Bake at 180C." },
    { title: "Onion Tart", ingredients: "puff pastry\n3 onions\ncream", steps: "Caramelize onions." },
  ];
  const paths = [];
  for (const r of recipes) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(r)) fd.set(k, v);
    const res = await client.fetch("/recipes", { method: "POST", body: fd });
    paths.push(res.headers.get("location"));
  }
  return paths;
}

test("search matches title (case-insensitive)", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const author = attachClient(ctx);
  await registerAndLogin(author, ctx.base, "maya@example.com");
  const paths = await seedBoard(author);
  const anon = attachClient(ctx);

  const res = await anon.fetch("/?q=LENTIL");
  const html = await res.text();
  assert.match(html, /Sunday Lentil Soup/);
  assert.doesNotMatch(html, /Chocolate Cake/);
  assert.doesNotMatch(html, /Onion Tart/);
  assert.match(html, /1 recipe found/);
  assert.match(html, /Clear search/);
});

test("search matches ingredients too", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const author = attachClient(ctx);
  await registerAndLogin(author, ctx.base, "maya@example.com");
  await seedBoard(author);
  const anon = attachClient(ctx);

  const res = await anon.fetch("/?q=onion");
  const html = await res.text();
  assert.match(html, /Sunday Lentil Soup/);
  assert.match(html, /Onion Tart/);
  assert.doesNotMatch(html, /Chocolate Cake/);
  assert.match(html, /2 recipes found/);
});

test("search with no matches shows a useful empty state", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const author = attachClient(ctx);
  await registerAndLogin(author, ctx.base, "maya@example.com");
  await seedBoard(author);
  const anon = attachClient(ctx);

  const res = await anon.fetch("/?q=pizza");
  const html = await res.text();
  assert.match(html, /No recipes match that search/);
  assert.match(html, /value="pizza"/);
});

test("search input is escaped: query strings cannot inject markup", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const anon = attachClient(ctx);

  const res = await anon.fetch("/?q=" + encodeURIComponent('<script>alert(1)</script>" onmouseover="x=1'));
  const html = await res.text();
  assert.doesNotMatch(html, /<script>alert\(1\)/);
  assert.doesNotMatch(html, / onmouseover="x=1/);
  assert.match(html, /&lt;script&gt;alert\(1\)/);
});

test("search is available to anonymous visitors", async (t) => {
  const ctx = await startApp();
  t.after(() => ctx.close());
  const author = attachClient(ctx);
  await registerAndLogin(author, ctx.base, "maya@example.com");
  await seedBoard(author);
  const anon = attachClient(ctx);
  const res = await anon.fetch("/?q=chocolate");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Chocolate Cake/);
});
