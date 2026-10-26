import { mkdir, lstat, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MAX_SUBTITLE_BYTES, normalizeCues } from '../src/core.mjs';
import { isCaptionTrackKey } from './caption-key.mjs';

const VIDEO = /^[\w-]{11}$/;
// Runtime cache only: normalized captions, never cookies, tokens, or signed URLs.
export function createCaptionCache(directory, { now = Date.now, maxAgeMs = 86400000, maxEntries = 24 } = {}) {
  const pathFor = (videoId, language) => {
    if (!VIDEO.test(videoId) || !isCaptionTrackKey(language)) throw new Error('Invalid caption cache key.');
    return join(directory, `${videoId}.${language}.json`);
  };
  return {
    async get(videoId, language, signal, sourceKey = '') {
      const path = pathFor(videoId, language);
      try {
        signal?.throwIfAborted();
        const stat = await lstat(path);
        if (!stat.isFile() || stat.size > MAX_SUBTITLE_BYTES) return undefined;
        const data = JSON.parse(await readFile(path, { encoding: 'utf8', signal }));
        if (data.schema !== 2 || data.source !== 'youtube-same-source' || data.sourceKey !== sourceKey || data.videoId !== videoId || data.language !== language || !Number.isFinite(data.savedAt) || data.savedAt > now() + 60000 || now() - data.savedAt > maxAgeMs) return undefined;
        const cues = normalizeCues(data.cues);
        return cues.length ? cues : undefined;
      } catch (error) { if (signal?.aborted) throw error; return undefined; }
    },
    async put(videoId, language, input, signal, sourceKey = '') {
      const path = pathFor(videoId, language), temp = `${path}.${randomUUID()}.tmp`;
      try {
        signal?.throwIfAborted();
        const cues = normalizeCues(input);
        if (!cues.length || typeof sourceKey !== 'string' || sourceKey.length > 500) return false;
        const body = JSON.stringify({ schema: 2, source: 'youtube-same-source', sourceKey, videoId, language, savedAt: now(), cues });
        if (Buffer.byteLength(body) > MAX_SUBTITLE_BYTES) return false;
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(temp, body, { mode: 0o600, signal });
        signal?.throwIfAborted();
        await rename(temp, path);
        const files = (await readdir(directory)).filter(name => {
          const match = /^([\w-]{11})\.([a-zA-Z0-9_-]+)\.json$/.exec(name);
          return match && isCaptionTrackKey(match[2]);
        });
        if (files.length > maxEntries) {
          const entries = await Promise.all(files.map(async name => { const file = join(directory, name); try { return { file, mtime: (await lstat(file)).mtimeMs }; } catch { return null; } }));
          for (const entry of entries.filter(Boolean).sort((a, b) => b.mtime - a.mtime).slice(maxEntries)) await unlink(entry.file).catch(() => {});
        }
        return true;
      } catch (error) { if (signal?.aborted) throw error; return false; }
      finally { await unlink(temp).catch(() => {}); }
    },
  };
}
