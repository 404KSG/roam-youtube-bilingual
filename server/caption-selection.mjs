import { isCaptionLanguage, isCaptionTrackKey } from './caption-key.mjs';
const jsonTrack = tracks => Array.isArray(tracks) ? tracks.find(track => track.ext === 'json3') : undefined;
const unavailable = () => Object.assign(new Error('YouTube does not provide this language from the selected English captions.'), { code: 'SOURCE_TRACK_UNAVAILABLE' });
function checkedUrl(track, videoId) {
  const url = new URL(track?.url);
  if (url.protocol !== 'https:' || !['www.youtube.com', 'youtube.com'].includes(url.hostname) || url.pathname !== '/api/timedtext' || url.username || url.password || (url.port && url.port !== '443') || (url.searchParams.has('v') && url.searchParams.get('v') !== videoId)) throw new Error('YouTube returned an invalid caption track.');
  return url;
}
export function englishCaptionLanguage(meta) {
  const manual = Object.keys(meta.subtitles || {}).filter(key => isCaptionTrackKey(key) && /^en(?:-|$)/.test(key) && jsonTrack(meta.subtitles[key]));
  manual.sort((a, b) => Number(b === 'en') - Number(a === 'en'));
  if (manual.length) return manual[0];
  return Object.keys(meta.automatic_captions || {}).filter(key => isCaptionTrackKey(key) && /^en(?:-|$)/.test(key) && (meta.automatic_captions[key] || []).some(track => {
    try { const url = new URL(track.url); return /^en(?:-|$)/.test(url.searchParams.get('lang') || '') && !url.searchParams.has('tlang'); } catch { return false; }
  })).sort((a, b) => Number(b === 'en-orig') - Number(a === 'en-orig'))[0] || null;
}
function selectOne(meta, language, sourceLanguage) {
  if (!isCaptionTrackKey(language) || (sourceLanguage != null && !isCaptionTrackKey(sourceLanguage))) throw new Error('Invalid subtitle track identifier.');
  const uploaded = jsonTrack(meta.subtitles?.[language]);
  let chosen = uploaded, source, downloadLanguage = language;
  if (!chosen) {
    const manualSource = jsonTrack(meta.subtitles?.[sourceLanguage]);
    source = manualSource || jsonTrack(meta.automatic_captions?.[sourceLanguage]);
    if (!source) throw unavailable();
    downloadLanguage = manualSource ? `${language}-${sourceLanguage}` : language;
    chosen = jsonTrack(meta.automatic_captions?.[downloadLanguage]);
    if (!chosen && language === sourceLanguage) chosen = source;
    if (!chosen) throw unavailable();
  }
  if (!isCaptionTrackKey(downloadLanguage)) throw new Error('Invalid subtitle track identifier.');
  const url = checkedUrl(chosen, meta.id);
  if (!uploaded) {
    const original = checkedUrl(source, meta.id);
    for (const field of ['lang', 'kind', 'name']) if ((url.searchParams.get(field) || '') !== (original.searchParams.get(field) || '')) throw unavailable();
    // Keep the extractor's native manual-source alias. It is distinct from
    // the display language and was verified against real YouTube responses.
  }
  url.searchParams.set('fmt', 'json3');
  return { ext: 'json3', url: url.href, downloadLanguage, name: typeof chosen.name === 'string' ? chosen.name.slice(0, 100) : language };
}
export function selectCaptionTracks(meta, languages, sourceLanguage = englishCaptionLanguage(meta)) {
  if (!sourceLanguage) throw unavailable();
  return Object.fromEntries(languages.map(language => {
    if (!isCaptionTrackKey(language)) throw new Error('Invalid subtitle track identifier.');
    return [language, [selectOne(meta, language, sourceLanguage)]];
  }));
}
export function captionIdentity(track, videoId) {
  const url = checkedUrl(track, videoId);
  return Object.fromEntries(['lang', 'kind', 'name', 'tlang'].map(key => [key, url.searchParams.get(key) || '']));
}
export function captionSelection(meta, language, sourceLanguage) {
  const track = selectOne(meta, language, sourceLanguage);
  return { downloadLanguage: track.downloadLanguage, identity: captionIdentity(track, meta.id) };
}
export function captionLanguages(meta, sourceLanguage) {
  const manualSource = jsonTrack(meta.subtitles?.[sourceLanguage]);
  const suffix = '-' + sourceLanguage;
  const candidates = new Set(Object.keys(meta.subtitles || {}));
  for (const key of Object.keys(meta.automatic_captions || {})) {
    if (!manualSource) candidates.add(key);
    else if (key.endsWith(suffix)) candidates.add(key.slice(0, -suffix.length));
  }
  const result = [];
  for (const code of candidates) {
    if (!isCaptionLanguage(code) || code.endsWith('-orig')) continue;
    try { const track = selectOne(meta, code, sourceLanguage); result.push({ code, name: track.name, autoTranslated: new URL(track.url).searchParams.has('tlang'), selection: { downloadLanguage: track.downloadLanguage, identity: captionIdentity(track, meta.id) } }); }
    catch { /* Do not advertise a translation from a different source track. */ }
  }
  return result;
}
