import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestPool } from '../server/request-pool.mjs';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const rateError = () => Object.assign(new Error('limited'), { status: 429, code: 'YOUTUBE_RATE_LIMITED' });

test('identical requests share work; cancelling one subscriber preserves the other', async t => {
  const pool = createRequestPool(); t.after(pool.close);
  const pending = deferred(), a = new AbortController(), b = new AbortController();
  let calls = 0, upstream;
  const load = signal => { calls++; upstream = signal; return pending.promise; };
  const first = pool.request('same', load, a.signal), second = pool.request('same', load, b.signal);
  await Promise.resolve(); assert.equal(calls, 1);
  a.abort(); await assert.rejects(first, { name: 'AbortError' });
  assert.equal(upstream.aborted, false);
  pending.resolve('real captions'); assert.equal(await second, 'real captions');
  assert.equal(await pool.request('same', load), 'real captions'); assert.equal(calls, 1);
});

test('last cancellation aborts upstream and a late response cannot overwrite the replacement', async t => {
  const pool = createRequestPool(); t.after(pool.close);
  const old = deferred(), abort = new AbortController(); let signal;
  const first = pool.request('key', value => { signal = value; return old.promise; }, abort.signal);
  await Promise.resolve(); abort.abort(); await assert.rejects(first, { name: 'AbortError' });
  assert.equal(signal.aborted, true);
  const replacement = pool.request('key', async () => 'new');
  old.resolve('stale');
  assert.equal(await replacement, 'new'); assert.equal(pool.peek('key'), 'new');
});

test('distinct upstream jobs are serialized and cancelled queued work never starts', async t => {
  const pool = createRequestPool(); t.after(pool.close);
  const pending = deferred(), abort = new AbortController(); let calls = 0;
  const first = pool.request('first', () => pending.promise);
  const removed = pool.request('removed', async () => { calls++; }, abort.signal);
  const next = pool.request('next', async () => { calls++; return 'next'; });
  abort.abort(); await assert.rejects(removed, { name: 'AbortError' });
  await Promise.resolve(); assert.equal(calls, 0);
  pending.resolve('first'); await first;
  assert.equal(await next, 'next'); assert.equal(calls, 1);
});

test('real 429 rejects queued uncached work; cached work survives and retry is manual', async t => {
  let now = 0, calls = 0;
  const pool = createRequestPool({ now: () => now, cooldownMs: 1000 }); t.after(pool.close);
  pool.prime('cached', 'available');
  const failed = pool.request('limited', async () => { throw rateError(); });
  const queued = pool.request('queued', async () => { calls++; });
  await Promise.all([assert.rejects(failed, e => e.code === 'YOUTUBE_RATE_LIMITED'), assert.rejects(queued, e => e.retryAfterSeconds === 1)]);
  assert.equal(calls, 0);
  assert.equal(await pool.request('cached', () => { throw new Error('must not load'); }), 'available');
  now = 1001; await Promise.resolve(); assert.equal(calls, 0);
  await pool.request('queued', async () => { calls++; }); assert.equal(calls, 1);
});

test('bounded local capacity is 503, never a fabricated YouTube 429', async t => {
  const pool = createRequestPool({ maxPending: 1 }); t.after(pool.close);
  const pending = deferred(); const active = pool.request('one', () => pending.promise);
  await assert.rejects(pool.request('two', async () => 2), e => e.status === 503 && e.code === 'LOCAL_QUEUE_FULL');
  pending.resolve(1); await active;
});

test('fast work starts while a translation lane job is active', async t => {
  const pool = createRequestPool(); t.after(pool.close);
  const waiting = deferred(), started = deferred();
  const translation = pool.request('translation', async () => { started.resolve(); return waiting.promise; }, undefined, { lane: 'translation' });
  await started.promise;
  assert.equal(await pool.request('metadata', async () => 'fast', undefined, { lane: 'fast' }), 'fast');
  waiting.resolve('translated'); assert.equal(await translation, 'translated');
});

test('a queued track already supplied by a batch is served without another download', async t => {
  const pool = createRequestPool(); t.after(pool.close);
  const pending = deferred(); let extra = 0;
  const batch = pool.request('target', async () => { await pending.promise; pool.prime('en', 'English'); return '中文'; });
  const source = pool.request('en', async () => { extra++; return 'redundant'; });
  pending.resolve();
  assert.deepEqual(await Promise.all([batch, source]), ['中文', 'English']); assert.equal(extra, 0);
});
