import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { fetchCaptionTracks } from './captions.mjs';
import { createRequestPool } from './request-pool.mjs';
import { createCaptionCache } from './caption-cache.mjs';
import { createCaptionBundleCache } from './caption-bundle-cache.mjs';
import { createCaptionSession } from './caption-session.mjs';
import { isCaptionTrackKey } from './caption-key.mjs';
import { fetchVideoInfo } from './video-info.mjs';
import { createCaptionReader, createPeerVerifier, validRect } from './caption-reader.mjs';
import { VERSION, SERVICE_ID, API_VERSION } from '../src/protocol.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const MAX_SESSION_BYTES = 11 * 1024 * 1024;
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
export function makeServer({ port = 17321, captionFetcher, captionBatchFetcher = fetchCaptionTracks, infoFetcher = fetchVideoInfo, nativeCcReader = createCaptionReader(), verifyPeer = createPeerVerifier(), now = Date.now, cooldownMs = 60000, maxSessionBytes = MAX_SESSION_BYTES, captionCache, captionBundleCache } = {}) {
  const requests = createRequestPool({ now, cooldownMs });
  const getInfo = (id, signal, { fresh = false } = {}) => requests.request(`info:${id}`, sharedSignal => infoFetcher(id, sharedSignal), signal, { lane: 'fast', fresh });
  const cachedInfo = id => captionBundleCache?.findFreshInfo(id);
  // Original/uploaded captions remain fast. Auto-translated captions need a
  // wait AFTER extraction, not a retry delay that generates a fresh URL.
  // See yt-dlp/yt-dlp#13831, maintainer comment 3712613129.
  const readTracks = captionFetcher ? async (id, languages, signal, options = {}) => {
    const tracks = {};
    for (const language of languages) {
      try { tracks[language] = await captionFetcher(id, language, signal, options); }
      catch (error) { return { tracks, error }; }
    }
    return { tracks };
  } : captionBatchFetcher;
  const selectionFor = (info, language) => language === info.sourceLanguage ? info.sourceSelection : info.languages.find(item => item.code === language)?.selection;
  const sourceKeyFor = (info, language) => createHash('sha256').update(JSON.stringify([info.sourceLanguage, info.playerSourceLanguage, info.sourceTrack?.kind || '', info.sourceTrack?.name || '', info.sourceTrack?.vss_id || '', selectionFor(info, language)])).digest('hex');
  const importLegacy = async (info, target, signal) => {
    if (!captionCache || !captionBundleCache) return undefined;
    const source = await captionCache.readRecord(info.videoId, info.sourceLanguage, signal, sourceKeyFor(info, info.sourceLanguage));
    const translated = await captionCache.readRecord(info.videoId, target, signal, sourceKeyFor(info, target));
    if (!source?.cues || !translated?.cues) return undefined;
    const selected = selectionFor(info, target), type = target === info.sourceLanguage ? 'source' : info.languages.find(item => item.code === target)?.autoTranslated ? 'auto-translated' : 'uploaded';
    if (!selected) return undefined;
    try { const bundle = (await import('./caption-bundle-cache.mjs')).makeCaptionBundle({ videoId: info.videoId, target, info, source: { trackKey: info.sourceLanguage, playerTrack: JSON.stringify(info.sourceTrack), selection: info.sourceSelection, cues: source.cues }, targetTrack: { type, selection: selected, cues: translated.cues }, now }); bundle.createdAt = Math.min(source.savedAt, translated.savedAt); bundle.validatedAt = bundle.createdAt; bundle.lastAccessed = now(); return bundle; } catch { return undefined; }
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
      ['/test-preview-fixture', ['test/preview-fixture.html', 'text/html']],
      ['/test/unified-browser.mjs', ['test/unified-browser.mjs', 'text/javascript']],
    ]);
    if (req.method === 'GET' && assets.has(path)) {
      const [file, type] = assets.get(path);
      try { const data = await readFile(resolve(root, file)); res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' }); res.end(data); }
      catch { json(404, { error: 'File not found. Build the extension first.' }); }
      return;
    }
    if (req.method === 'GET' && path === '/v1/youtube/health') return json(200, { ok: true, service: SERVICE_ID, apiVersion: API_VERSION, version: VERSION, provider: 'youtube-unified', platform: process.platform });
    if (req.method !== 'POST' || !['/v1/youtube/video-info', '/v1/youtube/caption-session', '/v1/youtube/native-cc-state'].includes(path)) return json(404, { error: 'Endpoint not found.' });
    const controller = new AbortController();
    res.once('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const body = await readJSON(req);
      if (!/^[\w-]{11}$/.test(body?.videoId || '')) return json(400, { error: 'Invalid YouTube video ID.' });
      if (path === '/v1/youtube/native-cc-state') {
        if (Object.keys(body).some((key) => !['videoId', 'frame'].includes(key)) || !validRect(body.frame)) return json(400, { error: 'Invalid native caption scope.' });
        await verifyPeer(req.socket, actualPort);
        controller.signal.throwIfAborted();
        const info = await cachedInfo(body.videoId) || await getInfo(body.videoId, controller.signal);
        const result = await nativeCcReader.read({ title: info.title, frame: body.frame, signal: controller.signal });
        const state = ['on', 'off', 'unknown'].includes(result?.state) ? result.state : 'unknown';
        const reasons = new Set(['control', 'controls-hidden', 'native-caption-visible', 'player-not-visible', 'unrecognized-control', 'busy', 'window-not-visible']);
        return json(200, { videoId: body.videoId, state, checkedAt: Number.isFinite(result?.checkedAt) ? result.checkedAt : Date.now(), ...(reasons.has(result?.reason) ? { reason: result.reason } : {}) });
      }
      if (path === '/v1/youtube/caption-session' && !isCaptionTrackKey(body.target)) return json(400, { error: 'Invalid subtitle track identifier.' });
      if (path === '/v1/youtube/caption-session') {
        if (Object.keys(body).some(key => !['videoId', 'target'].includes(key))) return json(400, { error: 'Invalid caption session request.' });
        const stream = createCaptionSession({ videoId: body.videoId, target: body.target, signal: controller.signal, cache: captionBundleCache, requests, getInfo, loadTracks: readTracks, importLegacy, now });
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
        let bytes = 0;
        for await (const event of stream) {
          const line = JSON.stringify(event) + '\n'; bytes += Buffer.byteLength(line);
          if (bytes > maxSessionBytes) { controller.abort(); break; }
          if (!res.write(line)) await new Promise(resolve => { const done = () => { res.off('drain', done); res.off('close', done); resolve(); }; res.once('drain', done); res.once('close', done); });
          if (res.destroyed) break;
        }
        if (!res.destroyed) res.end(); return;
      }
      const info = await cachedInfo(body.videoId) || await getInfo(body.videoId, controller.signal);
      if (path === '/v1/youtube/video-info') return json(200, info);
      return json(404, { error: 'Endpoint not found.' });
    } catch (error) {
      if (error.name === 'AbortError') return;
      const codes = new Set(['YOUTUBE_RATE_LIMITED', 'YOUTUBE_DOWNLOAD_FAILED', 'YOUTUBE_METADATA_FAILED', 'SOURCE_TRACK_UNAVAILABLE', 'LOCAL_QUEUE_FULL']);
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
  const server = makeServer({ port, captionCache: createCaptionCache(resolve(root, '.cache', 'captions-v2')), captionBundleCache: createCaptionBundleCache(resolve(root, '.cache', 'captions-v3')) });
  server.on('error', (error) => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : 'The subtitle helper could not start.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Roam Bilingual Subtitles ${VERSION}\nhttp://127.0.0.1:${port}\nYouTube captions only. No AI API credentials required.\nThe read-only helper checks native CC state only. No caption-text extraction, screenshots, saved accessibility trees, or permission changes.\nPress Ctrl+C to stop.`));
}
