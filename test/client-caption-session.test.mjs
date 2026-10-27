import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptionSession } from '../src/caption-session.mjs';

const videoId = 'vif8NQcjVf0', target = 'zh-Hans';
const base = { videoId, target, captionPolicy: 'same-source-v1' };
const info = { videoId, title: 'Fixture', sourceLanguage: 'en', languages: [{ code: target }] };
const source = { ...base, sequence: 2, type: 'source-ready', language: 'en', sourceFingerprint: 'a'.repeat(64), cues: [{ start: 0, end: 1, text: 'English' }] };
const events = targetLanguage => [{ ...base, sequence: 1, type: 'info', cacheDisposition: 'miss', info }, source, { ...base, sequence: 3, type: 'target-ready', language: targetLanguage, targetType: 'auto-translated', sourceFingerprint: 'a'.repeat(64), pairId: 'b'.repeat(64), cues: [{ start: 0, end: 1, text: '中文' }] }, { ...base, sequence: 4, type: 'complete', outcome: 'bilingual' }];
const response = (list, onCancel) => new Response(new ReadableStream({ start(controller) { for (const event of list) controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n')); controller.close(); }, cancel: onCancel }), { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } });
const session = fetchImpl => new CaptionSession({ videoId, target, epoch: 1, signal: new AbortController().signal, url: 'http://fixture/session', fetchImpl, onEvent() {} });

test('client session preserves the browser global receiver required by native fetch', async () => {
  let invoked = false;
  const browserFetch = function () {
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    invoked = true; return Promise.resolve(response(events(target)));
  };
  await session(browserFetch).start();
  assert.equal(invoked, true);
});
test('client session accepts a coherent bilingual stream', async () => {
  await session(async () => response(events(target))).start();
});
test('client session rejects mismatched target language, duplicate source, and truncated streams', async () => {
  await assert.rejects(session(async () => response(events('ja'))).start(), /translated captions/);
  const duplicate = events(target); duplicate.splice(2, 0, { ...source, sequence: 3 }); duplicate[3].sequence = 4; duplicate[4].sequence = 5;
  await assert.rejects(session(async () => response(duplicate)).start(), /invalid English source/);
  await assert.rejects(session(async () => response([{ ...base, sequence: 1, type: 'info', cacheDisposition: 'miss', info }, source])).start(), /without a terminal/);
});
test('client rejects incoherent completion outcomes and oversized events', async () => {
  const sourceOnly = [{ ...base, sequence: 1, type: 'info', cacheDisposition: 'miss', info }, source, { ...base, sequence: 3, type: 'complete', outcome: 'bilingual' }];
  await assert.rejects(session(async () => response(sourceOnly)).start(), /incoherent completion/);
  for (const outcome of [undefined, null, 'unknown']) await assert.rejects(session(async () => response([{ ...base, sequence: 1, type: 'complete', ...(outcome === undefined ? {} : { outcome }) }])).start(), /incoherent completion/);
  const huge = [{ ...base, sequence: 1, type: 'info', cacheDisposition: 'miss', info: { ...info, title: 'x'.repeat(1024 * 1024 * 11) } }];
  await assert.rejects(session(async () => response(huge)).start(), /response limit|invalid video metadata/);
});
test('client cancels its response body when parsing or handler validation fails', async () => {
  let cancelled = false;
  const malformed = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{bad}\n')); }, cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
  await assert.rejects(session(async () => malformed).start()); assert.equal(cancelled, true);
});
