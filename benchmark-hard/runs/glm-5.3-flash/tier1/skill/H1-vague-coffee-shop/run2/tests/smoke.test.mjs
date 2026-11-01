// Smoke test for the coffee shop site. Zero dependencies: node:test + node:http.
// Run from the project root: node tests/smoke.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  let filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

let baseUrl = '';

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function get(urlPath) {
  const res = await fetch(`${baseUrl}${urlPath}`);
  return { status: res.status, type: res.headers.get('content-type') || '', body: await res.text() };
}

// --- WCAG contrast helpers ---------------------------------------------------
function luminance(hex) {
  const c = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  const lin = channels.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastRatio(fg, bg) {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

function cssVariables(css) {
  const vars = {};
  for (const m of css.matchAll(/--([a-zA-Z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) {
    vars[`--${m[1]}`] = m[2];
  }
  return vars;
}

// Text/background pairs that must reach WCAG AA for body-size text (4.5:1).
const CONTRAST_PAIRS = [
  ['--ink', '--paper', 'body text on page background'],
  ['--ink-muted', '--paper', 'secondary text on page background'],
  ['--accent', '--paper', 'links and accents as text on page background'],
  ['--cream', '--espresso', 'text on dark hero/footer'],
  ['--ink', '--accent-bright', 'button text on brand-orange background'],
];

// --- Tests -------------------------------------------------------------------
test('GET / serves the page as HTML', async () => {
  const res = await get('/');
  assert.equal(res.status, 200, 'index.html must be served at /');
  assert.match(res.type, /text\/html/);
  assert.match(res.body, /<!doctype html>/i);
});

test('head has viewport, title, description, Open Graph and favicon', async () => {
  const html = (await get('/')).body;
  assert.match(html, /<meta\s+name="viewport"\s+content="[^"]+/i);
  assert.match(html, /<title>[^<]{5,}<\/title>/i);
  assert.match(html, /<meta\s+name="description"\s+content="[^"]{20,}"/i);
  assert.match(html, /<meta\s+property="og:title"/i);
  assert.match(html, /<meta\s+property="og:description"/i);
  assert.match(html, /<meta\s+property="og:type"\s+content="website"/i);
  assert.match(html, /<link\s+rel="icon"/i);
});

test('exactly one h1 and semantic landmarks', async () => {
  const html = (await get('/')).body;
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, 'page must have exactly one h1');
  for (const tag of ['header', 'nav', 'main', 'footer']) {
    assert.match(html, new RegExp(`<${tag}[\\s>]`), `<${tag}> landmark required`);
  }
  assert.match(html, /<section[^>]*id="hero"/);
  assert.match(html, /<section[^>]*id="about"/);
  assert.match(html, /<section[^>]*id="menu"/);
  assert.match(html, /<section[^>]*id="visit"/);
});

test('nav links point to existing section ids', async () => {
  const html = (await get('/')).body;
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
  for (const anchor of [...nav.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])) {
    assert.ok(ids.has(anchor), `nav links to #${anchor} but no element carries that id`);
  }
});

test('menu lists the six owner-sheet items with exact prices', async () => {
  const html = (await get('/')).body;
  const menu = html.slice(html.indexOf('id="menu"'), html.indexOf('id="visit"'));
  const items = [
    ['Espresso', '$3.00'],
    ['Flat White', '$4.25'],
    ['Cold Brew', '$4.75'],
    ['Oat Milk Latte', '$5.00'],
    ['Almond Croissant', '$3.75'],
    ['Cardamom Bun', '$3.50'],
  ];
  const rows = menu.match(/<li>[\s\S]*?<\/li>/g) || [];
  for (const [name, price] of items) {
    assert.ok(
      rows.some((li) => li.includes(name) && li.includes(price)),
      `menu must pair ${name} with ${price} in one item`
    );
  }
  assert.ok((menu.match(/\$\d/g) || []).length >= 6, 'menu needs at least 6 priced items');
});

test('visit shows the exact address, phone, email and owner-sheet hours', async () => {
  const html = (await get('/')).body;
  const visit = html.slice(html.indexOf('id="visit"'));
  assert.ok(visit.includes('14 Lantern Lane, Riverton'), 'exact address required');
  assert.match(visit, /href="tel:555-0142"/, 'phone link required');
  assert.ok(visit.includes('555-0142'), 'phone display required');
  assert.match(visit, /href="mailto:hello@emberandoak\.example"/, 'email link required');
  assert.ok(visit.includes('Monday to Friday'), 'weekday hours label required');
  assert.ok(visit.includes('7:00 am to 6:00 pm'), 'weekday hours required');
  assert.ok(visit.includes('Saturday and Sunday'), 'weekend hours label required');
  assert.ok(visit.includes('8:00 am to 4:00 pm'), 'weekend hours required');
});

test('round-1 acceptance: colors, fonts, brand, about text, email link', async () => {
  const html = (await get('/')).body;
  const css = (await get('/css/styles.css')).body;
  const cssLower = css.toLowerCase();
  for (const hex of ['#3b2a20', '#d9822b', '#1e1612', '#faf5ee']) {
    assert.ok(cssLower.includes(hex), `CSS must include ${hex}`);
  }
  assert.ok(/font-family[^;]*Fraunces/i.test(css), 'Fraunces must be named in a font-family declaration');
  assert.ok(/font-family[^;]*Inter/i.test(css), 'Inter must be named in a font-family declaration');
  assert.ok(html.includes('Ember & Oak'), 'brand name must appear');
  assert.ok(
    html.includes(
      'Ember & Oak opened in 2019 in a former hardware store. We roast in small batches every Tuesday. Everything in the case is baked before sunrise.'
    ),
    'about text must appear word for word'
  );
  assert.match(html, /href="mailto:hello@emberandoak\.example"/, 'exact email link required');
});

test('every internal link and asset reference resolves', async () => {
  let html = (await get('/')).body;
  html = html.replace(/<!--[\s\S]*?-->/g, ''); // ignore commented-out content
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const checked = new Set();
  for (const ref of refs) {
    if (/^(https?:|mailto:|tel:)/.test(ref) || checked.has(ref)) continue;
    checked.add(ref);
    if (ref.startsWith('#')) {
      assert.ok(ids.has(ref.slice(1)), `fragment link ${ref} has no matching id`);
      continue;
    }
    const res = await get(ref.startsWith('/') ? ref : `/${ref}`);
    assert.equal(res.status, 200, `internal reference ${ref} must resolve`);
  }
  assert.ok(checked.size > 0, 'expected at least one internal reference to check');
});

test('css, js and favicon are served', async () => {
  const css = await get('/css/styles.css');
  assert.equal(css.status, 200, 'css/styles.css must exist');
  assert.match(css.type, /text\/css/);
  const js = await get('/js/main.js');
  assert.equal(js.status, 200, 'js/main.js must exist');
  const fav = await get('/assets/favicon.svg');
  assert.equal(fav.status, 200, 'assets/favicon.svg must exist');
  assert.match(fav.type, /svg/);
});

test('declared text/background pairs pass WCAG AA (4.5:1)', async () => {
  const css = (await get('/css/styles.css')).body;
  const vars = cssVariables(css);
  for (const [fg, bg, label] of CONTRAST_PAIRS) {
    assert.ok(vars[fg], `CSS must define ${fg} as a 6-digit hex color`);
    assert.ok(vars[bg], `CSS must define ${bg} as a 6-digit hex color`);
    const ratio = contrastRatio(vars[fg], vars[bg]);
    assert.ok(
      ratio >= 4.5,
      `${label} (${fg} ${vars[fg]} on ${bg} ${vars[bg]}) is ${ratio.toFixed(2)}:1, needs >= 4.5:1`
    );
  }
});

test('css is responsive and respects reduced motion', async () => {
  const css = (await get('/css/styles.css')).body;
  assert.match(css, /@media[^{]*max-width:\s*(360px|480px|768px)/, 'mobile breakpoint required');
  assert.match(css, /@media[^{]*min-width:\s*(768px|1024px)/, 'desktop breakpoint required');
  assert.match(css, /@media[^{]*prefers-reduced-motion/, 'prefers-reduced-motion support required');
  assert.match(css, /:focus-visible/, 'visible focus styles required');
});

test('js/main.js passes node --check', () => {
  const jsPath = path.join(ROOT, 'js', 'main.js');
  assert.ok(fs.existsSync(jsPath), 'js/main.js must exist');
  execFileSync(process.execPath, ['--check', jsPath]);
});

test('no unfinished placeholders in shipped content', async () => {
  const html = (await get('/')).body;
  assert.doesNotMatch(html, /lorem ipsum/i);
  assert.doesNotMatch(html, /TODO|FIXME|XXX|placeholder text/i);
});
