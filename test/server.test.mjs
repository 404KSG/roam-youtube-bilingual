import test from 'node:test';
import assert from 'node:assert/strict';
import { makeServer } from '../server/index.mjs';
import { createCaptionCache } from '../server/caption-cache.mjs';
import { createCaptionBundleCache, makeCaptionBundle } from '../server/caption-bundle-cache.mjs';
import { createDisplayInfoLease } from '../server/display-info.mjs';
import { sanitizeVideoInfo } from '../server/video-info.mjs';
import { namedTrackMetadata, namedEnglishKey } from './caption-fixtures.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const id = 'vif8NQcjVf0';
const selection = language => ({ downloadLanguage: language, identity: { lang: 'en', kind: '', name: '', tlang: language === 'en' ? '' : language } });
const info = { videoId: id, title: 'Test video', sourceLanguage: 'en', playerSourceLanguage: 'en', sourceTrack: { languageCode: 'en', languageName: 'English', kind: '', name: '', vss_id: '.en' }, sourceSelection: selection('en'), languages: [{ code: 'zh-Hans', name: 'Chinese', autoTranslated: true, selection: selection('zh-Hans') }, { code: 'ja', name: 'Japanese', autoTranslated: true, selection: selection('ja') }] };
async function fixture(t, options = {}) {
  const server = makeServer({ infoFetcher: async () => info, captionFetcher: async () => [{ id: 0, start: 0, end: 2, text: 'English' }], verifyPeer: async () => {}, nativeCcReader: { read: async () => ({ state: 'off' }) }, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
const post = (body, origin = 'https://roamresearch.com') => ({ method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const frame = { x: 100, y: 100, width: 800, height: 450 };
test('health describes compact bridge without models, tokens or API configuration', async (t) => {
  const base = await fixture(t); const data = await (await fetch(base + '/v1/youtube/health')).json();
  assert.equal(data.provider, 'youtube-unified'); assert.equal(data.apiVersion, 8);
  assert.equal('apiConfigured' in data, false); assert.equal('token' in data, false);
});
test('API 8 removes the legacy captions orchestration route', async t => {
  const base = await fixture(t);
  assert.equal((await fetch(base + '/v1/youtube/captions', post({ videoId: id, target: 'zh-Hans' }))).status, 404);
});
test('cold caption-session invokes the downloader adapter with video ID and complete verified selection options', async t => {
  const calls = [];
  const base = await fixture(t, { captionFetcher: undefined, captionBatchFetcher: async (videoId, languages, _signal, options) => {
    calls.push({ videoId, languages, options });
    return { tracks: Object.fromEntries(languages.map(language => [language, [{ start: 0, end: 2, text: language }]])), identities: Object.fromEntries(languages.map(language => [language, options.selections[language]])) };
  } });
  const response = await fetch(base + '/v1/youtube/caption-session', post({ videoId: id, target: 'zh-Hans' }));
  const events = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(response.status, 200); assert.equal(events.at(-1).outcome, 'bilingual');
  assert.deepEqual(calls.map(call => call.videoId), [id, id]);
  for (const call of calls) { assert.equal(call.options.sourceLanguage, 'en'); assert.deepEqual(call.options.expectedSourceTrack, info.sourceTrack); assert.deepEqual(Object.keys(call.options.selections), call.languages); }
  assert.deepEqual(calls.map(call => call.options.waitSeconds), [60, 0]);
});
test('due HTTP caption-session revalidates source through the real adapter and reuses only matching auto target', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ryb-http-due-')); t.after(() => rm(directory, { recursive: true, force: true })); let now = 0;
  const cache = createCaptionBundleCache(directory, { now: () => now, freshnessMs: 1 }); const saved = makeCaptionBundle({ videoId: id, target: 'zh-Hans', info, source: { trackKey: 'en', playerTrack: JSON.stringify(info.sourceTrack), selection: info.sourceSelection, cues: [{ start: 0, end: 1, text: 'English' }] }, targetTrack: { type: 'auto-translated', selection: info.languages[0].selection, cues: [{ start: 0, end: 1, text: '中文' }] }, now: () => now }); await cache.write(saved); now = 2;
  const calls = []; const base = await fixture(t, { now: () => now, captionBundleCache: cache, captionFetcher: undefined, captionBatchFetcher: async (video, languages, _signal, options) => { calls.push({ video, languages, options }); return { tracks: { en: [{ start: 0, end: 1, text: 'English' }] }, identities: { en: options.selections.en } }; } });
  const events = (await (await fetch(base + '/v1/youtube/caption-session', post({ videoId: id, target: 'zh-Hans' }))).text()).trim().split('\n').map(JSON.parse);
  assert.equal(events.find(event => event.type === 'info').cacheDisposition, 'revalidated'); assert.deepEqual(calls.map(call => call.video), [id]); assert.equal(events.find(event => event.type === 'target-ready').cues[0].text, '中文');
});
test('warm caption sessions and native CC state use a fresh v3 bundle before upstream metadata', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ryb-warm-v3-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const selection = language => ({ downloadLanguage: language, identity: { lang: 'en', kind: '', name: '', tlang: language === 'en' ? '' : language } });
  const warmInfo = { videoId: id, title: 'Warm', sourceLanguage: 'en', playerSourceLanguage: 'en', sourceTrack: { languageCode: 'en', languageName: 'English', kind: '', name: '', vss_id: '.en' }, sourceSelection: selection('en'), languages: [{ code: 'zh-Hans', name: 'Chinese', autoTranslated: true, selection: selection('zh-Hans') }] };
  const bundles = createCaptionBundleCache(directory), bundle = makeCaptionBundle({ videoId: id, target: 'zh-Hans', info: warmInfo, source: { trackKey: 'en', playerTrack: JSON.stringify(warmInfo.sourceTrack), selection: selection('en'), cues: [{ start: 0, end: 1, text: 'English' }] }, targetTrack: { type: 'auto-translated', selection: selection('zh-Hans'), cues: [{ start: 0, end: 1, text: '中文' }] } });
  await bundles.write(bundle); let upstream = 0;
  const base = await fixture(t, { captionBundleCache: createCaptionBundleCache(directory), infoFetcher: async () => { upstream++; throw new Error('unexpected metadata'); }, captionFetcher: async () => { upstream++; throw new Error('unexpected captions'); } });
  const response = await fetch(base + '/v1/youtube/caption-session', post({ videoId: id, target: 'zh-Hans' }));
  const events = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(response.headers.get('content-type').startsWith('application/x-ndjson'), true); assert.equal(events.find(event => event.type === 'info').info.title, 'Warm'); assert.equal(events.find(event => event.type === 'target-ready').cues[0].text, '中文');
  const warmInfoResponse = await fetch(base + '/v1/youtube/video-info', post({ videoId: id })); assert.equal(warmInfoResponse.status, 200); assert.equal((await warmInfoResponse.json()).title, 'Warm');
  assert.equal((await fetch(base + '/v1/youtube/native-cc-state', post({ videoId: id, frame }))).status, 200); assert.equal(upstream, 0);
});
test('a same-process due session forces current metadata, source, and same-type uploaded target acquisition', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ryb-same-process-due-')); t.after(() => rm(directory, { recursive: true, force: true })); let now = 0, pass = 0, metadataCalls = 0; const cache = createCaptionBundleCache(directory, { now: () => now, freshnessMs: 1 });
  const uploaded = { ...info, languages: [{ ...info.languages[0], autoTranslated: false }] }; const calls = [];
  const base = await fixture(t, { now: () => now, captionBundleCache: cache, infoFetcher: async () => { metadataCalls++; return pass === 3 ? { ...uploaded, sourceTrack: { ...uploaded.sourceTrack, vss_id: '.new-source' } } : uploaded; }, captionFetcher: async (_id, language) => { calls.push({ pass, language }); return [{ start: 0, end: 1, text: `${pass}-${language}` }]; } });
  const session = async () => (await (await fetch(base + '/v1/youtube/caption-session', post({ videoId: id, target: 'zh-Hans' }))).text()).trim().split('\n').map(JSON.parse);
  pass = 1; await session(); now = 2; pass = 2; const changedContent = await session(); now = 4; pass = 3; const changedSourceKey = await session();
  assert.equal(metadataCalls, 3); assert.deepEqual(calls, [{ pass: 1, language: 'zh-Hans' }, { pass: 1, language: 'en' }, { pass: 2, language: 'en' }, { pass: 2, language: 'zh-Hans' }, { pass: 3, language: 'en' }, { pass: 3, language: 'zh-Hans' }]);
  assert.equal(changedContent.find(event => event.type === 'target-ready').cues[0].text, '2-zh-Hans'); assert.equal(changedSourceKey.find(event => event.type === 'target-ready').cues[0].text, '3-zh-Hans');
});
test('HTTP disconnect and response-limit abort cancel active caption session work', async t => {
  let disconnected = false; const base = await fixture(t, { captionFetcher: async (_id, _language, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => { disconnected = true; reject(new DOMException('Aborted', 'AbortError')); }, { once: true })) });
  const controller = new AbortController(); const response = await fetch(base + '/v1/youtube/caption-session', { ...post({ videoId: id, target: 'zh-Hans' }), signal: controller.signal }); controller.abort(); await delay(20); assert.equal(response.status, 200); assert.equal(disconnected, true);
  let limited = false; const limitedBase = await fixture(t, { maxSessionBytes: 1000, captionFetcher: async (_id, language, signal) => language === 'en' ? [{ start: 0, end: 1, text: 'English' }] : new Promise((_resolve, reject) => signal.addEventListener('abort', () => { limited = true; reject(new DOMException('Aborted', 'AbortError')); }, { once: true })) });
  await fetch(limitedBase + '/v1/youtube/caption-session', post({ videoId: id, target: 'zh-Hans' })); await delay(20); assert.equal(limited, true);
});
test('a target-B miss uses current acquisition even while target-A display metadata is leased', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ryb-target-b-current-')); t.after(() => rm(directory, { recursive: true, force: true })); let now = 0, metadata = 0, generation = 0;
  const cache = createCaptionBundleCache(directory, { now: () => now, freshnessMs: 1 }); const lease = createDisplayInfoLease({ now: () => now, idleMs: 100 });
  const current = () => generation ? { ...info, title: 'Current B', sourceLanguage: 'en-alt', sourceTrack: { ...info.sourceTrack, languageCode: 'en-alt' }, sourceSelection: { ...selection('en-alt'), identity: { ...selection('en-alt').identity, lang: 'en-alt' } }, languages: [{ code: 'zh-Hans', name: 'Chinese', autoTranslated: true, selection: { ...selection('zh-Hans'), identity: { ...selection('zh-Hans').identity, lang: 'en-alt' } } }, { code: 'ja', name: 'Japanese', autoTranslated: true, selection: { ...selection('ja'), identity: { ...selection('ja').identity, lang: 'en-alt' } } }] } : info;
  const calls = []; const base = await fixture(t, { now: () => now, captionBundleCache: cache, displayInfoLease: lease, infoFetcher: async () => { metadata++; return current(); }, captionFetcher: async (_id, language) => { calls.push({ generation, language }); return [{ start: 0, end: 1, text: `${generation}-${language}` }]; } });
  const events = async target => (await (await fetch(base + '/v1/youtube/caption-session', post({ videoId: id, target }))).text()).trim().split('\n').map(JSON.parse);
  await events('zh-Hans'); now = 2; generation = 1; const targetB = await events('ja');
  assert.equal(metadata, 2); assert.equal(targetB.find(event => event.type === 'source-ready').language, 'en-alt'); assert.equal(targetB.find(event => event.type === 'source-ready').cues[0].text, '1-en-alt'); assert.equal(targetB.find(event => event.type === 'target-ready').cues[0].text, '1-ja'); assert.deepEqual(calls.filter(call => call.generation === 1).map(call => call.language).sort(), ['en-alt', 'ja']);
});
test('expired display lease and due bundle make video-info acquire current metadata', async t => {
  let now = 0, calls = 0, title = 'Old'; const directory = await mkdtemp(join(tmpdir(), 'ryb-expired-display-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const cache = createCaptionBundleCache(directory, { now: () => now, freshnessMs: 1 }); const lease = createDisplayInfoLease({ now: () => now, idleMs: 1 }); const base = await fixture(t, { now: () => now, captionBundleCache: cache, displayInfoLease: lease, infoFetcher: async () => { calls++; return { ...info, title }; } });
  assert.equal((await (await fetch(base + '/v1/youtube/video-info', post({ videoId: id }))).json()).title, 'Old'); now = 2; title = 'New'; assert.equal((await (await fetch(base + '/v1/youtube/video-info', post({ videoId: id }))).json()).title, 'New'); assert.equal(calls, 2);
});
test('native CC polls reuse display metadata during a held target and after source-only failure', { timeout: 5000 }, async t => {
  let now = 1000, metadataCalls = 0, nativeReads = 0, failTarget;
  const controller = new AbortController(); t.after(() => controller.abort());
  const base = await fixture(t, {
    now: () => now,
    infoFetcher: async () => { metadataCalls++; return info; },
    captionFetcher: async (_id, language, signal) => {
      if (language === 'en') return [{ start: 0, end: 2, text: 'Verified English' }];
      return new Promise((_resolve, reject) => {
        failTarget = () => reject(Object.assign(new Error('YouTube limited the target'), { code: 'YOUTUBE_RATE_LIMITED', status: 429 }));
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    },
    nativeCcReader: { read: async ({ title }) => { assert.equal(title, info.title); nativeReads++; return { state: 'off' }; } },
  });
  const response = await fetch(base + '/v1/youtube/caption-session', { ...post({ videoId: id, target: 'zh-Hans' }), signal: controller.signal });
  const reader = response.body.getReader(), decoder = new TextDecoder(), events = []; let buffer = '';
  const readChunk = async () => {
    const part = await reader.read();
    buffer += decoder.decode(part.value || new Uint8Array(), { stream: !part.done });
    let newline; while ((newline = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); if (line) events.push(JSON.parse(line)); }
    return part.done;
  };
  while (!events.some(event => event.type === 'source-ready')) assert.equal(await readChunk(), false);
  assert.equal(typeof failTarget, 'function');
  const poll = async () => {
    now += 700;
    const state = await fetch(base + '/v1/youtube/native-cc-state', post({ videoId: id, frame }));
    assert.equal(state.status, 200); assert.equal((await state.json()).state, 'off');
    assert.equal(metadataCalls, 1, 'native polling must not launch another metadata acquisition');
  };
  for (let i = 0; i < 5; i++) await poll();
  assert.equal(events.some(event => event.type === 'target-ready'), false);
  failTarget(); while (!await readChunk()) { /* Drain the finite error/complete stream. */ }
  assert.equal(events.at(-1).outcome, 'source-only');
  assert.equal(events.find(event => event.type === 'target-error').code, 'YOUTUBE_RATE_LIMITED');
  for (let i = 0; i < 5; i++) await poll();
  assert.equal(nativeReads, 10); assert.equal(metadataCalls, 1);
});
test('fresh bundle and settings remain available during a different video upstream cooldown', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ryb-warm-cooldown-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const cache = createCaptionBundleCache(directory);
  await cache.write(makeCaptionBundle({ videoId: id, target: 'zh-Hans', info,
    source: { trackKey: 'en', playerTrack: JSON.stringify(info.sourceTrack), selection: info.sourceSelection, cues: [{ start: 0, end: 2, text: 'Cached English' }] },
    targetTrack: { type: 'auto-translated', selection: info.languages[0].selection, cues: [{ start: 0, end: 2, text: '缓存中文' }] },
  }));
  let metadataCalls = 0, downloads = 0;
  const base = await fixture(t, { captionBundleCache: cache,
    infoFetcher: async () => { metadataCalls++; throw Object.assign(new Error('Upstream limited'), { code: 'YOUTUBE_RATE_LIMITED', status: 429 }); },
    captionFetcher: async () => { downloads++; throw new Error('No download is expected'); },
  });
  const session = async videoId => (await (await fetch(base + '/v1/youtube/caption-session', post({ videoId, target: 'zh-Hans' }))).text()).trim().split('\n').map(JSON.parse);
  assert.equal((await session('dQw4w9WgXcQ')).at(-1).code, 'YOUTUBE_RATE_LIMITED');
  const warm = await session(id);
  assert.equal(warm.find(event => event.type === 'source-ready').cues[0].text, 'Cached English');
  assert.equal(warm.find(event => event.type === 'target-ready').cues[0].text, '缓存中文');
  assert.equal(warm.at(-1).outcome, 'bilingual');
  assert.equal((await fetch(base + '/v1/youtube/video-info', post({ videoId: id }))).status, 200);
  assert.equal((await fetch(base + '/v1/youtube/native-cc-state', post({ videoId: id, frame }))).status, 200);
  assert.equal((await fetch(base + '/v1/youtube/video-info', post({ videoId: 'M7lc1UVf-VE' }))).status, 429);
  assert.equal(metadataCalls, 1); assert.equal(downloads, 0);
});
test('valid legacy v2 source and target records import without target redownload', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ryb-legacy-import-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const legacy = createCaptionCache(join(directory, 'v2')), bundles = createCaptionBundleCache(join(directory, 'v3'));
  const keyFor = language => createHash('sha256').update(JSON.stringify([info.sourceLanguage, info.playerSourceLanguage, info.sourceTrack.kind, info.sourceTrack.name, info.sourceTrack.vss_id, language === info.sourceLanguage ? info.sourceSelection : info.languages.find(item => item.code === language).selection])).digest('hex');
  await legacy.put(id, 'en', [{ start: 0, end: 1, text: 'English' }], undefined, keyFor('en'));
  await legacy.put(id, 'zh-Hans', [{ start: 0, end: 1, text: '中文' }], undefined, keyFor('zh-Hans'));
  let downloads = 0; const base = await fixture(t, { captionCache: legacy, captionBundleCache: bundles, captionFetcher: async () => { downloads++; throw new Error('must not download'); } });
  const events = (await (await fetch(base + '/v1/youtube/caption-session', post({ videoId: id, target: 'zh-Hans' }))).text()).trim().split('\n').map(JSON.parse);
  assert.equal(events.find(event => event.type === 'info').cacheDisposition, 'legacy-import'); assert.equal(events.find(event => event.type === 'target-ready').cues[0].text, '中文'); assert.equal(downloads, 0);
});
test('partial legacy v2 records are not imported as a pair', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ryb-legacy-partial-')); t.after(() => rm(directory, { recursive: true, force: true })); const legacy = createCaptionCache(join(directory, 'v2'));
  const sourceKey = createHash('sha256').update(JSON.stringify([info.sourceLanguage, info.playerSourceLanguage, info.sourceTrack.kind, info.sourceTrack.name, info.sourceTrack.vss_id, info.sourceSelection])).digest('hex'); await legacy.put(id, 'en', [{ start: 0, end: 1, text: 'old English' }], undefined, sourceKey);
  let downloads = 0; const base = await fixture(t, { captionCache: legacy, captionBundleCache: createCaptionBundleCache(join(directory, 'v3')), captionFetcher: async (_id, language) => { downloads++; return [{ start: 0, end: 1, text: language }]; } });
  const events = (await (await fetch(base + '/v1/youtube/caption-session', post({ videoId: id, target: 'zh-Hans' }))).text()).trim().split('\n').map(JSON.parse);
  assert.equal(events.find(event => event.type === 'info').cacheDisposition, 'miss'); assert.equal(downloads, 2);
});
test('native CC state requires same-user verification and only reports an explicit off state', async (t) => {
  let verified = false, read = false;
  const base = await fixture(t, { verifyPeer: async (socket) => { assert.ok(socket.remotePort); verified = true; }, nativeCcReader: { read: async ({ title, frame: actualFrame }) => { assert.equal(verified, true); read = true; assert.equal(title, info.title); assert.deepEqual(actualFrame, frame); return { state: 'off' }; } } });
  const data = await (await fetch(base + '/v1/youtube/native-cc-state', post({ videoId: id, frame }))).json();
  assert.equal(data.videoId, id); assert.equal(data.state, 'off'); assert.ok(Number.isFinite(data.checkedAt)); assert.equal(read, true);
  assert.equal((await fetch(base + '/v1/youtube/native-cc-state', post({ videoId: id, frame, pid: 1 }))).status, 400);
});
test('native CC state forwards the scoped controls-visible reason', async t => {
  const base = await fixture(t, { nativeCcReader: { read: async () => ({ state: 'unknown', reason: 'controls-visible' }) } });
  const data = await (await fetch(base + '/v1/youtube/native-cc-state', post({ videoId: id, frame }))).json();
  assert.deepEqual(data.reason, 'controls-visible');
  assert.equal(data.state, 'unknown');
});
test('untrusted peers and origins cannot read any accessibility data', async (t) => {
  let reads = 0;
  const base = await fixture(t, { verifyPeer: async () => { throw Object.assign(new Error('Denied'), { status: 403 }); }, nativeCcReader: { read: () => { reads++; } } });
  assert.equal((await fetch(base + '/v1/youtube/native-cc-state', post({ videoId: id, frame }))).status, 403);
  assert.equal((await fetch(base + '/v1/youtube/video-info', post({ videoId: id }, 'https://evil.example'))).status, 403);
  assert.equal(reads, 0);
});
test('removed AI routes, credentials and arbitrary files are not exposed', async (t) => {
  const base = await fixture(t);
  assert.equal((await fetch(base + '/v1/translate', post({ entries: [] }))).status, 404);
  for (const path of ['/.env', '/server/caption-reader.mjs', '/../README.md']) assert.equal((await fetch(base + path)).status, 404);
  assert.equal((await fetch(base + '/v1/youtube/captions', post({ videoId: 'file:///private' }))).status, 404);
});
test('size, content type and private-network preflight guards remain active', async (t) => {
  const base = await fixture(t);
  assert.equal((await fetch(base + '/v1/youtube/video-info', post({ x: 'x'.repeat(65536) }))).status, 413);
  assert.equal((await fetch(base + '/v1/youtube/video-info', { ...post({ videoId: id }), headers: { 'Content-Type': 'text/plain' } })).status, 415);
  const response = await fetch(base + '/v1/youtube/native-cc-state', { method: 'OPTIONS', headers: { Origin: 'https://roamresearch.com', 'Access-Control-Request-Private-Network': 'true' } });
  assert.equal(response.status, 204); assert.equal(response.headers.get('Access-Control-Allow-Private-Network'), 'true');
});
