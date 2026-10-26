import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/protocol.mjs';
import { createVideoPreferences } from '../src/preferences.mjs';

test('English and translation retain independent sizes and safe colors', () => {
  const settings = validateConfig({ target: 'zh-Hans', sourceFontSize: 14, targetFontSize: 22, sourceColor: '#aabbcc', targetColor: '#FFD580' });
  assert.equal(settings.sourceFontSize, 14); assert.equal(settings.targetFontSize, 22);
  assert.equal(settings.sourceColor, '#aabbcc'); assert.equal(settings.targetColor, '#ffd580');
  assert.throws(() => validateConfig({ sourceColor: 'url(https://example.com)' }));
  assert.throws(() => validateConfig({ targetFontSize: 80 }));
});
test('upgrading preserves the previous ON choice and saves independent styles without destroying the old record', () => {
  const id = 'vif8NQcjVf0', oldKey = 'roam-youtube-bilingual/video/v1/' + id;
  const previous = JSON.stringify({ version: 1, enabled: true, target: 'zh-Hans', fontSize: 15 });
  const data = new Map([[oldKey, previous]]), storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const store = createVideoPreferences(storage), migrated = store.get(id);
  assert.equal(migrated.enabled, true); assert.equal(migrated.sourceFontSize, 15); assert.equal(migrated.targetFontSize, 15);
  store.set(id, { sourceFontSize: 13, targetFontSize: 19, targetColor: '#ffd580' });
  const restored = createVideoPreferences(storage).get(id);
  assert.equal(restored.enabled, true); assert.equal(restored.sourceFontSize, 13); assert.equal(restored.targetFontSize, 19); assert.equal(restored.targetColor, '#ffd580');
  assert.equal(data.get(oldKey), previous);
});
test('a previous shared font size becomes both independent sizes without resetting it', () => {
  const settings = validateConfig({ target: 'ja', fontSize: 15 });
  assert.equal(settings.sourceFontSize, 15); assert.equal(settings.targetFontSize, 15); assert.equal(settings.target, 'ja');
  assert.equal('token' in validateConfig({ token: 'never-store' }), false);
});
