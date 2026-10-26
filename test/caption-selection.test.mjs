import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCaptionTracks, captionLanguages, englishCaptionLanguage } from '../server/caption-selection.mjs';
import { isCaptionLanguage, isCaptionTrackKey } from '../server/caption-key.mjs';
import { namedTrackMetadata, namedEnglishKey } from './caption-fixtures.mjs';
const track = (params, name = 'English') => [{ ext: 'json3', name, url: 'https://www.youtube.com/api/timedtext?' + params }];
const metadata = () => ({ id: 'vif8NQcjVf0', title: 'Video', subtitles: { en: track('lang=en') }, automatic_captions: {
  'en-orig': track('lang=en&kind=asr'), 'zh-Hans': track('lang=en&kind=asr&tlang=zh-Hans'),
  'zh-Hans-en': track('lang=en&tlang=zh-Hans-en', 'Chinese from English'),
} });

test('named English track IDs remain distinct from display language codes', () => {
  const meta = namedTrackMetadata();
  assert.equal(isCaptionLanguage(namedEnglishKey), false);
  assert.equal(isCaptionTrackKey(namedEnglishKey), true);
  assert.equal(isCaptionTrackKey('zh-Hans-en-a_B-cDefG12'), true);
  assert.equal(englishCaptionLanguage(meta), namedEnglishKey);
  const selected = selectCaptionTracks(meta, [namedEnglishKey, 'zh-Hans'], namedEnglishKey);
  assert.equal(selected[namedEnglishKey][0].downloadLanguage, namedEnglishKey);
  assert.equal(selected['zh-Hans'][0].downloadLanguage, 'zh-Hans-' + namedEnglishKey);
  assert.equal(new URL(selected['zh-Hans'][0].url).searchParams.get('name'), 'Default');
  assert.deepEqual(captionLanguages(meta, namedEnglishKey).map(item => item.code).sort(), ['ja', 'zh-Hans']);
});
test('unsafe metadata keys cannot become source filenames or download patterns', () => {
  const meta = namedTrackMetadata(); meta.subtitles['en-../outside'] = meta.subtitles[namedEnglishKey]; delete meta.subtitles[namedEnglishKey];
  assert.equal(englishCaptionLanguage(meta), 'en-orig');
});
test('Chinese is requested from the same manual English track, not the ASR translation', () => {
  const selected = selectCaptionTracks(metadata(), ['en', 'zh-Hans'], 'en');
  const url = new URL(selected['zh-Hans'][0].url);
  assert.equal(url.searchParams.get('kind'), null); assert.equal(url.searchParams.get('lang'), 'en');
  assert.equal(url.searchParams.get('tlang'), 'zh-Hans-en');
  assert.equal(selected['zh-Hans'][0].downloadLanguage, 'zh-Hans-en');
  assert.equal(new URL(selected.en[0].url).searchParams.get('tlang'), null);
  assert.deepEqual(captionLanguages(metadata(), 'en').map(item => item.code).sort(), ['en', 'zh-Hans']);
});
test('missing same-source translation fails instead of silently using a different transcript', () => {
  const meta = metadata(); delete meta.automatic_captions['zh-Hans-en'];
  assert.throws(() => selectCaptionTracks(meta, ['zh-Hans'], 'en'), { code: 'SOURCE_TRACK_UNAVAILABLE' });
  assert.equal(captionLanguages(meta, 'en').some(item => item.code === 'zh-Hans'), false);
});
test('videos with only automatic English keep both languages on that automatic source', () => {
  const meta = metadata(); meta.subtitles = {}; delete meta.automatic_captions['zh-Hans-en'];
  assert.equal(englishCaptionLanguage(meta), 'en-orig');
  const selected = selectCaptionTracks(meta, ['en-orig', 'zh-Hans'], 'en-orig');
  assert.equal(new URL(selected['zh-Hans'][0].url).searchParams.get('kind'), 'asr');
  assert.equal(selected['zh-Hans'][0].downloadLanguage, 'zh-Hans');
});
test('uploaded target captions are preferred and subtitle URLs cannot escape YouTube', () => {
  const meta = metadata(); meta.subtitles['zh-Hans'] = track('lang=zh-Hans', 'Uploaded Chinese');
  assert.equal(new URL(selectCaptionTracks(meta, ['zh-Hans'], 'en')['zh-Hans'][0].url).searchParams.get('tlang'), null);
  meta.subtitles['zh-Hans'][0].url = 'http://127.0.0.1/private';
  assert.throws(() => selectCaptionTracks(meta, ['zh-Hans'], 'en'));
});
