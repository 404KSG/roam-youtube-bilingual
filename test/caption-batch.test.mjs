import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fetchCaptionTracks } from '../server/captions.mjs';
const id = 'vif8NQcjVf0';
const json3 = text => JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: text }] }] });

test('English and target tracks share one extraction and retain their own text', async () => {
  let calls = 0, folder;
  const result = await fetchCaptionTracks(id, ['en', 'ja'], undefined, { exec: async (_file, args) => {
    calls++;
    assert.equal(args[args.indexOf('--sub-langs') + 1], '^(?:en|ja)$');
    assert.equal(args[args.indexOf('--retries') + 1], '0');
    folder = dirname(args[args.indexOf('--output') + 1]);
    await writeFile(join(folder, `${id}.en.json3`), json3('English'));
    await writeFile(join(folder, `${id}.ja.json3`), json3('日本語'));
    return {};
  } });
  assert.equal(calls, 1); assert.equal(result.tracks.en[0].text, 'English'); assert.equal(result.tracks.ja[0].text, '日本語');
  assert.equal(result.error, undefined); await assert.rejects(access(folder));
});

test('a target 429 preserves completed English without substituting it as translation', async () => {
  const result = await fetchCaptionTracks(id, ['en', 'zh-Hans'], undefined, { exec: async (_file, args) => {
    const folder = dirname(args[args.indexOf('--output') + 1]);
    await writeFile(join(folder, `${id}.en.json3`), json3('Original only'));
    throw Object.assign(new Error('failed'), { stderr: 'HTTP Error 429: Too Many Requests' });
  } });
  assert.equal(result.tracks.en[0].text, 'Original only'); assert.equal(result.tracks['zh-Hans'], undefined);
  assert.equal(result.error.code, 'YOUTUBE_RATE_LIMITED');
});

test('auto-translated captions wait inside the extractor before download', async () => {
  const result = await fetchCaptionTracks(id, ['zh-Hans'], undefined, { waitSeconds: 60, exec: async (_file, args, options) => {
    assert.equal(args[args.indexOf('--sleep-subtitles') + 1], '60');
    assert.ok(options.timeout > 120000, 'the process deadline must include preparation time');
    assert.equal(args[args.indexOf('--retries') + 1], '0');
    const folder = dirname(args[args.indexOf('--output') + 1]);
    await writeFile(join(folder, `${id}.zh-Hans.json3`), json3('真实下载路径测试'));
    return {};
  } });
  assert.equal(result.error, undefined); assert.ok(result.tracks['zh-Hans']);
});

test('an aborted batch returns no partial result and removes its temporary files', async () => {
  const controller = new AbortController(); let folder;
  await assert.rejects(fetchCaptionTracks(id, ['en'], controller.signal, { exec: async (_file, args) => {
    folder = dirname(args[args.indexOf('--output') + 1]);
    await writeFile(join(folder, `${id}.en.json3`), json3('Old video'));
    controller.abort(); return {};
  } }), { name: 'AbortError' });
  await assert.rejects(access(folder));
});
