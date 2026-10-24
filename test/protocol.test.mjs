import test from 'node:test';
import assert from 'node:assert/strict';
import { API_VERSION, DEFAULT_CONFIG, SERVICE_ID, validateConfig, verifyHealth, nativeCaptionTrack, singleLine, fittedFontSize } from '../src/protocol.mjs';

test('settings contain only target language and font size; old API settings are dropped', () => {
  assert.deepEqual(validateConfig({ target: 'zh-CN', fontScale: 1, token: 'old-key', provider: 'api', service: 'https://unused.example' }), DEFAULT_CONFIG);
  assert.deepEqual(validateConfig({ target: 'ja', fontSize: 24 }), { target: 'ja', fontSize: 24 });
  for (const fontSize of [0, 11, 37, NaN, Infinity]) assert.throws(() => validateConfig({ fontSize }));
});
test('YouTube aliases retain selectable native target languages', () => {
  assert.deepEqual(nativeCaptionTrack('en', 'zh-TW'), { languageCode: 'en', translationLanguage: { languageCode: 'zh-Hant' } });
  assert.equal(nativeCaptionTrack('en', 'ja').translationLanguage.languageCode, 'ja');
  assert.throws(() => nativeCaptionTrack('en', 'bad\nlang'));
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
