import test from 'node:test';
import assert from 'node:assert/strict';
import { makeServer } from '../server/index.mjs';

const token = 'test-only-pairing-token';
async function fixture(t, options = {}) {
  const server = makeServer({ token, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
function options(body, headers = {}) {
  return { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) };
}
test('authenticated health never contains credentials; wrong token is rejected', async (t) => {
  const base = await fixture(t);
  assert.equal((await fetch(`${base}/health`)).status, 401);
  const response = await fetch(`${base}/health`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.equal(text.includes(token), false);
  assert.equal(text.includes('OPENAI_API_KEY'), false);
});
test('untrusted origins and DNS-rebinding Host are rejected, Roam preflight is allowed', async (t) => {
  const base = await fixture(t);
  assert.equal((await fetch(`${base}/health`, { headers: { Origin: 'https://evil.example', Authorization: `Bearer ${token}` } })).status, 403);
  const response = await fetch(`${base}/v1/translate`, { method: 'OPTIONS', headers: { Origin: 'https://roamresearch.com', 'Access-Control-Request-Private-Network': 'true' } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://roamresearch.com');
  assert.equal(response.headers.get('Access-Control-Allow-Private-Network'), 'true');
  const { request } = await import('node:http');
  const hostStatus = await new Promise((resolve) => { const req = request(base + '/health', { headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); }); req.end(); });
  assert.equal(hostStatus, 403);
});
test('caption requests validate input and cache by video plus source language', async (t) => {
  let calls = 0;
  const base = await fixture(t, { captionFetcher: async () => { calls++; return [{ id: 0, start: 0, end: 2, text: 'Hello' }]; } });
  assert.equal((await fetch(`${base}/v1/captions`, options({ videoId: '$(touch /tmp/unsafe)' }))).status, 400);
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${base}/v1/captions`, options({ videoId: 'M7lc1UVf-VE', language: 'en' }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).source, 'youtube');
  }
  assert.equal(calls, 1);
});
test('oversized and non-JSON requests fail before provider calls', async (t) => {
  let calls = 0;
  const base = await fixture(t, { translator: { translate: () => { calls++; } } });
  const oversized = await fetch(`${base}/v1/translate`, options({ x: 'x'.repeat(65536) }));
  assert.equal(oversized.status, 413);
  const wrongType = await fetch(`${base}/v1/translate`, options({}, { 'Content-Type': 'text/plain' }));
  assert.equal(wrongType.status, 415);
  assert.equal(calls, 0);
});
test('demo is explicitly marked and uses only fixture data', async (t) => {
  const base = await fixture(t, { demo: true, captionFetcher: () => { throw new Error('must not use YouTube'); }, translator: { translate: () => { throw new Error('must not use API'); } } });
  const captions = await (await fetch(`${base}/v1/captions`, options({ videoId: 'M7lc1UVf-VE', language: 'en' }))).json();
  assert.equal(captions.demo, true);
  assert.equal(captions.source, 'demo-fixture');
  const translated = await (await fetch(`${base}/v1/translate`, options({ entries: captions.cues.map(({ id, text }) => ({ id, text })), target: 'zh-CN' }))).json();
  assert.equal(translated.demo, true);
  assert.equal(translated.translations[0].text, '好用的工具，应该帮助你专注于想法本身。');
});
test('static assets work without authentication and cannot read .env or escape the root', async (t) => {
  const base = await fixture(t);
  assert.equal((await fetch(`${base}/demo`)).status, 200);
  assert.equal((await fetch(`${base}/.env`)).status, 401);
  assert.equal((await fetch(`${base}/server/index.mjs`)).status, 401);
});
