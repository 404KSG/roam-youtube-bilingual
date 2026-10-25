import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCaptionCache } from '../server/caption-cache.mjs';
const id = 'vif8NQcjVf0', cues = [{ start: 0, end: 2, text: 'Caption text', token: 'DO_NOT_STORE' }];
async function directory(t) { const dir = await mkdtemp(join(tmpdir(), 'ryb-cache-test-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }

test('caption cache survives a helper restart without retaining extra fields', async t => {
  const dir = await directory(t); const first = createCaptionCache(dir);
  assert.equal(await first.put(id, 'zh-Hans', cues), true);
  const second = createCaptionCache(dir);
  assert.equal((await second.get(id, 'zh-Hans'))[0].text, 'Caption text');
  const raw = await readFile(join(dir, `${id}.zh-Hans.json`), 'utf8');
  assert.doesNotMatch(raw, /DO_NOT_STORE|token/);
});
test('expired or language-mismatched cache entries are never used', async t => {
  const dir = await directory(t); let now = 1000;
  const cache = createCaptionCache(dir, { now: () => now, maxAgeMs: 100 });
  await cache.put(id, 'en', cues); now = 1101;
  assert.equal(await cache.get(id, 'en'), undefined);
  now = 1000; const file = join(dir, `${id}.en.json`);
  const data = JSON.parse(await readFile(file, 'utf8')); data.language = 'ja'; await writeFile(file, JSON.stringify(data));
  assert.equal(await cache.get(id, 'en'), undefined);
});
test('cache rejects path traversal and symbolic links', async t => {
  const dir = await directory(t), cache = createCaptionCache(dir);
  await assert.rejects(cache.get('../outside', 'en'), /Invalid caption cache key/);
  const other = join(dir, 'other.json'); await writeFile(other, '{}');
  await symlink(other, join(dir, `${id}.en.json`));
  assert.equal(await cache.get(id, 'en'), undefined);
});
test('runtime caption files remain bounded', async t => {
  const dir = await directory(t), cache = createCaptionCache(dir, { maxEntries: 2 });
  for (const language of ['en', 'ja', 'fr']) await cache.put(id, language, cues);
  assert.equal((await readdir(dir)).filter(name => name.endsWith('.json')).length, 2);
});
