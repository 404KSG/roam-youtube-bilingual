import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/extension.mjs', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('async function request('), source.indexOf('\nfunction languageName'));
const makeRequest = fetch => vm.runInNewContext(`${code}; request`, { fetch, SERVICE_URL: 'http://127.0.0.1:17321', AbortController, AbortSignal, DOMException, Response });

test('a deadline is reported as timeout, not a disconnected helper', async () => {
  const request = makeRequest(async () => { throw new DOMException('expired', 'TimeoutError'); });
  await assert.rejects(request('/v1/youtube/captions', {}), error => error.code === 'REQUEST_TIMEOUT' && !error.message.includes('unavailable'));
});
test('upstream rate-limit code and local cooldown survive the client transport', async () => {
  let calls = 0;
  const request = makeRequest(async () => { calls++; return new Response(JSON.stringify({ error: 'YouTube 限流', code: 'YOUTUBE_RATE_LIMITED', retryAfterSeconds: 60 }), { status: 429 }); });
  await assert.rejects(request('/v1/youtube/captions', {}), error => error.code === 'YOUTUBE_RATE_LIMITED' && error.status === 429 && error.retryAfterSeconds === 60);
  assert.equal(calls, 1);
});
test('user cancellation remains silent AbortError', async () => {
  const controller = new AbortController(); controller.abort();
  const request = makeRequest(async () => { throw new TypeError('cancelled transport'); });
  await assert.rejects(request('/v1/youtube/captions', {}, controller.signal), { name: 'AbortError' });
});
