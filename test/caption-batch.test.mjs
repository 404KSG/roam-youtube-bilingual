import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fetchCaptionTracks } from '../server/captions.mjs';
import { fixtureMetadata, fixtureVideoId as id, namedTrackMetadata, namedEnglishKey } from './caption-fixtures.mjs';
const json3 = text => JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: text }] }] });
function cli(download, metadata = fixtureMetadata()) {
  return async (_file, args, options) => {
    if (args.includes('--simulate')) return { stdout: JSON.stringify(metadata) };
    assert.ok(args.includes('--no-simulate')); assert.ok(args.includes('--abort-on-error'));
    assert.equal(args.includes('--load-info-json'), false, 'keep preparation and download in the native extraction process');
    const match = new RegExp(args[args.indexOf('--sub-langs') + 1]);
    const selected = Object.fromEntries(Object.entries({ ...metadata.automatic_captions, ...metadata.subtitles }).filter(([language]) => match.test(language)).map(([language, tracks]) => [language, tracks.find(track => track.ext === 'json3')]));
    const observed = { id, requested_subtitles: selected }, folder = dirname(args[args.indexOf('--output') + 1]);
    try { await download({ args, options, selected, observed, folder }); return { stdout: JSON.stringify(observed) }; }
    catch (error) { error.stdout = JSON.stringify(observed); throw error; }
  };
}
test('a named English source can be downloaded through its full opaque track key', async () => {
  const result = await fetchCaptionTracks(id, [namedEnglishKey], undefined, { sourceLanguage: namedEnglishKey, exec: cli(async ({ folder, selected }) => {
    assert.ok(selected[namedEnglishKey]);
    await writeFile(join(folder, `${id}.${namedEnglishKey}.json3`), json3('Named English track'));
  }, namedTrackMetadata()) });
  assert.equal(result.tracks[namedEnglishKey][0].text, 'Named English track');
});
test('a translated alias carrying the same opaque source ID is accepted without losing its preparation delay', async () => {
  const alias = 'zh-Hans-' + namedEnglishKey;
  const result = await fetchCaptionTracks(id, ['zh-Hans'], undefined, { sourceLanguage: namedEnglishKey, waitSeconds: 60, exec: cli(async ({ folder, args, selected }) => {
    assert.equal(args[args.indexOf('--sleep-subtitles') + 1], '60');
    assert.ok(selected[alias]);
    await writeFile(join(folder, `${id}.${alias}.json3`), json3('同源译文'));
  }, namedTrackMetadata()) });
  assert.equal(result.tracks['zh-Hans'][0].text, '同源译文');
});
test('unsafe download selectors are rejected before executing yt-dlp', async () => {
  let calls = 0;
  await assert.rejects(fetchCaptionTracks(id, ['zh-Hans'], undefined, { selections: { 'zh-Hans': { downloadLanguage: 'zh-Hans|en', identity: { lang: 'en', kind: '', name: '', tlang: 'zh-Hans' } } }, exec: async () => { calls++; } }), /Invalid subtitle source selection/);
  assert.equal(calls, 0);
});
test('a native batch downloads English and the manual-source target while preserving both texts', async () => {
  let folder;
  const result = await fetchCaptionTracks(id, ['en', 'ja'], undefined, { exec: cli(async data => {
    folder = data.folder;
    const target = new URL(data.selected['ja-en'].url);
    assert.equal(target.searchParams.get('kind'), null); assert.equal(target.searchParams.get('tlang'), 'ja-en');
    await writeFile(join(folder, `${id}.en.json3`), json3('English'));
    await writeFile(join(folder, `${id}.ja-en.json3`), json3('日本語'));
  }) });
  assert.equal(result.tracks.en[0].text, 'English'); assert.equal(result.tracks.ja[0].text, '日本語');
  assert.equal(result.error, undefined); await assert.rejects(access(folder));
});
test('a target 429 preserves verified English without substituting it as translation', async () => {
  const result = await fetchCaptionTracks(id, ['en', 'zh-Hans'], undefined, { exec: cli(async ({ folder }) => {
    await writeFile(join(folder, `${id}.en.json3`), json3('Original only'));
    throw Object.assign(new Error('failed'), { stderr: 'HTTP Error 429: Too Many Requests' });
  }) });
  assert.equal(result.tracks.en[0].text, 'Original only'); assert.equal(result.tracks['zh-Hans'], undefined);
  assert.equal(result.error.code, 'YOUTUBE_RATE_LIMITED');
});
test('prepared translation uses the native source alias and retains the preparation delay', async () => {
  const result = await fetchCaptionTracks(id, ['zh-Hans'], undefined, { waitSeconds: 60, exec: cli(async ({ args, options, folder, selected }) => {
    assert.equal(args[args.indexOf('--sleep-subtitles') + 1], '60'); assert.ok(options.timeout > 120000);
    assert.equal(new URL(selected['zh-Hans-en'].url).searchParams.get('kind'), null);
    await writeFile(join(folder, `${id}.zh-Hans-en.json3`), json3('同源译文'));
  }) });
  assert.equal(result.error, undefined); assert.equal(result.tracks['zh-Hans'][0].text, '同源译文');
});
test('an actual source mismatch is rejected even when a subtitle file exists', async () => {
  const result = await fetchCaptionTracks(id, ['zh-Hans'], undefined, { exec: cli(async ({ folder, observed }) => {
    observed.requested_subtitles['zh-Hans-en'] = { ext: 'json3', url: `https://www.youtube.com/api/timedtext?v=${id}&lang=en&kind=asr&tlang=zh-Hans` };
    await writeFile(join(folder, `${id}.zh-Hans-en.json3`), json3('Wrong source'));
  }) });
  assert.equal(result.tracks['zh-Hans'], undefined); assert.equal(result.error.code, 'SOURCE_TRACK_UNAVAILABLE');
});
test('an aborted batch returns no partial result and removes its temporary files', async () => {
  const controller = new AbortController(); let folder;
  await assert.rejects(fetchCaptionTracks(id, ['en'], controller.signal, { exec: cli(async data => {
    folder = data.folder; await writeFile(join(folder, `${id}.en.json3`), json3('Old video')); controller.abort();
  }) }), { name: 'AbortError' });
  await assert.rejects(access(folder));
});
