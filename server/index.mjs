import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { fetchCaptionTracks } from './captions.mjs';
import { createRequestPool } from './request-pool.mjs';
import { createCaptionCache } from './caption-cache.mjs';
import { fetchVideoInfo } from './video-info.mjs';
import { createCaptionReader, createPeerVerifier, validRect } from './caption-reader.mjs';
import { VERSION, SERVICE_ID, API_VERSION } from '../src/protocol.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export function allowedOrigin(origin, port) {
  return !origin || new Set(['https://roamresearch.com', 'https://www.roamresearch.com', `http://127.0.0.1:${port}`, `http://localhost:${port}`]).has(origin);
}
async function readJSON(request) {
  if (!(request.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('Content-Type must be application/json.'), { status: 415 });
  let length = 0; const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 65536) throw Object.assign(new Error('The request exceeds the 64 KB limit.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}
export function makeServer({ port = 17321, captionFetcher, captionBatchFetcher = fetchCaptionTracks, infoFetcher = fetchVideoInfo, nativeCcReader = createCaptionReader(), verifyPeer = createPeerVerifier(), now = Date.now, cooldownMs = 60000, captionCache } = {}) {
  const requests = createRequestPool({ now, cooldownMs });
  const getInfo = (id, signal) => requests.request(`info:${id}`, sharedSignal => infoFetcher(id, sharedSignal), signal);
  const trackKey = (id, language) => `caption:${id}:${language}`;
  // Original/uploaded captions remain fast. Auto-translated captions need a
  // wait AFTER extraction, not a retry delay that generates a fresh URL.
  // See yt-dlp/yt-dlp#13831, maintainer comment 3712613129.
  const readTracks = captionFetcher ? async (id, languages, signal) => {
    const tracks = {};
    for (const language of languages) {
      try { tracks[language] = await captionFetcher(id, language, signal); }
      catch (error) { return { tracks, error }; }
    }
    return { tracks };
  } : captionBatchFetcher;
  const getCaptions = async (info, target, signal) => {
    const wanted = [...new Set([info.sourceLanguage, target])];
    for (const language of wanted) {
      if (requests.peek(trackKey(info.videoId, language)) !== undefined) continue;
      const saved = await captionCache?.get(info.videoId, language, signal);
      signal?.throwIfAborted();
      if (saved?.length) requests.prime(trackKey(info.videoId, language), saved);
    }
    return requests.request(trackKey(info.videoId, target), async sharedSignal => {
      const missing = wanted.filter(language => requests.peek(trackKey(info.videoId, language)) === undefined);
      const needsPreparation = language => language !== info.sourceLanguage && info.languages.some(item => item.code === language && item.autoTranslated === true);
      for (const [languages, waitSeconds] of [[missing.filter(language => !needsPreparation(language)), 0], [missing.filter(needsPreparation), 60]]) {
        if (!languages.length) continue;
        const result = await readTracks(info.videoId, languages, sharedSignal, { waitSeconds });
        sharedSignal.throwIfAborted();
        for (const language of languages) {
          const cues = result.tracks?.[language];
          if (Array.isArray(cues) && cues.length) {
            requests.prime(trackKey(info.videoId, language), cues);
            await captionCache?.put(info.videoId, language, cues, sharedSignal);
          }
        }
        if (languages.some(language => requests.peek(trackKey(info.videoId, language)) === undefined)) throw result.error || new Error('YouTube did not provide all requested caption tracks.');
      }
      return requests.peek(trackKey(info.videoId, target));
    }, signal);
  };
  const server = createServer(async (req, res) => {
    const json = (status, data) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); } };
    const actualPort = server.address()?.port || port;
    if (![`127.0.0.1:${actualPort}`, `localhost:${actualPort}`].includes(req.headers.host)) return json(403, { error: 'Host not allowed.' });
    if (!allowedOrigin(req.headers.origin, actualPort)) return json(403, { error: 'This origin cannot access the local helper.' });
    if (req.headers.origin) res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Vary', 'Origin'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' }); res.end(); return; }
    const path = new URL(req.url, `http://127.0.0.1:${actualPort}`).pathname;
    const assets = new Map([
      ['/', ['demo/roam-layout.html', 'text/html']], ['/demo', ['demo/roam-layout.html', 'text/html']], ['/roam-layout', ['demo/roam-layout.html', 'text/html']],
      ['/extension.js', ['extension.js', 'text/javascript']], ['/roam-youtube-bilingual.js', ['dist/roam-youtube-bilingual.js', 'text/javascript']],
      ['/test-fixture', ['test/unified-fixture.html', 'text/html']],
    ]);
    if (req.method === 'GET' && assets.has(path)) {
      const [file, type] = assets.get(path);
      try { const data = await readFile(resolve(root, file)); res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' }); res.end(data); }
      catch { json(404, { error: 'File not found. Build the extension first.' }); }
      return;
    }
    if (req.method === 'GET' && path === '/v1/youtube/health') return json(200, { ok: true, service: SERVICE_ID, apiVersion: API_VERSION, version: VERSION, provider: 'youtube-unified', platform: process.platform });
    if (req.method !== 'POST' || !['/v1/youtube/video-info', '/v1/youtube/captions', '/v1/youtube/native-cc-state'].includes(path)) return json(404, { error: 'Endpoint not found.' });
    const controller = new AbortController();
    res.once('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const body = await readJSON(req);
      if (!/^[\w-]{11}$/.test(body?.videoId || '')) return json(400, { error: 'Invalid YouTube video ID.' });
      if (path === '/v1/youtube/native-cc-state') {
        if (Object.keys(body).some((key) => !['videoId', 'frame'].includes(key)) || !validRect(body.frame)) return json(400, { error: 'Invalid native caption scope.' });
        await verifyPeer(req.socket, actualPort);
        controller.signal.throwIfAborted();
        const info = await getInfo(body.videoId, controller.signal);
        const result = await nativeCcReader.read({ title: info.title, frame: body.frame, signal: controller.signal });
        const state = ['on', 'off', 'unknown'].includes(result?.state) ? result.state : 'unknown';
        const reasons = new Set(['control', 'controls-hidden', 'native-caption-visible', 'player-not-visible', 'unrecognized-control', 'busy', 'window-not-visible']);
        return json(200, { videoId: body.videoId, state, checkedAt: Number.isFinite(result?.checkedAt) ? result.checkedAt : Date.now(), ...(reasons.has(result?.reason) ? { reason: result.reason } : {}) });
      }
      if (path === '/v1/youtube/captions' && !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(body.target || '')) return json(400, { error: 'Invalid subtitle language.' });
      const info = await getInfo(body.videoId, controller.signal);
      if (path === '/v1/youtube/video-info') return json(200, info);
      if (!info.sourceLanguage) return json(422, { error: 'This video has no available English captions.' });
      const target = body.target;
      if (target !== info.sourceLanguage && !info.languages.some((language) => language.code === target)) return json(400, { error: 'This video does not provide the requested caption language.' });
      const cues = await getCaptions(info, target, controller.signal);
      return json(200, { videoId: body.videoId, language: target, cues });
    } catch (error) {
      if (error.name === 'AbortError') return;
      const codes = new Set(['YOUTUBE_RATE_LIMITED', 'YOUTUBE_DOWNLOAD_FAILED', 'YOUTUBE_METADATA_FAILED', 'LOCAL_QUEUE_FULL']);
      const code = codes.has(error.code) ? error.code : error.name === 'TimeoutError' ? 'REQUEST_TIMEOUT' : 'SUBTITLE_REQUEST_FAILED';
      const retryAfterSeconds = code === 'YOUTUBE_RATE_LIMITED' && Number.isFinite(error.retryAfterSeconds) ? Math.max(1, Math.min(3600, Math.ceil(error.retryAfterSeconds))) : undefined;
      if (retryAfterSeconds) res.setHeader('Retry-After', String(retryAfterSeconds));
      json(error.status || (code === 'REQUEST_TIMEOUT' ? 504 : 422), { error: code === 'REQUEST_TIMEOUT' ? 'The request timed out. Try again later.' : error.message, code, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) });
    }
  });
  server.once('close', () => requests.close());
  server.requestTimeout = 90000; server.headersTimeout = 10000;
  return server;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const envPath = resolve(root, '.env');
  if (existsSync(envPath)) {
    const values = parseEnv(await readFile(envPath, 'utf8'));
    for (const key of ['PORT', 'YT_DLP_PATH', 'CUA_DRIVER_PATH']) if (process.env[key] === undefined && values[key]) process.env[key] = values[key];
  }
  const port = Number(process.env.PORT || 17321);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be between 1024 and 65535.');
  const server = makeServer({ port, captionCache: createCaptionCache(resolve(root, '.cache', 'captions')) });
  server.on('error', (error) => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : 'The subtitle helper could not start.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Roam Bilingual Subtitles ${VERSION}\nhttp://127.0.0.1:${port}\nYouTube captions only. No AI API credentials required.\nThe read-only helper checks native CC state only. No caption-text extraction, screenshots, saved accessibility trees, or permission changes.\nPress Ctrl+C to stop.`));
}
