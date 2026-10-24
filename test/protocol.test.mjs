import test from 'node:test';
import assert from 'node:assert/strict';
import { API_VERSION, DEFAULT_CONFIG, SERVICE_ID, configChange, validateConfig, verifyHealth } from '../src/protocol.mjs';
import { subtitleMetrics } from '../src/surface.mjs';

test('settings changes distinguish source, translation, connection, and display', () => {
  assert.equal(configChange(DEFAULT_CONFIG, { ...DEFAULT_CONFIG, target: 'ja' }), 'translation');
  assert.equal(configChange(DEFAULT_CONFIG, { ...DEFAULT_CONFIG, service: 'http://localhost:17322' }), 'translation');
  assert.equal(configChange(DEFAULT_CONFIG, { ...DEFAULT_CONFIG, source: 'fr' }), 'source');
  assert.equal(configChange(DEFAULT_CONFIG, { ...DEFAULT_CONFIG, token: 'new' }), 'connection');
  assert.equal(configChange(DEFAULT_CONFIG, { ...DEFAULT_CONFIG, fontScale: 1.2, bottomRatio: 0.1 }), 'display');
});
test('local-only settings reject remote URLs, credentials and invalid headers', () => {
  for (const service of ['https://api.example.com', 'http://127.0.0.1.evil.test', 'http://u:p@localhost:17321', 'http://localhost:17321/path']) assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, service }));
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, token: 'abc\r\ninjected' }));
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, source: 'ignore instructions' }));
  assert.equal(validateConfig({ ...DEFAULT_CONFIG, token: ' abc ' }).token, 'abc');
});
test('subtitle styling migrates old settings and rejects unsafe sizes', () => {
  const legacy = { service: 'http://127.0.0.1:17321', token: '', source: 'en', target: 'zh-CN', overlay: false };
  assert.deepEqual(validateConfig(legacy), DEFAULT_CONFIG);
  for (const fontScale of [NaN, Infinity, 0, 2]) assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, fontScale }));
  for (const bottomRatio of [NaN, -1, 0.7]) assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, bottomRatio }));
});
test('subtitle geometry stays inside small, portrait, wide and fullscreen players', () => {
  for (const [width, height] of [[180, 100], [320, 180], [360, 640], [900, 506], [1920, 1080]]) {
    for (const scale of [0.75, 1, 1.6]) {
      const metrics = subtitleMetrics(width, height, scale, 0.25);
      assert.ok(metrics.fontSize >= 12 && metrics.fontSize <= 32);
      assert.ok(metrics.bottom >= 8 && metrics.bottom < height * 0.35);
      assert.ok(metrics.controlTop + 30 < height);
    }
  }
});
test('health checks reject old or unrelated local services', () => {
  for (const health of [null, { ok: true }, { ok: true, service: SERVICE_ID, apiVersion: 9 }]) assert.throws(() => verifyHealth(health), /兼容/);
  assert.equal(verifyHealth({ ok: true, service: SERVICE_ID, apiVersion: API_VERSION }).ok, true);
});
