import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const LANGUAGE = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/;

export function sanitizeVideoInfo(meta, videoId) {
  if (meta?.id !== videoId || typeof meta.title !== 'string' || !meta.title.trim()) throw new Error('YouTube 视频信息不完整。');
  const manual = meta.subtitles || {}, automatic = meta.automatic_captions || {};
  const manualEnglish = Object.keys(manual).filter((key) => /^en(?:-|$)/.test(key)).sort((a, b) => Number(b === 'en') - Number(a === 'en'));
  const originalEnglish = Object.keys(automatic).filter((key) => /^en(?:-|$)/.test(key) && (automatic[key] || []).some((track) => {
    try { const url = new URL(track.url); return /^en(?:-|$)/.test(url.searchParams.get('lang') || '') && !url.searchParams.has('tlang'); } catch { return false; }
  })).sort((a, b) => Number(b === 'en-orig') - Number(a === 'en-orig'));
  const sourceLanguage = manualEnglish[0] || originalEnglish[0] || null;
  const languages = new Map();
  for (const [code, tracks] of Object.entries({ ...automatic, ...manual })) {
    if (!LANGUAGE.test(code) || code.endsWith('-orig') || !Array.isArray(tracks) || !tracks.length) continue;
    const name = tracks.find((track) => typeof track.name === 'string')?.name || code;
    languages.set(code, { code, name: name.slice(0, 100) });
  }
  let playerSourceLanguage = sourceLanguage?.replace(/-orig$/, '') || 'en';
  let kind = '', name = '', vssId;
  const sourceTracks = manual[sourceLanguage] || automatic[sourceLanguage] || [];
  const selected = sourceTracks.find((track) => track.ext === 'json3') || sourceTracks[0];
  try {
    const url = new URL(selected?.url);
    const language = url.searchParams.get('lang');
    if (LANGUAGE.test(language || '')) playerSourceLanguage = language;
    kind = url.searchParams.get('kind') === 'asr' ? 'asr' : '';
    name = url.searchParams.get('name') || '';
    vssId = url.searchParams.get('vss_id') || undefined;
  } catch { /* A source without a URL will fail at caption fetch rather than expose raw metadata. */ }
  const sourceTrack = { languageCode: playerSourceLanguage, languageName: 'English', kind, name: name.slice(0, 200),
    ...(vssId ? { vss_id: vssId.slice(0, 200) } : !name ? { vss_id: `${kind === 'asr' ? 'a.' : '.'}${playerSourceLanguage}` } : {}) };
  return { videoId, title: meta.title.trim().slice(0, 1000), sourceLanguage, playerSourceLanguage, sourceTrack, languages: [...languages.values()] };
}

export async function fetchVideoInfo(videoId, signal) {
  if (!/^[\w-]{11}$/.test(videoId || '')) throw new Error('无效的 YouTube 视频 ID。');
  try {
    const { stdout } = await execute(process.env.YT_DLP_PATH || 'yt-dlp', [
      '--ignore-config', '--no-playlist', '--skip-download', '--no-warnings', '--socket-timeout', '15', '--retries', '0',
      '--print', '%(.{id,title,subtitles,automatic_captions})j', '--', `https://www.youtube.com/watch?v=${videoId}`,
    ], { timeout: 60000, maxBuffer: 8 * 1024 * 1024, signal, windowsHide: true });
    let data;
    try { data = JSON.parse(stdout); } catch { throw new Error('YouTube 视频信息格式无效。'); }
    return sanitizeVideoInfo(data, videoId);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    if (error.code === 'ENOENT') throw new Error('未找到 yt-dlp，请先准备本机字幕服务。');
    if (error.stderr || error.killed) throw new Error('无法获取 YouTube 支持的语言列表，请稍后重试。');
    throw error;
  }
}
