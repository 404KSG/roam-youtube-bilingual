import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_SUBTITLE_BYTES, parseSubtitles } from '../src/core.mjs';

const execute = promisify(execFile);
export function captionDownloadError(error) {
  if (/HTTP[^\n]{0,30}429|Too Many Requests/i.test(String(error.stderr || error.message || ''))) {
    return Object.assign(new Error('YouTube 限流（429），暂时无法获取所选字幕。未开启双语显示，请稍后再试；不会改用重复字幕遮罩。'), { status: 429, code: 'YOUTUBE_RATE_LIMITED' });
  }
  return new Error('YouTube 字幕获取失败，双语显示未开启；不会改用重复字幕遮罩。');
}
export async function fetchCaptions(videoId, language = 'en', signal) {
  if (!/^[\w-]{11}$/.test(videoId || '')) throw new Error('无效的 YouTube 视频 ID。');
  if (!/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(language)) throw new Error('字幕语言须为 en、zh-Hans 等语言代码。');
  const folder = await mkdtemp(join(tmpdir(), 'roam-bilingual-'));
  try {
    await execute(process.env.YT_DLP_PATH || 'yt-dlp', [
      '--ignore-config', '--no-playlist', '--skip-download', '--no-warnings',
      '--write-subs', '--write-auto-subs', '--sub-langs', `^${language}$`,
      '--sub-format', 'json3', '--socket-timeout', '15', '--retries', '0',
      '--output', join(folder, '%(id)s.%(ext)s'), '--', `https://www.youtube.com/watch?v=${videoId}`,
    ], { timeout: 75000, maxBuffer: 1024 * 1024, signal, windowsHide: true });
    const file = (await readdir(folder)).find((f) => f.endsWith('.json3'));
    if (!file) throw new Error(`YouTube 暂未提供可下载的 ${language} 字幕。`);
    const path = join(folder, file);
    if ((await stat(path)).size > MAX_SUBTITLE_BYTES) throw new Error('字幕超过 5 MB，已停止加载。');
    return parseSubtitles(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    if (error.code === 'ENOENT') throw new Error('未找到已安装的 yt-dlp，请检查 YT_DLP_PATH。');
    if (error.stderr || error.killed) throw captionDownloadError(error);
    throw error;
  } finally { await rm(folder, { recursive: true, force: true }); }
}
