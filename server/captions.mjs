import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_SUBTITLE_BYTES, parseSubtitles } from '../src/core.mjs';
import { englishCaptionLanguage, captionSelection, captionIdentity } from './caption-selection.mjs';

const execute = promisify(execFile);
const LANGUAGE = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/;
export function captionDownloadError(error) {
  if (/HTTP[^\n]{0,30}429|Too Many Requests/i.test(String(error.stderr || error.message || ''))) {
    return Object.assign(new Error('YouTube returned HTTP 429. The requested captions are unavailable; the bilingual overlay is hidden.'), { status: 429, code: 'YOUTUBE_RATE_LIMITED' });
  }
  return Object.assign(new Error('YouTube caption download failed. The bilingual overlay is hidden.'), { code: 'YOUTUBE_DOWNLOAD_FAILED' });
}
export async function fetchCaptionMetadata(videoId, signal, { exec = execute } = {}) {
  if (!/^[\w-]{11}$/.test(videoId || '')) throw new Error('Invalid YouTube video ID.');
  const { stdout } = await exec(process.env.YT_DLP_PATH || 'yt-dlp', [
    '--ignore-config', '--no-playlist', '--skip-download', '--simulate', '--write-auto-subs', '--no-warnings',
    '--socket-timeout', '15', '--retries', '0', '--print', '%(.{id,title,subtitles,automatic_captions})j',
    '--', `https://www.youtube.com/watch?v=${videoId}`,
  ], { timeout: 60000, maxBuffer: 8 * 1024 * 1024, signal, windowsHide: true });
  signal?.throwIfAborted();
  let meta;
  try { meta = JSON.parse(stdout); } catch { throw new Error('YouTube returned invalid caption metadata.'); }
  if (meta?.id !== videoId || typeof meta.title !== 'string' || !meta.title.trim()) throw new Error('YouTube returned incomplete caption metadata.');
  return meta;
}

// Keep extraction, preparation and download in the SAME yt-dlp process. Use
// its native manual-source aliases, then verify the actual selected identities.
// No signed-URL files, cookie export, retry fallback or alternate translators.
export async function fetchCaptionTracks(videoId, languages, signal, { exec = execute, waitSeconds = 0, sourceLanguage, expectedSourceTrack, selections } = {}) {
  if (!/^[\w-]{11}$/.test(videoId || '')) throw new Error('Invalid YouTube video ID.');
  if (!Array.isArray(languages) || !languages.length || languages.length > 2 || languages.some(language => !LANGUAGE.test(language))) throw new Error('Invalid subtitle language.');
  if (!Number.isFinite(waitSeconds) || waitSeconds < 0 || waitSeconds > 60) throw new Error('Invalid caption preparation delay.');
  languages = [...new Set(languages)];
  const folder = await mkdtemp(join(tmpdir(), 'roam-bilingual-'));
  try {
    let plan = selections;
    if (!plan || languages.some(language => !plan[language])) {
      let meta;
      try { meta = await fetchCaptionMetadata(videoId, signal, { exec }); }
      catch (error) {
        if (error.name === 'AbortError' || signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (error.code === 'ENOENT') throw new Error('yt-dlp was not found. Check YT_DLP_PATH.');
        throw error.stderr || error.killed ? captionDownloadError(error) : error;
      }
      sourceLanguage ||= englishCaptionLanguage(meta);
      plan = Object.fromEntries(languages.map(language => [language, captionSelection(meta, language, sourceLanguage)]));
    }
    for (const language of languages) {
      const entry = plan[language];
      if (!LANGUAGE.test(entry?.downloadLanguage || '') || !entry.identity || ['lang', 'kind', 'name', 'tlang'].some(key => typeof entry.identity[key] !== 'string')) throw new Error('Invalid subtitle source selection.');
      if (expectedSourceTrack && (language === sourceLanguage || entry.identity.tlang)) {
        if (entry.identity.lang !== expectedSourceTrack.languageCode || entry.identity.kind !== (expectedSourceTrack.kind || '') || entry.identity.name !== (expectedSourceTrack.name || '')) throw Object.assign(new Error('The English subtitle source changed. Reopen this video to refresh it.'), { code: 'SOURCE_TRACK_UNAVAILABLE' });
      }
    }
    const downloadLanguages = [...new Set(languages.map(language => plan[language].downloadLanguage))];
    let failure, stdout = '';
    try {
      ({ stdout } = await exec(process.env.YT_DLP_PATH || 'yt-dlp', [
        '--ignore-config', '--no-playlist', '--skip-download', '--no-simulate', '--abort-on-error', '--no-warnings',
        '--print', '%(.{id,requested_subtitles})j', '--write-subs', '--write-auto-subs', '--sub-langs', `^(?:${downloadLanguages.join('|')})$`,
        '--sub-format', 'json3', '--socket-timeout', '15', '--retries', '0',
        ...(waitSeconds ? ['--sleep-subtitles', String(waitSeconds)] : []),
        '--output', join(folder, '%(id)s.%(ext)s'), '--', `https://www.youtube.com/watch?v=${videoId}`,
      ], { timeout: 75000 + waitSeconds * 1000 * languages.length, maxBuffer: 1024 * 1024, signal, windowsHide: true }));
    } catch (error) {
      if (error.name === 'AbortError' || signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (error.code === 'ENOENT') throw new Error('yt-dlp was not found. Check YT_DLP_PATH.');
      stdout = String(error.stdout || ''); failure = captionDownloadError(error);
    }
    signal?.throwIfAborted();
    let observed;
    try { observed = JSON.parse(stdout.trim()); } catch { /* Unverified source files cannot be cached or displayed. */ }
    const files = await readdir(folder), tracks = {};
    for (const language of languages) {
      const entry = plan[language], chosen = observed?.id === videoId && observed.requested_subtitles?.[entry.downloadLanguage];
      let identity;
      try { if (chosen?.ext === 'json3') identity = captionIdentity(chosen, videoId); } catch { /* Fail closed on unexpected URLs. */ }
      if (!identity || Object.keys(entry.identity).some(key => identity[key] !== entry.identity[key])) {
        failure ||= Object.assign(new Error('The downloaded captions do not match the selected English source.'), { code: 'SOURCE_TRACK_UNAVAILABLE' }); continue;
      }
      const file = files.find(name => name === `${videoId}.${entry.downloadLanguage}.json3`);
      if (!file) continue;
      const path = join(folder, file);
      if ((await stat(path)).size > MAX_SUBTITLE_BYTES) { failure ||= new Error('Captions exceed the 5 MB limit. Loading stopped.'); continue; }
      try { const cues = parseSubtitles(await readFile(path, 'utf8')); if (cues.length) tracks[language] = cues; }
      catch { failure ||= new Error('The selected captions have no valid timestamps.'); }
    }
    signal?.throwIfAborted();
    if (languages.some(language => !tracks[language])) failure ||= new Error('YouTube did not provide all requested caption tracks.');
    return { tracks, ...(failure ? { error: failure } : {}) };
  } finally { await rm(folder, { recursive: true, force: true }); }
}
export async function fetchCaptions(videoId, language = 'en', signal) {
  const result = await fetchCaptionTracks(videoId, [language], signal);
  if (result.tracks[language]) return result.tracks[language];
  throw result.error;
}
