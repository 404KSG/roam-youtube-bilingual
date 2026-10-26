import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubtitlePreferences, GLOBAL_PREFERENCES_KEY } from '../src/preferences.mjs';
const a = 'vif8NQcjVf0', b = 'M7lc1UVf-VE';
const japanese = { enabled: true, target: 'ja', sourceFontSize: 24, targetFontSize: 18, sourceColor: '#b7ccff', targetColor: '#ffd580' };
const memoryStorage = () => {
  const values = new Map();
  return { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};

test('changing videos and restarting retains all global subtitle choices', () => {
  const storage = memoryStorage(), store = createSubtitlePreferences(storage);
  store.get(a); assert.equal(store.set(japanese).saved, true);
  assert.deepEqual(store.get(b), japanese);
  assert.deepEqual(createSubtitlePreferences(storage).get(b), japanese);
  assert.equal(storage.length, 1);
});
test('the next explicit change applies to previously visited videos too', () => {
  const store = createSubtitlePreferences(memoryStorage()); store.set(japanese);
  store.set({ target: 'fr', sourceFontSize: 22 });
  assert.deepEqual(store.get(a), { ...japanese, target: 'fr', sourceFontSize: 22 });
  assert.deepEqual(store.get(b), store.get(a));
});
test('a global OFF choice is not undone by an old video-specific ON record', () => {
  const storage = memoryStorage(); storage.setItem('roam-youtube-bilingual/video/v2/' + a, JSON.stringify({ version: 2, ...japanese }));
  const store = createSubtitlePreferences(storage); store.get(a); store.set({ enabled: false });
  const next = createSubtitlePreferences(storage);
  assert.equal(next.get(b).enabled, false); assert.equal(next.get(a).enabled, false);
  assert.equal(next.get().target, 'ja');
});
test('an existing enabled profile is migrated even when the newly opened video has no saved setting', () => {
  const storage = memoryStorage(), key = 'roam-youtube-bilingual/video/v2/' + a, original = JSON.stringify({ version: 2, ...japanese });
  storage.setItem(key, original);
  const store = createSubtitlePreferences(storage);
  assert.deepEqual(store.get(b), japanese); assert.deepEqual(store.get(a), japanese);
  assert.equal(storage.getItem(key), original);
  assert.ok(storage.getItem(GLOBAL_PREFERENCES_KEY));
});
test('v2 OFF overrides its older v1 ON during migration', () => {
  const storage = memoryStorage();
  storage.setItem('roam-youtube-bilingual/video/v1/' + a, JSON.stringify({ version: 1, enabled: true, fontSize: 15 }));
  storage.setItem('roam-youtube-bilingual/video/v2/' + a, JSON.stringify({ version: 2, ...japanese, enabled: false }));
  assert.equal(createSubtitlePreferences(storage).get(b).enabled, false);
});
test('conflicting legacy styles are flagged rather than pretending their last-edit order is known', () => {
  const storage = memoryStorage();
  storage.setItem('roam-youtube-bilingual/video/v2/' + a, JSON.stringify({ version: 2, ...japanese }));
  storage.setItem('roam-youtube-bilingual/video/v2/' + b, JSON.stringify({ version: 2, ...japanese, sourceFontSize: 16 }));
  const store = createSubtitlePreferences(storage);
  assert.equal(store.get().enabled, true); assert.equal(store.get().sourceFontSize, 20);
  assert.match(store.notice, /different styles/);
  store.set({ sourceFontSize: 21 }); assert.equal(store.notice, '');
});
test('existing windows read the latest shared preferences', () => {
  const storage = memoryStorage(), first = createSubtitlePreferences(storage), second = createSubtitlePreferences(storage);
  first.get(a); second.set(japanese); assert.deepEqual(first.get(b), japanese);
  second.set({ enabled: false }); assert.equal(first.refresh().enabled, false);
  storage.removeItem(GLOBAL_PREFERENCES_KEY); assert.equal(first.refresh().enabled, false);
});
test('fresh installations stay off until enabled and use white 20/18 defaults', () => {
  const store = createSubtitlePreferences(memoryStorage());
  assert.deepEqual(store.get(a), { enabled: false, target: 'zh-Hans', sourceFontSize: 20, targetFontSize: 18, sourceColor: '#ffffff', targetColor: '#ffffff' });
});
test('blocked storage is reported while every video retains the current session choice', () => {
  const store = createSubtitlePreferences({ getItem: () => null, setItem: () => { throw new Error('quota'); } });
  assert.equal(store.set(japanese).saved, false); assert.deepEqual(store.get(a), japanese); assert.deepEqual(store.get(b), japanese);
  assert.match(store.saveWarning, /could not be saved/);
});
test('corrupt global data fails safely without reviving old video preferences', () => {
  const storage = memoryStorage(); storage.setItem(GLOBAL_PREFERENCES_KEY, '{broken');
  storage.setItem('roam-youtube-bilingual/video/v2/' + a, JSON.stringify({ version: 2, ...japanese }));
  const store = createSubtitlePreferences(storage); assert.equal(store.get(a).enabled, false);
  assert.throws(() => store.get('../outside')); assert.throws(() => store.set({ sourceFontSize: 100 }));
});
