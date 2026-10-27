import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCaptionBundleCache, makeCaptionBundle } from '../server/caption-bundle-cache.mjs';
import { createCaptionSession } from '../server/caption-session.mjs';
import { createRequestPool } from '../server/request-pool.mjs';

const videoId = 'vif8NQcjVf0';
const select = language => ({ downloadLanguage: language, identity: { lang: 'en', kind: '', name: '', tlang: language === 'en' ? '' : language } });
const info = { videoId, title: 'Warm video', sourceLanguage: 'en', playerSourceLanguage: 'en', sourceTrack: { languageCode: 'en', languageName: 'English', kind: '', name: '', vss_id: '.en' }, sourceSelection: select('en'), languages: [{ code: 'zh-Hans', name: 'Chinese', autoTranslated: true, selection: select('zh-Hans') }] };
const pair = now => makeCaptionBundle({ videoId, target: 'zh-Hans', info, source: { trackKey: 'en', playerTrack: JSON.stringify(info.sourceTrack), selection: select('en'), cues: [{ start: 0, end: 2, text: 'English' }] }, targetTrack: { type: 'auto-translated', selection: select('zh-Hans'), cues: [{ start: 0, end: 2, text: '中文' }] }, now: () => now });

test('a warm verified bundle streams sanitized info and both tracks without upstream work', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ryb-session-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const cache = createCaptionBundleCache(directory, { now: () => 100 }); await cache.write(pair(100));
  let calls = 0; const pool = createRequestPool(); t.after(pool.close);
  const events = []; for await (const event of createCaptionSession({ videoId, target: 'zh-Hans', signal: new AbortController().signal, cache: createCaptionBundleCache(directory, { now: () => 101 }), requests: pool, getInfo: async () => { calls++; throw new Error('unexpected metadata'); }, loadTracks: async () => { calls++; throw new Error('unexpected captions'); } })) events.push(event);
  assert.equal(calls, 0); assert.deepEqual(events.map(event => event.type), ['phase', 'phase', 'info', 'source-ready', 'target-ready', 'complete']); assert.equal(events[2].info.title, 'Warm video'); assert.equal(events[3].cues[0].text, 'English'); assert.equal(events[4].cues[0].text, '中文');
});
test('due auto translation reuses only a complete current provenance match and refreshes current metadata', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ryb-due-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let now = 0; const cache = createCaptionBundleCache(directory, { now: () => now, freshnessMs: 10 }); await cache.write(pair(now)); now = 11;
  const current = { ...info, title: 'Current metadata' }, calls = []; const pool = createRequestPool(); t.after(pool.close);
  const events = []; for await (const event of createCaptionSession({ videoId, target: 'zh-Hans', signal: new AbortController().signal, cache, requests: pool, now: () => now, getInfo: async () => current, loadTracks: async (id, languages, _signal, options) => { calls.push({ id, languages, options }); return { tracks: { en: [{ start: 0, end: 2, text: 'English' }] }, identities: { en: select('en') } }; } })) events.push(event);
  assert.deepEqual(calls.map(call => call.languages), [['en']]); assert.equal(events.find(event => event.type === 'target-ready').cues[0].text, '中文');
  assert.equal((await cache.read(videoId, 'zh-Hans')).bundle.sanitizedInfo.title, 'Current metadata');
});
test('changed player identity, target type, or uploaded target prevents stale target reuse', async t => {
  const variants = [
    { ...info, sourceTrack: { ...info.sourceTrack, vss_id: '.changed' } },
    { ...info, languages: [{ ...info.languages[0], autoTranslated: false }] },
  ];
  for (const current of variants) {
    let now = 0; const directory = await mkdtemp(join(tmpdir(), 'ryb-provenance-')); const cache = createCaptionBundleCache(directory, { now: () => now, freshnessMs: 1 }); await cache.write(pair(now)); now = 2;
    const pool = createRequestPool(), calls = []; const events = []; try {
      for await (const event of createCaptionSession({ videoId, target: 'zh-Hans', signal: new AbortController().signal, cache, requests: pool, now: () => now, getInfo: async () => current, loadTracks: async (_id, languages, _signal, options) => { calls.push({ languages, options }); const language = languages[0]; return { tracks: { [language]: [{ start: 0, end: 2, text: language === 'en' ? 'English' : 'Current target' }] }, identities: { [language]: options.selections[language] } }; } })) events.push(event);
      assert.equal(events.find(event => event.type === 'target-ready').cues[0].text, 'Current target'); assert.ok(calls.some(call => call.languages[0] === 'zh-Hans'));
    } finally { pool.close(); await rm(directory, { recursive: true, force: true }); }
  }
});
test('due automatic bundles invalidate target on actual source-key or source-content change', async t => {
  for (const mode of ['key', 'content']) {
    let now = 0; const directory = await mkdtemp(join(tmpdir(), 'ryb-auto-current-')); const cache = createCaptionBundleCache(directory, { now: () => now, freshnessMs: 1 }); await cache.write(pair(now)); now = 2; const pool = createRequestPool(), calls = [];
    const current = mode === 'key' ? { ...info, sourceLanguage: 'en-ehkg1hFWq8A', sourceSelection: { ...info.sourceSelection, downloadLanguage: 'en-ehkg1hFWq8A' } } : info;
    assert.deepEqual(current.sourceTrack, info.sourceTrack, 'player identity, including vss_id, is unchanged');
    try { const events = []; for await (const event of createCaptionSession({ videoId, target: 'zh-Hans', signal: new AbortController().signal, cache, requests: pool, now: () => now, getInfo: async () => current, loadTracks: async (_id, languages, _signal, options) => { const language = languages[0]; calls.push(language); const text = language === current.sourceLanguage ? (mode === 'key' ? 'English' : 'Changed English content') : `${mode}-zh-Hans`; return { tracks: { [language]: [{ start: 0, end: 2, text }] }, identities: { [language]: options.selections[language] } }; } })) events.push(event);
      assert.equal(events.find(event => event.type === 'source-ready').language, current.sourceLanguage); assert.equal(events.find(event => event.type === 'source-ready').cues[0].text, mode === 'key' ? 'English' : 'Changed English content'); assert.equal(events.find(event => event.type === 'target-ready').cues[0].text, `${mode}-zh-Hans`); assert.deepEqual(calls.sort(), [current.sourceLanguage, 'zh-Hans'].sort());
    } finally { pool.close(); await rm(directory, { recursive: true, force: true }); }
  }
});
test('a disappeared uploaded target is never served from a due pair', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ryb-upload-missing-')); t.after(() => rm(directory, { recursive: true, force: true })); let now = 0;
  const uploadedInfo = { ...info, languages: [{ ...info.languages[0], autoTranslated: false }] }, saved = makeCaptionBundle({ videoId, target: 'zh-Hans', info: uploadedInfo, source: { trackKey: 'en', playerTrack: JSON.stringify(uploadedInfo.sourceTrack), selection: select('en'), cues: [{ start: 0, end: 1, text: 'English' }] }, targetTrack: { type: 'uploaded', selection: select('zh-Hans'), cues: [{ start: 0, end: 1, text: 'Old upload' }] }, now: () => now });
  const cache = createCaptionBundleCache(directory, { now: () => now, freshnessMs: 1 }); await cache.write(saved); now = 2; const pool = createRequestPool(); t.after(pool.close);
  const events = []; for await (const event of createCaptionSession({ videoId, target: 'zh-Hans', signal: new AbortController().signal, cache, requests: pool, now: () => now, getInfo: async () => ({ ...uploadedInfo, languages: [] }), loadTracks: async () => { throw new Error('must not download a vanished target'); } })) events.push(event);
  assert.equal(events.some(event => event.type === 'target-ready'), false); assert.equal(events.at(-1).type, 'fatal-error');
});
test('aborting after source-ready removes this translation subscriber and aborts final upstream work', async t => {
  const pool = createRequestPool(); t.after(pool.close); const abort = new AbortController(); let targetStarted, targetAborted = false;
  const started = new Promise(resolve => { targetStarted = resolve; });
  const stream = createCaptionSession({ videoId, target: 'zh-Hans', signal: abort.signal, requests: pool, getInfo: async () => info, loadTracks: async (_id, languages, signal) => {
    if (languages[0] === 'zh-Hans') { targetStarted(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { targetAborted = true; reject(new DOMException('Aborted', 'AbortError')); }, { once: true })); }
    return { tracks: { en: [{ start: 0, end: 1, text: 'English' }] }, identities: { en: select('en') } };
  } });
  const iterator = stream[Symbol.asyncIterator](); let event;
  do { event = await iterator.next(); } while (!event.done && event.value.type !== 'source-ready');
  await targetStarted; abort.abort(); await iterator.next(); assert.equal(targetAborted, true);
});
test('one cancelled session preserves shared target work until its final subscriber leaves', async t => {
  const pool = createRequestPool(); t.after(pool.close); const firstAbort = new AbortController(), secondAbort = new AbortController(); let targetAborted = false, targetCalls = 0;
  const loadTracks = async (_id, languages, signal) => {
    if (languages[0] === 'zh-Hans') { targetCalls++; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { targetAborted = true; reject(new DOMException('Aborted', 'AbortError')); }, { once: true })); }
    return { tracks: { en: [{ start: 0, end: 1, text: 'English' }] }, identities: { en: select('en') } };
  };
  const make = signal => createCaptionSession({ videoId, target: 'zh-Hans', signal, requests: pool, getInfo: async () => info, loadTracks });
  const a = make(firstAbort.signal)[Symbol.asyncIterator](), b = make(secondAbort.signal)[Symbol.asyncIterator]();
  const untilSource = async iterator => { let next; do { next = await iterator.next(); } while (!next.done && next.value.type !== 'source-ready'); };
  await Promise.all([untilSource(a), untilSource(b)]); assert.equal(targetCalls, 1);
  firstAbort.abort(); await Promise.resolve(); assert.equal(targetAborted, false);
  secondAbort.abort(); await Promise.resolve(); await Promise.resolve(); assert.equal(targetAborted, true);
});
test('a target failure after a verified English source completes source-only', async t => {
  const pool = createRequestPool(); t.after(pool.close); const events = [];
  for await (const event of createCaptionSession({ videoId, target: 'zh-Hans', signal: new AbortController().signal, requests: pool, getInfo: async () => info, loadTracks: async (_info, languages) => languages[0] === 'en' ? { tracks: { en: [{ start: 0, end: 1, text: 'English' }] } } : { tracks: {}, error: Object.assign(new Error('limited'), { code: 'YOUTUBE_RATE_LIMITED', status: 429 }) } })) events.push(event);
  assert.equal(events.find(event => event.type === 'source-ready').cues[0].text, 'English'); assert.equal(events.find(event => event.type === 'target-error').code, 'YOUTUBE_RATE_LIMITED'); assert.match(events.find(event => event.type === 'target-error').message, /verified English captions remain available/); assert.equal(events.at(-1).outcome, 'source-only');
});
test('a source failure stays neutral because English is not verified', async t => {
  const pool = createRequestPool(); t.after(pool.close); const events = [];
  for await (const event of createCaptionSession({ videoId, target: 'zh-Hans', signal: new AbortController().signal, requests: pool, getInfo: async () => info, loadTracks: async () => { throw Object.assign(new Error('YouTube returned HTTP 429 while loading captions. Retry later.'), { code: 'YOUTUBE_RATE_LIMITED', status: 429 }); } })) events.push(event);
  assert.equal(events.at(-1).type, 'fatal-error'); assert.doesNotMatch(events.at(-1).message, /verified English captions remain available/);
});
