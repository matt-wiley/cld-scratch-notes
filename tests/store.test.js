import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, titleOf, snippetOf, stats, DAY, TRASH_DAYS } from '../js/store.js';

function mem() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
function clock(start = 1_700_000_000_000) {
  const c = { t: start, now: () => c.t, advance: (ms) => (c.t += ms) };
  return c;
}

test('titleOf strips markdown and skips non-text lines', () => {
  assert.equal(titleOf('\n\n# Hello **there**\nbody'), 'Hello there');
  assert.equal(titleOf('- [ ] buy [milk](https://x)'), 'buy milk');
  assert.equal(titleOf('```\ncode\n```'), 'code');
  assert.equal(titleOf('---\n\n> quote'), 'quote');
  assert.equal(titleOf('   \n'), '');
  assert.equal(titleOf('x'.repeat(100)).length, 80);
});

test('snippetOf skips the title', () => {
  assert.equal(snippetOf('# T\nline one\n\n- two'), 'line one · two');
  assert.equal(snippetOf('only'), '');
});

test('stats', () => {
  assert.deepEqual(stats('a b\nc'), { chars: 5, words: 3, lines: 2 });
  assert.deepEqual(stats(''), { chars: 0, words: 0, lines: 0 });
});

test('create, update, persist and reload', () => {
  const storage = mem();
  const c = clock();
  const s = new Store({ storage, now: c.now });
  const n = s.create('hello');
  c.advance(1000);
  s.update(n.id, 'hello world');
  const again = new Store({ storage, now: c.now });
  assert.equal(again.get(n.id).body, 'hello world');
  assert.equal(again.get(n.id).updated, n.created + 1000);
});

test('update with identical body does not bump updated', () => {
  const c = clock();
  const s = new Store({ storage: mem(), now: c.now });
  const n = s.create('x');
  c.advance(5000);
  s.update(n.id, 'x');
  assert.equal(s.get(n.id).updated, n.created);
});

test('active ordering: pinned first, then most recent', () => {
  const c = clock();
  const s = new Store({ storage: mem(), now: c.now });
  const a = s.create('a');
  c.advance(1);
  const b = s.create('b');
  c.advance(1);
  s.setPinned(a.id, true);
  assert.deepEqual(s.active().map((n) => n.body), ['a', 'b']);
  s.setPinned(a.id, false);
  assert.deepEqual(s.active().map((n) => n.body), ['b', 'a']);
});

test('append adds on a new line, trimming trailing whitespace', () => {
  const s = new Store({ storage: mem() });
  const n = s.create('');
  s.append(n.id, 'first\n');
  s.append(n.id, 'second');
  assert.equal(s.get(n.id).body, 'first\nsecond');
  s.update(n.id, 'x\n\n\n');
  s.append(n.id, 'y');
  assert.equal(s.get(n.id).body, 'x\ny');
});

test('search requires every term, case-insensitive, excludes trash', () => {
  const s = new Store({ storage: mem() });
  s.create('Alpha beta');
  const t = s.create('alpha gamma');
  s.trash(t.id);
  assert.equal(s.search('ALPHA').length, 1);
  assert.equal(s.search('alpha gamma').length, 0);
  assert.equal(s.search('').length, 1);
});

test('trash, restore, purge, emptyTrash', () => {
  const s = new Store({ storage: mem() });
  const a = s.create('a');
  const b = s.create('b');
  s.trash(a.id);
  assert.equal(s.trashed().length, 1);
  s.restore(a.id);
  assert.equal(s.trashed().length, 0);
  s.trash(a.id);
  s.trash(b.id);
  s.purge(a.id);
  assert.equal(s.get(a.id), null);
  assert.equal(s.emptyTrash(), 1);
  assert.equal(s.state.notes.length, 0);
});

test('pruneEmpty keeps the given note, pinned notes and the trash', () => {
  const s = new Store({ storage: mem() });
  const keep = s.create('');
  s.create('  \n');
  const pinned = s.create('');
  s.setPinned(pinned.id, true);
  const full = s.create('x');
  const gone = s.create('');
  s.trash(gone.id);
  s.pruneEmpty(keep.id);
  assert.deepEqual(new Set(s.state.notes.map((n) => n.id)), new Set([keep.id, pinned.id, full.id, gone.id]));
});

test('sweep: auto-clear expires unpinned, untouched notes; trash purges after TRASH_DAYS', () => {
  const c = clock();
  const s = new Store({ storage: mem(), now: c.now });
  const old = s.create('old');
  const pin = s.create('pinned');
  s.setPinned(pin.id, true);
  const open = s.create('open one');
  c.advance(2 * DAY);
  const fresh = s.create('fresh');

  assert.deepEqual(s.sweep(), { expired: 0, purged: 0 }); // expiry off by default
  s.setExpireDays(1);
  assert.deepEqual(s.sweep(open.id), { expired: 1, purged: 0 });
  assert.ok(s.get(old.id).deletedAt);
  assert.ok(!s.get(pin.id).deletedAt);
  assert.ok(!s.get(open.id).deletedAt);
  assert.ok(!s.get(fresh.id).deletedAt);

  c.advance(TRASH_DAYS * DAY);
  s.setExpireDays(0);
  assert.deepEqual(s.sweep(), { expired: 0, purged: 1 });
  assert.equal(s.get(old.id), null);
  assert.throws(() => s.setExpireDays(3));
});

test('import merges by id with newer edit winning; replace swaps everything', () => {
  const c = clock();
  const a = new Store({ storage: mem(), now: c.now });
  const n = a.create('v1');
  const backup = a.exportJson();
  c.advance(10);
  a.update(n.id, 'v2');
  a.create('local only');

  assert.equal(a.importJson(backup), 0); // older copy loses
  assert.equal(a.get(n.id).body, 'v2');

  const b = new Store({ storage: mem(), now: c.now });
  b.create('other');
  assert.equal(b.importJson(a.exportJson()), 2);
  assert.equal(b.active().length, 3);

  assert.equal(b.importJson(backup, { replace: true }), 1);
  assert.equal(b.active()[0].body, 'v1');

  assert.throws(() => b.importJson('nope'), /valid JSON/);
  assert.throws(() => b.importJson('{"x":1}'), /backup/);
});

test('corrupt storage falls back to empty state; bad notes are dropped', () => {
  const storage = mem();
  storage.setItem('scratchpad:data', '{oops');
  assert.equal(new Store({ storage }).state.notes.length, 0);
  storage.setItem('scratchpad:data', JSON.stringify({ notes: [null, 5, { id: 'a', body: 'ok' }, { id: 'a', body: 'dupe' }], settings: { expireDays: 99 } }));
  const s = new Store({ storage });
  assert.equal(s.state.notes.length, 1);
  assert.equal(s.state.settings.expireDays, 0);
});

test('quota errors surface as a readable error', () => {
  const storage = mem();
  const s = new Store({ storage });
  storage.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  assert.throws(() => s.create('x'), /Local storage is full/);
});

test('works without storage', () => {
  const s = new Store({ storage: null });
  s.create('x');
  assert.equal(s.bytes, 0);
});
