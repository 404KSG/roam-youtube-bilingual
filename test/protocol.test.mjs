import test from 'node:test';
import assert from 'node:assert/strict';
import { API_VERSION, DEFAULT_CONFIG, SERVICE_ID, validateConfig, verifyHealth, singleLine, fittedFontSize } from '../src/protocol.mjs';

test('appearance settings migrate shared sizes and drop all old API settings', () => {
  assert.deepEqual(validateConfig({ target: 'zh-CN', fontScale: 1, token: 'old-key', provider: 'api', service: 'https://unused.example' }), { target: 'zh-Hans', sourceFontSize: 20, targetFontSize: 20, sourceColor: '#c7cad6', targetColor: '#ffffff' });
  assert.deepEqual(validateConfig({ target: 'ja', fontSize: 24 }), { target: 'ja', sourceFontSize: 24, targetFontSize: 24, sourceColor: '#c7cad6', targetColor: '#ffffff' });
  for (const fontSize of [0, 11, 37, NaN, Infinity]) assert.throws(() => validateConfig({ fontSize }));
});
test('two source lines become one without dropping text', () => {
  assert.equal(singleLine('The first line\n continues here.\t '), 'The first line continues here.');
  assert.equal(singleLine('第一行\n第二行'), '第一行 第二行');
});
test('font fitting uses the available width instead of wrapping or clipping text', () => {
  assert.equal(fittedFontSize(20, 802, 700), 20);
  assert.equal(fittedFontSize(20, 502, 1000), 10);
  assert.equal(fittedFontSize(20, 500, 0), 20);
  assert.equal(fittedFontSize(20, -1, 100), 0);
});
test('new compact client rejects older helpers', () => {
  assert.throws(() => verifyHealth({ ok: true, service: SERVICE_ID, apiVersion: 1, provider: 'youtube-native' }));
  assert.equal(verifyHealth({ ok: true, service: SERVICE_ID, apiVersion: API_VERSION, provider: 'youtube-unified' }).ok, true);
});
