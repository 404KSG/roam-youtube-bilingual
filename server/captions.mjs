import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_SUBTITLE_BYTES, parseSubtitles } from '../src/core.mjs';

const execute = promisify(execFile);
export async function fetchCaptions(videoId, language = 'en', signal) {
  if (!/^[\w-]{11}$/.test(videoId || '')) throw new Error('无效的 YouTube 视频 ID。');
  if (!/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(language)) throw new Error('字幕语言须为 en、zh-Hans 等语言代码。');
  const folder = await mkdtemp(join(tmpdir(), 'roam-bilingual-'));
  try {
    await execute(process.env.YT_DLP_PATH || 'yt-dlp', [
      '--ignore-config', '--no-playlist', '--skip-download', '--no-warnings',
      '--write-subs', '--write-auto-subs', '--sub-langs', `^${language}$`,
      '--sub-format', 'json3', '--socket-timeout', '15', '--retries', '1',
      '--output', join(folder, '%(id)s.%(ext)s'), '--', `https://www.youtube.com/watch?v=${videoId}`,
    ], { timeout: 75000, maxBuffer: 1024 * 1024, signal, windowsHide: true });
    const file = (await readdir(folder)).find((f) => f.endsWith('.json3'));
    if (!file) throw new Error(`没有找到 ${language} 字幕。请检查视频字幕语言，或导入 SRT/VTT 文件。`);
    const path = join(folder, file);
    if ((await stat(path)).size > MAX_SUBTITLE_BYTES) throw new Error('字幕超过 5 MB，请分段导入。');
    return parseSubtitles(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    if (error.code === 'ENOENT') throw new Error('未找到 yt-dlp。可设置 YT_DLP_PATH，或直接导入字幕文件。');
    if (error.stderr || error.killed) throw new Error('YouTube 字幕获取失败（可能受限、限流或需更新 yt-dlp）。可重试或导入 SRT/VTT；本插件不绕过登录与付费限制。');
    throw error;
  } finally { await rm(folder, { recursive: true, force: true }); }
}
