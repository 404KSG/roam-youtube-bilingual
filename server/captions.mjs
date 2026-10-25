import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_SUBTITLE_BYTES, parseSubtitles } from '../src/core.mjs';

const execute = promisify(execFile);
const LANGUAGE = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/;
export function captionDownloadError(error) {
  if (/HTTP[^\n]{0,30}429|Too Many Requests/i.test(String(error.stderr || error.message || ''))) {
    return Object.assign(new Error('YouTube 限流（429），暂时无法获取所选字幕。未开启双语显示，请稍后再试；不会改用重复字幕遮罩。'), { status: 429, code: 'YOUTUBE_RATE_LIMITED' });
  }
  return Object.assign(new Error('YouTube 字幕获取失败，双语显示未开启；不会改用重复字幕遮罩。'), { code: 'YOUTUBE_DOWNLOAD_FAILED' });
}

// One metadata extraction for up to two missing tracks. Preserve a successfully
// downloaded track if the other fails; never substitute it for the missing one.
export async function fetchCaptionTracks(videoId, languages, signal, { exec = execute } = {}) {
  if (!/^[\w-]{11}$/.test(videoId || '')) throw new Error('无效的 YouTube 视频 ID。');
  if (!Array.isArray(languages) || !languages.length || languages.length > 2 || languages.some(language => !LANGUAGE.test(language))) throw new Error('字幕语言无效。');
  languages = [...new Set(languages)];
  const folder = await mkdtemp(join(tmpdir(), 'roam-bilingual-'));
  try {
    let failure;
    try {
      await exec(process.env.YT_DLP_PATH || 'yt-dlp', [
        '--ignore-config', '--no-playlist', '--skip-download', '--no-warnings',
        '--write-subs', '--write-auto-subs', '--sub-langs', `^(?:${languages.join('|')})$`,
        '--sub-format', 'json3', '--socket-timeout', '15', '--retries', '0',
        '--output', join(folder, '%(id)s.%(ext)s'), '--', `https://www.youtube.com/watch?v=${videoId}`,
      ], { timeout: 75000, maxBuffer: 1024 * 1024, signal, windowsHide: true });
    } catch (error) {
      if (error.name === 'AbortError' || signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (error.code === 'ENOENT') throw new Error('未找到已安装的 yt-dlp，请检查 YT_DLP_PATH。');
      failure = captionDownloadError(error);
    }
    signal?.throwIfAborted();
    const files = await readdir(folder), tracks = {};
    for (const language of languages) {
      const file = files.find(name => name === `${videoId}.${language}.json3`);
      if (!file) continue;
      const path = join(folder, file);
      if ((await stat(path)).size > MAX_SUBTITLE_BYTES) { failure ||= new Error('字幕超过 5 MB，已停止加载。'); continue; }
      try {
        const cues = parseSubtitles(await readFile(path, 'utf8'));
        if (cues.length) tracks[language] = cues;
      } catch { failure ||= new Error('所选字幕没有有效时间轴。'); }
    }
    signal?.throwIfAborted();
    if (languages.some(language => !tracks[language])) failure ||= new Error('YouTube 暂未提供完整的所选字幕轨道。');
    return { tracks, ...(failure ? { error: failure } : {}) };
  } finally { await rm(folder, { recursive: true, force: true }); }
}

export async function fetchCaptions(videoId, language = 'en', signal) {
  const result = await fetchCaptionTracks(videoId, [language], signal);
  if (result.tracks[language]) return result.tracks[language];
  throw result.error;
}
