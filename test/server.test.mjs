import test from 'node:test';
import assert from 'node:assert/strict';
import { makeServer } from '../server/index.mjs';
const id = 'vif8NQcjVf0';
const info = { videoId: id, title: 'Test video', sourceLanguage: 'en', playerSourceLanguage: 'en', languages: [{ code: 'zh-Hans', name: 'Chinese' }, { code: 'ja', name: 'Japanese' }] };
async function fixture(t, options = {}) {
  const server = makeServer({ infoFetcher: async () => info, captionFetcher: async () => [{ id: 0, start: 0, end: 2, text: 'English' }], verifyPeer: async () => {}, captionReader: { read: async () => ({ matched: true, text: '翻译', bounds: { left: .3, top: .9, width: .4, height: .07 }, sampledAt: Date.now() }) }, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
const post = (body, origin = 'https://roamresearch.com') => ({ method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const frame = { x: 100, y: 100, width: 800, height: 450 };
test('health describes compact bridge without models, tokens or API configuration', async (t) => {
  const base = await fixture(t); const data = await (await fetch(base + '/v1/youtube/health')).json();
  assert.equal(data.provider, 'youtube-unified'); assert.equal(data.apiVersion, 2);
  assert.equal('apiConfigured' in data, false); assert.equal('token' in data, false);
});
test('language metadata and original captions are bounded and cached', async (t) => {
  let infos = 0, captions = 0;
  const base = await fixture(t, { infoFetcher: async () => { infos++; return info; }, captionFetcher: async () => { captions++; return [{ id: 0, start: 0, end: 1, text: 'Original' }]; } });
  const metadata = await (await fetch(base + '/v1/youtube/video-info', post({ videoId: id }))).json();
  assert.equal(metadata.languages[1].code, 'ja');
  for (let i = 0; i < 2; i++) assert.equal((await fetch(base + '/v1/youtube/captions', post({ videoId: id }))).status, 200);
  assert.equal(infos, 1); assert.equal(captions, 1);
});
test('caption-state requires same-user verification and exact requested scope', async (t) => {
  let verified = false, read = false;
  const base = await fixture(t, { verifyPeer: async (socket) => { assert.ok(socket.remotePort); verified = true; }, captionReader: { read: async ({ title, target }) => { assert.equal(verified, true); read = true; assert.equal(title, info.title); assert.equal(target, 'ja'); return { matched: true, text: '字幕です。', sampledAt: Date.now(), bounds: { left: .3, top: .9, width: .4, height: .07 } }; } } });
  await fetch(base + '/v1/youtube/video-info', post({ videoId: id }));
  const data = await (await fetch(base + '/v1/youtube/caption-state', post({ videoId: id, target: 'ja', frame }))).json();
  assert.equal(data.text, '字幕です。'); assert.equal(read, true);
  assert.equal((await fetch(base + '/v1/youtube/caption-state', post({ videoId: id, target: 'ja', frame, pid: 1 }))).status, 400);
  assert.equal((await fetch(base + '/v1/youtube/caption-state', post({ videoId: id, target: 'de', frame }))).status, 400);
});
test('untrusted peers and origins cannot read any accessibility data', async (t) => {
  let reads = 0;
  const base = await fixture(t, { verifyPeer: async () => { throw Object.assign(new Error('Denied'), { status: 403 }); }, captionReader: { read: () => { reads++; } } });
  assert.equal((await fetch(base + '/v1/youtube/caption-state', post({ videoId: id, target: 'ja', frame }))).status, 403);
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
  const response = await fetch(base + '/v1/youtube/caption-state', { method: 'OPTIONS', headers: { Origin: 'https://roamresearch.com', 'Access-Control-Request-Private-Network': 'true' } });
  assert.equal(response.status, 204); assert.equal(response.headers.get('Access-Control-Allow-Private-Network'), 'true');
});
