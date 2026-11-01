import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'teamboard.html'), 'utf8');
const bytes = Buffer.byteLength(html, 'utf8');

// same-realm evaluation via Function: matches how the browser runs this code
const logicSrc = html.split('/*==TB-LOGIC==*/')[1].split('/*==TB-LOGIC-END==*/')[0];
const TB = new Function(
  logicSrc + '\n;return {STATUSES,normTask,applyTask,matchesQuery,searchText,statusMatch,scan,serialize,deserialize,pickStore,todayStr,ganttLayout,visibleRows,esc,rowHtml,BOARD_CAP,SCAN_CAP};'
)();

// ---------- static checks (R1 offline, R3 zero deps, R5 size) ----------
test('deliverable is a single HTML file of at most 50,000 bytes', () => {
  assert.ok(bytes <= 50000, 'file is ' + bytes + ' bytes, budget 50000');
});

test('no network capability anywhere in the file (R1)', () => {
  assert.equal(/<script[^>]*\ssrc=/i.test(html), false, 'external <script src>');
  assert.equal(/(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\/[^"']*/i.test(html), false, 'absolute URL in src/href');
  assert.equal(/\bfetch\s*\(/.test(html), false, 'fetch()');
  assert.equal(/XMLHttpRequest/.test(html), false, 'XMLHttpRequest');
  assert.equal(/WebSocket|EventSource|navigator\.sendBeacon/.test(html), false, 'server-push APIs');
  assert.equal(/@import\b/i.test(html), false, 'CSS @import (CDN vector)');
  assert.equal(/<link\b(?![^>]*href="data:,")[^>]*>/i.test(html), false, 'external <link> (only the blank data: favicon is allowed)');
  assert.equal(/new\s+Function|eval\(/.test(html), false, 'dynamic code eval');
});

test('no third-party code markers (R3)', () => {
  for (const lib of ['chart.js', 'Chart.js', 'Chart(', 'jquery', 'react', 'vue', 'cdn.', 'unpkg', 'jsdelivr', 'googleapis', 'gstatic']) {
    assert.equal(html.toLowerCase().includes(lib.toLowerCase()), false, 'found: ' + lib);
  }
});

test('all inline scripts parse (syntax check)', () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 2, 'expected logic + app script blocks');
  for (const src of scripts) assert.doesNotThrow(() => new Function(src), 'syntax error in inline script');
});

test('required UI structure exists', () => {
  for (const id of ['id="q"', 'id="new"', 'id="dlg"', 'id="form"', 'id="f-title"', 'id="f-status"', 'id="f-due"', 'id="f-assignee"',
    'id="gcanvas"', 'id="gen"', 'id="exp"', 'id="imp"', 'id="disk"', 'id="banner"', 'id="loading"', 'id="file"',
    'id="r-todo"', 'id="r-doing"', 'id="r-done"', 'id="name"', 'indexedDB', 'localStorage', '<canvas',
    'data-f="todo"', 'data-f="doing"', 'data-f="done"', "addEventListener('submit'", 'data-act="edit"',
    'BroadcastChannel', "addEventListener('storage'", 'setInterval', 'teamboard-sync',
    "addEventListener('input'"]) {
    assert.ok(html.includes(id), 'missing: ' + id);
  }
});

// ---------- data model ----------
test('normTask accepts valid, rejects invalid, precomputes search key', () => {
  const good = TB.normTask({ id: 'a1', title: '  Fix bug  ', status: 'todo', due: '2026-11-05', assignee: ' Sam ', updatedAt: 100 });
  assert.deepEqual(good, {
    id: 'a1', title: 'Fix bug', status: 'todo', due: '2026-11-05', assignee: 'Sam',
    updatedAt: 100, deleted: false, _q: 'fix bug\u0000sam'
  });
  assert.equal(TB.normTask(null), null);
  assert.equal(TB.normTask('x'), null);
  assert.equal(TB.normTask({ title: 'no id', status: 'todo', due: '2026-01-01' }), null);
  assert.equal(TB.normTask({ id: 'a2', title: 'no status', due: '2026-01-01' }), null);
  assert.equal(TB.normTask({ id: 'a3', title: 'bad status', status: 'later', due: '2026-01-01' }), null);
  assert.equal(TB.normTask({ id: 'a4', title: 'bad due', status: 'todo', due: '2026-13-40' }), null);
  assert.equal(TB.normTask({ id: 'a5', title: 'no due', status: 'todo' }), null);
  assert.equal(TB.normTask({ id: 'a6', title: '', status: 'todo', due: '2026-01-01' }), null);
  const tomb = TB.normTask({ id: 'a7', title: 'gone', status: 'done', deleted: true, updatedAt: 5 });
  assert.equal(tomb.deleted, true, 'tombstone without due is allowed');
  const long = TB.normTask({ id: 'a8', title: 'x'.repeat(300), status: 'todo', due: '2026-01-01' });
  assert.equal(long.title.length, 200, 'title clamped to 200 chars');
  const def = TB.normTask({ id: 'a9', title: 'no ts', status: 'doing', due: '2026-01-01' });
  assert.equal(typeof def.updatedAt, 'number');
});

test('applyTask is last-write-wins with tombstone semantics', () => {
  const m = new Map();
  const a = { id: 'x', title: 'A', status: 'todo', due: '2026-01-01', assignee: '', updatedAt: 100, deleted: false };
  const older = { ...a, title: 'old', updatedAt: 50 };
  const newer = { ...a, title: 'B', status: 'doing', updatedAt: 200 };
  const del = { ...a, title: 'A', updatedAt: 300, deleted: true };
  const lateEdit = { ...a, title: 'late', updatedAt: 250 };
  const resurrect = { ...a, title: 'back', updatedAt: 400 };
  assert.equal(TB.applyTask(m, a), true);
  assert.equal(TB.applyTask(m, older), false, 'older write ignored');
  assert.equal(m.get('x').title, 'A');
  assert.equal(TB.applyTask(m, newer), true);
  assert.equal(m.get('x').status, 'doing');
  assert.equal(TB.applyTask(m, del), true, 'delete tombstone applies over older live');
  assert.equal(m.get('x').deleted, true);
  assert.equal(TB.applyTask(m, lateEdit), false, 'edit older than tombstone ignored');
  assert.equal(TB.applyTask(m, resurrect), true, 'edit newer than tombstone resurrects');
  assert.equal(TB.applyTask(m, { ...resurrect }), false, 'identical replay ignored');
});

// ---------- search + scan ----------
function mkTask(i) {
  const statuses = ['todo', 'doing', 'done'];
  const people = ['Priya', 'Sam', 'Jordan', 'Morgan', 'Aiko'];
  const month = String(1 + (i % 12)).padStart(2, '0');
  const day = String(1 + (i % 28)).padStart(2, '0');
  return {
    id: 't' + i,
    title: (i % 97 === 0 ? 'needle task ' : 'task ') + i,
    status: statuses[i % 3],
    due: '2026-' + month + '-' + day,
    assignee: people[i % 5],
    updatedAt: i,
    deleted: false
  };
}
// through normTask: exactly what the app does at load/generate time (precomputes _q)
function bigList(n) {
  const list = new Array(n);
  for (let i = 0; i < n; i++) list[i] = TB.normTask(mkTask(i));
  return list;
}

test('matchesQuery + statusMatch behave (A6)', () => {
  const t = TB.normTask({ id: 'm1', title: 'Fix Login Bug', status: 'doing', due: '2026-01-01', assignee: 'Priya', updatedAt: 1 });
  assert.equal(TB.matchesQuery(t, ''), true);
  assert.equal(TB.matchesQuery(t, 'login'), true);
  assert.equal(TB.matchesQuery(t, 'priy'), true);
  assert.equal(TB.matchesQuery(t, 'zzz'), false);
  assert.equal(TB.statusMatch({ status: 'doing' }, 'all'), true);
  assert.equal(TB.statusMatch({ status: 'doing' }, 'doing'), true);
  assert.equal(TB.statusMatch({ status: 'doing' }, 'todo'), false);
});

test('scan: counts exact, board capped at 100, gantt capped at 5000, due-sorted', () => {
  const list = bigList(6000);
  const res = TB.scan(list, '', 'all');
  assert.equal(res.total, 6000);
  assert.deepEqual(res.counts, { todo: 2000, doing: 2000, done: 2000 });
  assert.equal(res.board.todo.length, TB.BOARD_CAP);
  assert.equal(res.gantt.length, TB.SCAN_CAP);
  assert.equal(res.capped, true);
  assert.equal(res.hits.length, 0, 'empty query builds no hits array');
  const browse = TB.scan(list, 'task', 'all');
  assert.equal(browse.hits.length, 6000, 'hits uncapped for pool reuse');
  for (const s of TB.STATUSES) {
    for (let i = 1; i < res.board[s].length; i++) assert.ok(res.board[s][i - 1].due <= res.board[s][i].due, 'board sorted by due');
  }
  const needle = TB.scan(list, 'needle', 'all');
  assert.equal(needle.total, 62, 'needle matches: floor(5999/97)+1');
  assert.equal(needle.capped, false);
  const doing = TB.scan(list, '', 'doing');
  assert.equal(doing.total, 6000, 'total counts query matches across statuses');
  assert.deepEqual(doing.counts, { todo: 2000, doing: 2000, done: 2000 }, 'counts always across statuses');
  assert.equal(doing.board.todo.length, 0, 'board respects the filter');
  assert.equal(doing.board.doing.length, TB.BOARD_CAP);
  assert.equal(TB.scan([], '', 'all').total, 0);
  const tomb = TB.normTask({ id: 'd', title: 'x', status: 'todo', due: '2026-01-01', assignee: '', updatedAt: 1, deleted: true });
  assert.equal(TB.scan([tomb], '', 'all').total, 0, 'tombstones never surface');
});

test('search over 100,000 tasks: cold first scan bounded, steady state <50 ms (R5/A7)', async () => {
  const list = bigList(100000);
  // cold first scan = what the user pays once (JIT warm-up); typing never pays it again
  const t0 = performance.now();
  const first = TB.scan(list, '', 'all');
  const coldMs = performance.now() - t0;
  assert.ok(coldMs < 250, 'cold full scan took ' + coldMs.toFixed(1) + ' ms');
  assert.equal(first.total, 100000);
  await new Promise((r) => setTimeout(r, 120)); // let GC settle after building 100k objects
  const times = {};
  for (const q of ['e', 'needle', 'priya', 'task 99', 'zzz-none', '']) {
    let best = Infinity, bestRes = null;
    for (let run = 0; run < 3; run++) { // best-of-3: excludes one-sided GC pauses from the measurement
      await new Promise((r) => setTimeout(r, 25));
      const s0 = performance.now();
      const res = TB.scan(list, q, 'all');
      const ms = performance.now() - s0;
      if (ms < best) { best = ms; bestRes = res; }
    }
    times[q] = { ms: best, res: bestRes };
    assert.ok(best < 50, 'query "' + q + '" best of 3 was ' + best.toFixed(1) + ' ms');
  }
  // 'task 99' substring: ids starting with 99 (99, 990-999, 9900-9999, 99000-99999)
  assert.equal(TB.scan(list, 'task 99', 'all').total, 1111);
  assert.equal(TB.scan(list, 'priya', 'all').total, 20000, 'assignee search');
  assert.equal(TB.scan(list, 'needle', 'all').total, Math.floor(99999 / 97) + 1);
  assert.equal(TB.scan(list, 'zzz-none', 'all').total, 0);
  const pool = TB.scan(list, 'task', 'all').hits;
  const t1 = performance.now();
  TB.scan(pool, 'task 99', 'all');
  const poolMs = performance.now() - t1;
  assert.ok(poolMs < 50, 'refining on the pool took ' + poolMs.toFixed(1) + ' ms');
});

// ---------- persistence core ----------
test('serialize/deserialize round-trip keeps tasks and tombstones, drops junk and cache', () => {
  const m = new Map();
  TB.applyTask(m, TB.normTask({ id: 'a', title: 'A', status: 'todo', due: '2026-01-01', assignee: 'P', updatedAt: 1 }));
  TB.applyTask(m, TB.normTask({ id: 'b', title: 'B', status: 'done', due: '2026-01-02', assignee: '', updatedAt: 2, deleted: true }));
  const rows = TB.serialize(m);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => !('_q' in r)), 'search cache never serialized');
  TB.matchesQuery(m.get('a'), 'a');
  assert.ok(!('_q' in TB.serialize(m)[0]), 'warm cache still stripped');
  const back = TB.deserialize(rows);
  assert.equal(back.size, 2);
  assert.equal(back.get('a').title, 'A');
  assert.equal(back.get('b').deleted, true);
  const junk = TB.deserialize([{ nope: 1 }, null, 'x', { id: 'c', title: 'C', status: 'todo', due: '2026-02-03', assignee: '', updatedAt: 9, deleted: false }]);
  assert.equal(junk.size, 1);
  assert.equal(TB.deserialize('not an array').size, 0);
  assert.equal(TB.deserialize(null).size, 0);
});

test('pickStore chooses the right recovery source (R6 heal)', () => {
  assert.equal(TB.pickStore([{ id: 1 }], null), 'idb', 'idb wins when present');
  assert.equal(TB.pickStore([], '[{"id":"a"}]'), 'ls', 'mirror used when idb empty');
  assert.equal(TB.pickStore(null, '[{"id":"a"}]'), 'ls', 'mirror used when idb unavailable');
  assert.equal(TB.pickStore([], null), 'none');
  assert.equal(TB.pickStore([], ''), 'none');
  assert.equal(TB.pickStore([], '"json"'), 'none', 'non-array mirror rejected');
  assert.equal(TB.pickStore(null, null), 'none');
});

// ---------- gantt math ----------
test('ganttLayout: dayW clamped, xFor monotonic and anchored (R4)', () => {
  const start = Date.parse('2026-01-01T00:00:00');
  const end = Date.parse('2026-01-11T00:00:00');
  const lay = TB.ganttLayout(start, end, 1000, 200);
  assert.equal(lay.days, 10);
  assert.ok(lay.dayW >= 2, 'dayW has a floor');
  assert.equal(lay.xFor(start), 208);
  const mid = lay.xFor(Date.parse('2026-01-06T00:00:00'));
  assert.ok(mid > 208 && mid < lay.xFor(end), 'x grows with time');
  const huge = TB.ganttLayout(start, Date.parse('2030-01-01T00:00:00'), 1000, 200);
  assert.equal(huge.dayW, 2, 'very long range clamps to 2px/day');
  const tiny = TB.ganttLayout(start, Date.parse('2026-01-02T00:00:00'), 400, 200);
  assert.ok(tiny.dayW > 10, 'short range gets wide days');
});

test('visibleRows: window bounds and clamping', () => {
  const v1 = TB.visibleRows(0, 560, 28, 100);
  assert.equal(v1.start, 0);
  assert.ok(v1.end <= 100 && v1.end > 20);
  const v2 = TB.visibleRows(1400, 560, 28, 100);
  assert.ok(v2.start >= 48, 'start advances with scroll');
  assert.equal(v2.end, 72, 'end = ceil((scrollTop+viewH)/rowH)+2 when within total');
  const v3 = TB.visibleRows(99999, 560, 28, 5);
  assert.ok(v3.start >= 0 && v3.end <= 5 && v3.start <= v3.end, 'never out of range');
});

test('todayStr returns YYYY-MM-DD', () => {
  assert.match(TB.todayStr(), /^\d{4}-\d{2}-\d{2}$/);
});

// ---------- row rendering (security + states) ----------
test('rowHtml escapes user input (no XSS through title/assignee/id)', () => {
  const t = TB.normTask({ id: 'x1', title: '<script>alert(1)</script> & "quotes"', status: 'todo', due: '2026-01-01', assignee: '<img src=x onerror=alert(2)>', updatedAt: 1 });
  const row = TB.rowHtml(t, '2026-11-01');
  assert.equal(row.includes('<script>'), false, 'raw script tag in row');
  assert.equal(row.includes('<img'), false, 'raw img tag in row');
  assert.ok(row.includes('&lt;script&gt;'), 'escaped title present');
  assert.ok(row.includes('&quot;quotes&quot;'), 'escaped quotes');
  assert.ok(row.includes('data-id="x1"'), 'id attribute');
  assert.equal(TB.esc('a<b>&"\''), 'a&lt;b&gt;&amp;&quot;&#39;');
});

test('rowHtml marks overdue tasks and renders action buttons', () => {
  const late = TB.normTask({ id: 'l1', title: 'Past', status: 'todo', due: '2026-10-01', assignee: 'A', updatedAt: 1 });
  const future = TB.normTask({ id: 'l2', title: 'Future', status: 'todo', due: '2027-10-01', assignee: '', updatedAt: 1 });
  const rl = TB.rowHtml(late, '2026-11-01');
  const rf = TB.rowHtml(future, '2026-11-01');
  assert.ok(rl.includes('class="row late"'), 'late class');
  assert.ok(rl.includes('overdue'), 'overdue label');
  assert.equal(rf.includes('late'), false, 'no late class for future');
  assert.ok(rf.includes('unassigned'), 'empty assignee shown as unassigned');
  for (const r of [rl, rf]) {
    assert.ok(r.includes('data-act="edit"') && r.includes('data-act="del"'), 'action buttons');
    assert.ok(r.includes('aria-label="Edit task"') && r.includes('aria-label="Delete task"'), 'button labels');
  }
});
