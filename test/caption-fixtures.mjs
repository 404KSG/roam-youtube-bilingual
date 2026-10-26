export const fixtureVideoId = 'vif8NQcjVf0';
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
