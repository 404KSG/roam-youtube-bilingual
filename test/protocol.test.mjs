import test from 'node:test';
import assert from 'node:assert/strict';
import { API_VERSION, DEFAULT_CONFIG, PAGE_SIZE, SERVICE_ID, configChange, cuePage, validateConfig, verifyHealth } from '../src/protocol.mjs';

test('changing only target or service invalidates translations, never original subtitles', () => {
  assert.equal(configChange(DEFAULT_CONFIG, { ...DEFAULT_CONFIG, target: 'ja' }), 'translation');
  assert.equal(configChange(DEFAULT_CONFIG, { ...DEFAULT_CONFIG, service: 'http://localhost:17322' }), 'translation');
  assert.equal(configChange(DEFAULT_CONFIG, { ...DEFAULT_CONFIG, source: 'fr' }), 'source');
  assert.equal(configChange(DEFAULT_CONFIG, { ...DEFAULT_CONFIG, token: 'new' }), 'connection');
  assert.equal(configChange(DEFAULT_CONFIG, { ...DEFAULT_CONFIG, overlay: false }), 'display');
});
test('local-only settings reject remote URLs, credentials and invalid headers', () => {
  for (const service of ['https://api.example.com', 'http://127.0.0.1.evil.test', 'http://u:p@localhost:17321', 'http://localhost:17321/path']) assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, service }));
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, token: 'abc\r\ninjected' }));
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, source: 'ignore instructions' }));
  assert.equal(validateConfig({ ...DEFAULT_CONFIG, token: ' abc ' }).token, 'abc');
});
test('long transcripts use bounded pages and out-of-range indexes clamp safely', () => {
  assert.deepEqual(cuePage(0), { start: 0, end: 0 });
  assert.deepEqual(cuePage(201, 200), { start: 200, end: 201 });
  assert.deepEqual(cuePage(201, 9999), { start: 200, end: 201 });
  for (const index of [0, 1, 99, 100, 8999, 19999]) {
    const page = cuePage(20000, index);
    assert.ok(page.end - page.start <= PAGE_SIZE);
    assert.ok(index >= page.start && index < page.end);
  }
});
test('health checks reject old or unrelated local services', () => {
  for (const health of [null, { ok: true }, { ok: true, service: SERVICE_ID, apiVersion: 9 }]) assert.throws(() => verifyHealth(health), /兼容/);
  assert.equal(verifyHealth({ ok: true, service: SERVICE_ID, apiVersion: API_VERSION }).ok, true);
});
