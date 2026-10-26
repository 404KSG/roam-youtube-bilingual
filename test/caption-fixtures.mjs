export const fixtureVideoId = 'vif8NQcjVf0';
export const namedEnglishKey = 'en-ehkg1hFWq8A';
export function namedTrackMetadata() {
  const meta = fixtureMetadata(), url = `https://www.youtube.com/api/timedtext?v=${fixtureVideoId}&lang=en&name=Default`;
  delete meta.subtitles.en;
  meta.subtitles[namedEnglishKey] = [{ ext: 'json3', name: 'English - Default', url }];
  for (const language of ['zh-Hans', 'ja']) {
    delete meta.automatic_captions[language + '-en'];
    const key = `${language}-${namedEnglishKey}`;
    meta.automatic_captions[key] = [{ ext: 'json3', name: language + ' from English - Default', url: url + '&tlang=' + key }];
  }
  return meta;
}
export function fixtureMetadata() {
  const track = (query, name) => [{ ext: 'json3', name, url: `https://www.youtube.com/api/timedtext?v=${fixtureVideoId}&${query}` }];
  return { id: fixtureVideoId, title: 'Caption fixture', http_headers: { 'User-Agent': 'Fixture' }, subtitles: { en: track('lang=en', 'English') }, automatic_captions: {
    'en-orig': track('lang=en&kind=asr', 'English (Original)'),
    'zh-Hans': track('lang=en&kind=asr&tlang=zh-Hans', 'Chinese'),
    'zh-Hans-en': track('lang=en&tlang=zh-Hans-en', 'Chinese from English'),
    ja: track('lang=en&kind=asr&tlang=ja', 'Japanese'),
    'ja-en': track('lang=en&tlang=ja-en', 'Japanese from English'),
  } };
}
