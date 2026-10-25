import test from 'node:test';
import assert from 'node:assert/strict';
import { makeServer } from '../server/index.mjs';
const id = 'vif8NQcjVf0';
const info = { videoId: id, title: 'Test video', sourceLanguage: 'en', playerSourceLanguage: 'en', languages: [{ code: 'zh-Hans', name: 'Chinese' }, { code: 'ja', name: 'Japanese' }] };
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
  assert.equal(data.provider, 'youtube-unified'); assert.equal(data.apiVersion, 5);
  assert.equal('apiConfigured' in data, false); assert.equal('token' in data, false);
});
test('captions require a video-supported target and cache actual tracks by video and language', async (t) => {
  let infos = 0, captions = 0;
  const requested = [];
  const base = await fixture(t, { infoFetcher: async () => { infos++; return info; }, captionFetcher: async (_id, language) => { captions++; requested.push(language); return [{ id: 0, start: 0, end: 1, text: language }]; } });
  const metadata = await (await fetch(base + '/v1/youtube/video-info', post({ videoId: id }))).json();
  assert.equal(metadata.languages[1].code, 'ja');
  const english = await (await fetch(base + '/v1/youtube/captions', post({ videoId: id, target: 'en' }))).json();
  const chinese = await (await fetch(base + '/v1/youtube/captions', post({ videoId: id, target: 'zh-Hans' }))).json();
  await fetch(base + '/v1/youtube/captions', post({ videoId: id, target: 'en' }));
  assert.deepEqual([english.language, chinese.language], ['en', 'zh-Hans']);
  assert.deepEqual(requested, ['en', 'zh-Hans']);
  assert.equal(infos, 1); assert.equal(captions, 2);
  assert.equal((await fetch(base + '/v1/youtube/captions', post({ videoId: id, target: 'de' }))).status, 400);
});
test('target-first loading batches both tracks and the source request hits cache', async (t) => {
  const batches = [];
  const base = await fixture(t, { captionFetcher: undefined, captionBatchFetcher: async (_id, languages) => {
    batches.push(languages);
    return { tracks: Object.fromEntries(languages.map(language => [language, [{ id: 0, start: 0, end: 2, text: language }]])) };
  } });
  const target = await fetch(base + '/v1/youtube/captions', post({ videoId: id, target: 'zh-Hans' }));
  const source = await fetch(base + '/v1/youtube/captions', post({ videoId: id, target: 'en' }));
  assert.equal(target.status, 200); assert.equal(source.status, 200);
  assert.deepEqual(batches, [['en', 'zh-Hans']]);
});
test('original captions stay fast and auto-translations use the proven preparation delay', async (t) => {
  const batches = [];
  const base = await fixture(t, { captionFetcher: undefined, infoFetcher: async () => ({ ...info, languages: [{ code: 'zh-Hans', autoTranslated: true }] }), captionBatchFetcher: async (_id, languages, _signal, options) => {
    batches.push({ languages, waitSeconds: options.waitSeconds });
    return { tracks: Object.fromEntries(languages.map(language => [language, [{ id: 0, start: 0, end: 2, text: language }]])) };
  } });
  assert.equal((await fetch(base + '/v1/youtube/captions', post({ videoId: id, target: 'zh-Hans' }))).status, 200);
  assert.deepEqual(batches, [{ languages: ['en'], waitSeconds: 0 }, { languages: ['zh-Hans'], waitSeconds: 60 }]);
});
test('saved tracks load without another subtitle download', async (t) => {
  let downloads = 0;
  const base = await fixture(t, { captionFetcher: undefined, captionBatchFetcher: async () => { downloads++; throw new Error('unexpected download'); }, captionCache: {
    get: async (_id, language) => [{ id: 0, start: 0, end: 2, text: language }],
  } });
  const response = await fetch(base + '/v1/youtube/captions', post({ videoId: id, target: 'zh-Hans' }));
  assert.equal(response.status, 200); assert.equal(downloads, 0);
});
test('a partial successful source is cached even when the target batch hits 429', async (t) => {
  let calls = 0;
  const base = await fixture(t, { captionFetcher: undefined, captionBatchFetcher: async () => {
    calls++;
    return { tracks: { en: [{ id: 0, start: 0, end: 2, text: 'English' }] }, error: Object.assign(new Error('limited'), { code: 'YOUTUBE_RATE_LIMITED', status: 429 }) };
  } });
  assert.equal((await fetch(base + '/v1/youtube/captions', post({ videoId: id, target: 'zh-Hans' }))).status, 429);
  assert.equal((await fetch(base + '/v1/youtube/captions', post({ videoId: id, target: 'en' }))).status, 200);
  assert.equal(calls, 1);
});
test('cached captions remain available while another language is downloading', async (t) => {
  let release, started;
  const waiting = new Promise(resolve => { release = resolve; });
  const active = new Promise(resolve => { started = resolve; });
  const base = await fixture(t, { captionFetcher: async (_id, language) => {
    if (language === 'zh-Hans') { started(); await waiting; }
    return [{ id: 0, start: 0, end: 1, text: language }];
  } });
  await fetch(base + '/v1/youtube/captions', post({ videoId: id, target: 'en' }));
  const pending = fetch(base + '/v1/youtube/captions', post({ videoId: id, target: 'zh-Hans' }));
  await active;
  try {
    const cached = await fetch(base + '/v1/youtube/captions', post({ videoId: id, target: 'en' }));
    assert.equal(cached.status, 200, 'a local busy state must not masquerade as YouTube 429');
  } finally { release(); await pending; }
});
test('real upstream 429 has a typed cooldown without automatic retries', async (t) => {
  let calls = 0, now = 0;
  const base = await fixture(t, { now: () => now, cooldownMs: 1000, captionFetcher: async () => {
    calls++; throw Object.assign(new Error('YouTube 限流'), { status: 429, code: 'YOUTUBE_RATE_LIMITED' });
  } });
  const first = await fetch(base + '/v1/youtube/captions', post({ videoId: id, target: 'en' }));
  assert.equal(first.status, 429);
  const second = await fetch(base + '/v1/youtube/captions', post({ videoId: id, target: 'en' }));
  assert.equal(second.status, 429); assert.equal(calls, 1);
  assert.equal((await second.json()).code, 'YOUTUBE_RATE_LIMITED');
  assert.equal(second.headers.get('retry-after'), '1');
  now = 1001;
  await fetch(base + '/v1/youtube/captions', post({ videoId: id, target: 'en' }));
  assert.equal(calls, 2);
});
test('native CC state requires same-user verification and only reports an explicit off state', async (t) => {
  let verified = false, read = false;
  const base = await fixture(t, { verifyPeer: async (socket) => { assert.ok(socket.remotePort); verified = true; }, nativeCcReader: { read: async ({ title, frame: actualFrame }) => { assert.equal(verified, true); read = true; assert.equal(title, info.title); assert.deepEqual(actualFrame, frame); return { state: 'off' }; } } });
  const data = await (await fetch(base + '/v1/youtube/native-cc-state', post({ videoId: id, frame }))).json();
  assert.deepEqual(data, { videoId: id, state: 'off' }); assert.equal(read, true);
  assert.equal((await fetch(base + '/v1/youtube/native-cc-state', post({ videoId: id, frame, pid: 1 }))).status, 400);
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
  assert.equal((await fetch(base + '/v1/youtube/captions', post({ videoId: 'file:///private' }))).status, 400);
});
test('size, content type and private-network preflight guards remain active', async (t) => {
  const base = await fixture(t);
  assert.equal((await fetch(base + '/v1/youtube/video-info', post({ x: 'x'.repeat(65536) }))).status, 413);
  assert.equal((await fetch(base + '/v1/youtube/video-info', { ...post({ videoId: id }), headers: { 'Content-Type': 'text/plain' } })).status, 415);
  const response = await fetch(base + '/v1/youtube/native-cc-state', { method: 'OPTIONS', headers: { Origin: 'https://roamresearch.com', 'Access-Control-Request-Private-Network': 'true' } });
  assert.equal(response.status, 204); assert.equal(response.headers.get('Access-Control-Allow-Private-Network'), 'true');
});
