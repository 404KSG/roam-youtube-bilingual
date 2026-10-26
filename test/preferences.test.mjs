import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoPreferences } from '../src/preferences.mjs';
const a = 'vif8NQcjVf0', b = 'M7lc1UVf-VE';
const memoryStorage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };

test('a video keeps its enabled state, language, and size across a new store instance', () => {
  const storage = memoryStorage(), first = createVideoPreferences(storage, { target: 'zh-Hans', fontSize: 16 });
  assert.equal(first.set(a, { enabled: true, target: 'ja', fontSize: 24 }).saved, true);
  const reopened = createVideoPreferences(storage);
  assert.deepEqual(reopened.get(a), { enabled: true, target: 'ja', fontSize: 24 });
});
test('another video neither inherits enablement nor overwrites an existing choice', () => {
  const store = createVideoPreferences(memoryStorage());
  store.set(a, { enabled: true, target: 'ja', fontSize: 24 });
  assert.deepEqual(store.get(b), { enabled: false, target: 'zh-Hans', fontSize: 20 });
  store.set(b, { enabled: true, target: 'fr', fontSize: 18 });
  assert.deepEqual(store.get(a), { enabled: true, target: 'ja', fontSize: 24 });
});
test('reopening in an existing window sees settings saved by another window', () => {
  const storage = memoryStorage(), firstWindow = createVideoPreferences(storage), secondWindow = createVideoPreferences(storage);
  assert.equal(firstWindow.get(a).enabled, false);
  secondWindow.set(a, { enabled: true, target: 'ja', fontSize: 24 });
  assert.deepEqual(firstWindow.get(a), { enabled: true, target: 'ja', fontSize: 24 });
});
test('an explicit off choice survives reopening without losing language or size', () => {
  const storage = memoryStorage(), store = createVideoPreferences(storage);
  store.set(a, { enabled: true, target: 'ja', fontSize: 24 }); store.set(a, { enabled: false });
  assert.deepEqual(createVideoPreferences(storage).get(a), { enabled: false, target: 'ja', fontSize: 24 });
});
test('blocked storage is reported honestly while the current session retains the choice', () => {
  const store = createVideoPreferences({ getItem: () => null, setItem: () => { throw new Error('quota'); } });
  assert.equal(store.set(a, { enabled: true, fontSize: 16 }).saved, false);
  assert.equal(store.get(a).enabled, true);
});
test('invalid stored content fails safely and cache keys cannot escape their namespace', () => {
  const store = createVideoPreferences({ getItem: () => '{broken', setItem() {} });
  assert.equal(store.get(a).enabled, false);
  assert.throws(() => store.get('../outside'));
  assert.throws(() => store.set(a, { fontSize: 100 }));
});
