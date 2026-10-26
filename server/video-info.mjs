import { captionDownloadError, fetchCaptionMetadata } from './captions.mjs';
import { captionLanguages, englishCaptionLanguage, captionSelection } from './caption-selection.mjs';
const LANGUAGE = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/;

export function sanitizeVideoInfo(meta, videoId) {
  if (meta?.id !== videoId || typeof meta.title !== 'string' || !meta.title.trim()) throw new Error('YouTube returned incomplete video metadata.');
  const sourceLanguage = englishCaptionLanguage(meta);
  const languages = captionLanguages(meta, sourceLanguage);
  let playerSourceLanguage = sourceLanguage?.replace(/-orig$/, '') || 'en';
  let kind = '', name = '', vssId;
  const sourceTracks = meta.subtitles?.[sourceLanguage] || meta.automatic_captions?.[sourceLanguage] || [];
  const selected = sourceTracks.find(track => track.ext === 'json3');
  try {
    const url = new URL(selected?.url);
    const language = url.searchParams.get('lang');
    if (LANGUAGE.test(language || '')) playerSourceLanguage = language;
    kind = url.searchParams.get('kind') === 'asr' ? 'asr' : '';
    name = url.searchParams.get('name') || '';
    vssId = url.searchParams.get('vss_id') || undefined;
  } catch { /* Incomplete tracks fail selection; URLs never leave the helper. */ }
  const sourceTrack = { languageCode: playerSourceLanguage, languageName: 'English', kind, name: name.slice(0, 200),
    ...(vssId ? { vss_id: vssId.slice(0, 200) } : !name ? { vss_id: `${kind === 'asr' ? 'a.' : '.'}${playerSourceLanguage}` } : {}) };
  return { videoId, title: meta.title.trim().slice(0, 1000), sourceLanguage, playerSourceLanguage, sourceTrack, sourceSelection: sourceLanguage ? captionSelection(meta, sourceLanguage, sourceLanguage) : null, languages };
}

export async function fetchVideoInfo(videoId, signal) {
  try { return sanitizeVideoInfo(await fetchCaptionMetadata(videoId, signal), videoId); }
  catch (error) {
    if (error.name === 'AbortError' || signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (error.code === 'ENOENT') throw new Error('yt-dlp was not found. Check the local subtitle helper.');
    if (error.stderr || error.killed) {
      const failure = captionDownloadError(error);
      if (failure.code === 'YOUTUBE_RATE_LIMITED') throw failure;
      throw Object.assign(new Error('YouTube\'s caption language list is unavailable. Try again later.'), { code: 'YOUTUBE_METADATA_FAILED' });
    }
    throw error;
  }
}
