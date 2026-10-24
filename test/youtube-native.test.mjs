import test from 'node:test';
import assert from 'node:assert/strict';
import { makeServer } from '../server/index.mjs';
import { DEFAULT_CONFIG, nativeCaptionTrack, validateConfig } from '../src/protocol.mjs';
import { YouTubeClock } from '../src/clock.mjs';

async function serve(t, options = {}) {
  const server = makeServer({ token: 'private-api-test-token', ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
const nativeRequest = (body, origin = 'https://roamresearch.com') => ({ method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });

test('default and migrated settings use native YouTube translation without credentials', () => {
  assert.equal(DEFAULT_CONFIG.provider, 'youtube');
  assert.equal(DEFAULT_CONFIG.token, '');
  const old = { service: 'http://127.0.0.1:17321', token: '', source: 'en', target: 'zh-CN', fontScale: 1, bottomRatio: 0.08 };
  assert.deepEqual(validateConfig(old), DEFAULT_CONFIG);
  assert.equal(validateConfig({ ...old, provider: 'api' }).bottomRatio, 0.08);
  assert.throws(() => validateConfig({ ...old, provider: 'unknown' }));
});
test('YouTube track selection uses the real translationLanguage payload and Chinese aliases', () => {
  assert.deepEqual(nativeCaptionTrack('en', 'zh-CN'), { languageCode: 'en', translationLanguage: { languageCode: 'zh-Hans' } });
  assert.equal(nativeCaptionTrack('en', 'zh-TW').translationLanguage.languageCode, 'zh-Hant');
  assert.equal(nativeCaptionTrack('en', 'ja').translationLanguage.languageCode, 'ja');
  assert.throws(() => nativeCaptionTrack('en', 'bad\nheader'));
});
test('read-only native routes work without a token or configured model and never call AI', async (t) => {
  let sourceCalls = 0, aiCalls = 0;
  const base = await serve(t, { captionFetcher: async (video, language) => { sourceCalls++; assert.equal(video, 'vif8NQcjVf0'); assert.equal(language, 'en'); return [{ id: 0, start: 0, end: 2, text: 'Original' }]; }, translator: { translate: () => { aiCalls++; throw new Error('AI must not run'); } } });
  const health = await (await fetch(base + '/v1/youtube/health')).json();
  assert.equal(health.provider, 'youtube-native'); assert.equal(health.tokenRequired, false);
  assert.equal('apiConfigured' in health, false);
  const response = await fetch(base + '/v1/youtube/captions', nativeRequest({ videoId: 'vif8NQcjVf0', language: 'en' }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://roamresearch.com');
  assert.equal((await response.json()).cues[0].text, 'Original');
  assert.equal(sourceCalls, 1); assert.equal(aiCalls, 0);
});
test('native endpoints retain origin validation and never unlock the paid API route', async (t) => {
  const base = await serve(t);
  assert.equal((await fetch(base + '/v1/youtube/captions', nativeRequest({ videoId: 'vif8NQcjVf0' }, 'https://evil.example'))).status, 403);
  assert.equal((await fetch(base + '/v1/translate', nativeRequest({ target: 'zh-CN', entries: [{ id: 0, text: 'Hello' }] }))).status, 401);
  assert.equal((await fetch(base + '/health')).status, 401);
  assert.equal((await fetch(base + '/.env')).status, 401);
  assert.equal((await fetch(base + '/v1/youtube/captions', nativeRequest({ videoId: 'file:///private' }))).status, 400);
});
test('demo fixtures cannot be misrepresented as real YouTube captions', async (t) => {
  const base = await serve(t, { demo: true, captionFetcher: () => { throw new Error('must not run'); } });
  const response = await fetch(base + '/v1/youtube/captions', nativeRequest({ videoId: 'vif8NQcjVf0', language: 'en' }));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /演示服务/);
});
test('native translation waits for the player, retries are bounded, and stop sends no restore or AI commands', () => {
  const old = { window: globalThis.window, location: globalThis.location };
  globalThis.window = new EventTarget(); globalThis.location = { origin: 'https://roamresearch.com' };
  const frame = new EventTarget(); frame.src = 'https://www.youtube.com/embed/vif8NQcjVf0?enablejsapi=1';
  frame.getAttribute = () => frame.src;
  const sent = []; frame.contentWindow = { postMessage: (data) => sent.push(JSON.parse(data)) };
  let now = 0;
  const clock = new YouTubeClock(frame, () => {}, () => {}, () => {}, { now: () => now });
  try {
    clock.setNativeTranslation('en', 'zh-CN');
    assert.equal(sent.some((data) => data.func === 'setOption'), false);
    const event = new Event('message'); Object.defineProperties(event, { source: { value: frame.contentWindow }, origin: { value: 'https://www.youtube.com' }, data: { value: { event: 'infoDelivery', info: { currentTime: 1, playerState: 2 } } } });
    window.dispatchEvent(event);
    assert.deepEqual(sent.at(-1), { event: 'command', func: 'setOption', args: ['captions', 'track', { languageCode: 'en', translationLanguage: { languageCode: 'zh-Hans' } }] });
    for (let i = 0; i < 10; i++) { now += 1600; clock.applyNativeTranslation(); }
    assert.equal(sent.filter((data) => data.func === 'setOption').length, 3);
    const count = sent.length; clock.clearNativeTranslation(); now += 2000; clock.applyNativeTranslation();
    assert.equal(sent.length, count);
    assert.equal(sent.some((data) => data.func === 'unloadModule'), false);
  } finally {
    clock.destroy();
    for (const [key, value] of Object.entries(old)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
});
