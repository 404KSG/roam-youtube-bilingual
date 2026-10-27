import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createCaptionBundleCache, makeCaptionBundle } from '../server/caption-bundle-cache.mjs';

const videoId = 'vif8NQcjVf0';
const select = language => ({ downloadLanguage: language, identity: { lang: 'en', kind: '', name: '', tlang: language === 'en' ? '' : language } });
const info = { videoId, title: 'Safe title', sourceLanguage: 'en', playerSourceLanguage: 'en', sourceTrack: { languageCode: 'en', languageName: 'English', kind: '', name: '', vss_id: '.en' }, sourceSelection: select('en'), languages: [{ code: 'zh-Hans', name: 'Chinese', autoTranslated: true, selection: select('zh-Hans') }] };
const bundle = now => makeCaptionBundle({ videoId, target: 'zh-Hans', info, source: { trackKey: 'en', playerTrack: JSON.stringify(info.sourceTrack), selection: select('en'), cues: [{ start: 0, end: 2, text: 'English' }] }, targetTrack: { type: 'auto-translated', selection: select('zh-Hans'), cues: [{ start: 0, end: 2, text: '中文' }] }, now: () => now });
async function directory(t) { const dir = await mkdtemp(join(tmpdir(), 'ryb-bundle-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }

test('verified bundles survive restart and recompute content-bound pair IDs', async t => {
  const dir = await directory(t), first = createCaptionBundleCache(dir, { now: () => 1_000 });
  const saved = bundle(1_000); assert.equal(await first.write(saved), true);
  const loaded = await createCaptionBundleCache(dir, { now: () => 1_001 }).read(videoId, 'zh-Hans');
  assert.equal(loaded.freshness, 'fresh'); assert.equal(loaded.bundle.sanitizedInfo.title, 'Safe title'); assert.equal(loaded.bundle.source.cues[0].text, 'English'); assert.equal(loaded.bundle.targetTrack.cues[0].text, '中文');
  const path = first.pathFor(videoId, 'zh-Hans'), altered = JSON.parse(await readFile(path, 'utf8')); altered.targetTrack.cues[0].text = 'tampered'; await writeFile(path, JSON.stringify(altered));
  assert.equal(await first.read(videoId, 'zh-Hans'), undefined);
});
test('freshness is separate from retention and fresh metadata is discoverable without upstream', async t => {
  const dir = await directory(t); let now = 0; const cache = createCaptionBundleCache(dir, { now: () => now, freshnessMs: 10, retentionMs: 100 });
  assert.equal(await cache.write(bundle(now)), true); now = 10; assert.equal((await cache.read(videoId, 'zh-Hans')).freshness, 'fresh'); assert.equal((await cache.findFreshInfo(videoId)).title, 'Safe title');
  now = 11; assert.equal((await cache.read(videoId, 'zh-Hans')).freshness, 'due'); now = 101; assert.equal(await cache.read(videoId, 'zh-Hans'), undefined);
});
test('bundle cache rejects symlinked files, symlinked directories, traversal, and future records', async t => {
  const dir = await directory(t), cache = createCaptionBundleCache(dir); await assert.rejects(cache.read('../private', 'zh-Hans'), /Invalid/);
  const outside = join(dir, 'outside.json'); await writeFile(outside, '{}'); await symlink(outside, cache.pathFor(videoId, 'zh-Hans'));
  assert.equal(await cache.read(videoId, 'zh-Hans'), undefined);
  const target = join(dir, 'target'); await mkdir(target); const linked = join(dir, 'linked-cache'); await symlink(target, linked);
  const unsafe = createCaptionBundleCache(linked); assert.equal(await unsafe.read(videoId, 'zh-Hans'), undefined); assert.equal(await unsafe.write(bundle(Date.now())), false); assert.equal(await unsafe.findFreshInfo(videoId), undefined);
  const safe = createCaptionBundleCache(join(dir, 'safe')); await safe.write(bundle(Date.now())); const path = safe.pathFor(videoId, 'zh-Hans'), altered = JSON.parse(await readFile(path, 'utf8')); altered.validatedAt = Date.now() + 120000; await writeFile(path, JSON.stringify(altered)); assert.equal(await safe.read(videoId, 'zh-Hans'), undefined);
});
test('bundle construction and reads reject malformed, oversized, unknown, and cross-field cache data', async t => {
  const valid = () => ({ videoId, target: 'zh-Hans', info, source: { trackKey: 'en', playerTrack: JSON.stringify(info.sourceTrack), selection: select('en'), cues: [{ start: 0, end: 1, text: 'English' }] }, targetTrack: { type: 'auto-translated', selection: select('zh-Hans'), cues: [{ start: 0, end: 1, text: '中文' }] } });
  for (const mutate of [value => { value.source.trackKey = 'ja'; }, value => { value.source.playerTrack = '{}'; }, value => { value.source.selection = select('ja'); }, value => { value.targetTrack.type = 'uploaded'; }, value => { value.targetTrack.selection = select('ja'); }]) { const value = valid(); mutate(value); assert.throws(() => makeCaptionBundle(value), /Invalid/); }
  const dir = await directory(t), cache = createCaptionBundleCache(dir), path = cache.pathFor(videoId, 'zh-Hans'); await writeFile(path, '{bad'); assert.equal(await cache.read(videoId, 'zh-Hans'), undefined);
  const unknown = bundle(Date.now()); unknown.unexpected = true; await writeFile(path, JSON.stringify(unknown)); assert.equal(await cache.read(videoId, 'zh-Hans'), undefined);
  const oversized = bundle(Date.now()); oversized.sanitizedInfo.title = 'x'.repeat(70 * 1024); await writeFile(path, JSON.stringify(oversized)); assert.equal(await cache.read(videoId, 'zh-Hans'), undefined);
  for (const mutate of [value => { value.source.trackKey = 'ja'; }, value => { value.source.playerTrack = '{}'; }, value => { value.source.selection = select('ja'); }, value => { value.targetTrack.type = 'uploaded'; }, value => { value.targetTrack.selection = select('ja'); }]) { const crossed = bundle(Date.now()); mutate(crossed); crossed.pairId = createHash('sha256').update(JSON.stringify([crossed.schema, crossed.cachePolicy, crossed.captionPolicy, crossed.videoId, crossed.source.trackKey, crossed.source.playerTrack, crossed.source.selection, crossed.source.cueSha256, crossed.target, crossed.targetTrack.language, crossed.targetTrack.type, crossed.targetTrack.selection, crossed.targetTrack.cueSha256])).digest('hex'); await writeFile(path, JSON.stringify(crossed)); assert.equal(await cache.read(videoId, 'zh-Hans'), undefined); }
});
test('eviction is deterministic LRU after reads and never skips entries needed for byte or file bounds', async t => {
  const dir = await directory(t); let now = 0; const cache = createCaptionBundleCache(dir, { now: () => now, maxFiles: 2, maxBytes: 1024 * 1024 });
  const make = (target, text) => makeCaptionBundle({ videoId, target, info: { ...info, languages: [{ code: target, name: target, autoTranslated: true, selection: select(target) }] }, source: { trackKey: 'en', playerTrack: JSON.stringify(info.sourceTrack), selection: select('en'), cues: [{ start: 0, end: 1, text: 'English' }] }, targetTrack: { type: 'auto-translated', selection: select(target), cues: [{ start: 0, end: 1, text }] }, now: () => now });
  await cache.write(make('zh-Hans', 'one')); now = 1; await cache.write(make('ja', 'two')); now = 2; await cache.read(videoId, 'zh-Hans'); now = 3; await cache.write(make('fr', 'three'));
  assert.ok(await cache.read(videoId, 'zh-Hans')); assert.equal(await cache.read(videoId, 'ja'), undefined); assert.ok(await cache.read(videoId, 'fr'));
  const tiedDir = await directory(t), tied = createCaptionBundleCache(tiedDir, { now: () => 9, maxFiles: 2 }); await tied.write(make('zh-Hans', 'z')); await tied.write(make('ja', 'j')); await tied.write(make('fr', 'f'));
  assert.equal(await tied.read(videoId, 'fr'), undefined); assert.ok(await tied.read(videoId, 'ja')); assert.ok(await tied.read(videoId, 'zh-Hans'));
  const byteDir = await directory(t); const first = make('zh-Hans', 'a'.repeat(300)), second = make('ja', 'b'.repeat(300)), third = make('fr', 'c'.repeat(300)); const sample = Buffer.byteLength(JSON.stringify(first)); const byteCache = createCaptionBundleCache(byteDir, { now: () => now++, maxFiles: 10, maxBytes: sample + 10 });
  await byteCache.write(first); await byteCache.write(second); await byteCache.write(third);
  const files = (await (await import('node:fs/promises')).readdir(byteDir)).filter(name => name.endsWith('.bundle.json')); assert.equal(files.length, 1);
});
