import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCaptionTracks, captionLanguages } from '../server/caption-selection.mjs';
const track = (params, name = 'English') => [{ ext: 'json3', name, url: 'https://www.youtube.com/api/timedtext?' + params }];
const metadata = () => ({ id: 'vif8NQcjVf0', title: 'Video', subtitles: { en: track('lang=en') }, automatic_captions: {
  'en-orig': track('lang=en&kind=asr'), 'zh-Hans': track('lang=en&kind=asr&tlang=zh-Hans'),
  'zh-Hans-en': track('lang=en&tlang=zh-Hans-en', 'Chinese from English'),
} });

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
test('uploaded target captions are preferred and subtitle URLs cannot escape YouTube', () => {
  const meta = metadata(); meta.subtitles['zh-Hans'] = track('lang=zh-Hans', 'Uploaded Chinese');
  assert.equal(new URL(selectCaptionTracks(meta, ['zh-Hans'], 'en')['zh-Hans'][0].url).searchParams.get('tlang'), null);
  meta.subtitles['zh-Hans'][0].url = 'http://127.0.0.1/private';
  assert.throws(() => selectCaptionTracks(meta, ['zh-Hans'], 'en'));
});
