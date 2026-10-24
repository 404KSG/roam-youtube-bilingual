import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { fetchCaptions } from './captions.mjs';
import { fetchVideoInfo } from './video-info.mjs';
import { createCaptionReader, createPeerVerifier, validRect } from './caption-reader.mjs';
import { VERSION, SERVICE_ID, API_VERSION } from '../src/protocol.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export function allowedOrigin(origin, port) {
  return !origin || new Set(['https://roamresearch.com', 'https://www.roamresearch.com', `http://127.0.0.1:${port}`, `http://localhost:${port}`]).has(origin);
}
async function readJSON(request) {
  if (!(request.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('请求必须为 application/json。'), { status: 415 });
  let length = 0; const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 65536) throw Object.assign(new Error('请求超过 64 KB。'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw Object.assign(new Error('JSON 格式无效。'), { status: 400 }); }
}
export function makeServer({ port = 17321, captionFetcher = fetchCaptions, infoFetcher = fetchVideoInfo, captionReader = createCaptionReader(), verifyPeer = createPeerVerifier() } = {}) {
  const infos = new Map(), captions = new Map();
  let fetching = false;
  const cache = (map, key, value) => { map.set(key, value); while (map.size > 20) map.delete(map.keys().next().value); return value; };
  const getInfo = async (id, signal) => infos.get(id) || cache(infos, id, await infoFetcher(id, signal));
  const server = createServer(async (req, res) => {
    const json = (status, data) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); } };
    const actualPort = server.address()?.port || port;
    if (![`127.0.0.1:${actualPort}`, `localhost:${actualPort}`].includes(req.headers.host)) return json(403, { error: '不允许的 Host。' });
    if (!allowedOrigin(req.headers.origin, actualPort)) return json(403, { error: '此网页不允许访问本机服务。' });
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
      catch { json(404, { error: '文件不存在，请先构建。' }); }
      return;
    }
    if (req.method === 'GET' && path === '/v1/youtube/health') return json(200, { ok: true, service: SERVICE_ID, apiVersion: API_VERSION, version: VERSION, provider: 'youtube-unified', platform: process.platform });
    if (req.method !== 'POST' || !['/v1/youtube/video-info', '/v1/youtube/captions', '/v1/youtube/caption-state'].includes(path)) return json(404, { error: '接口不存在。' });
    const controller = new AbortController();
    res.once('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const body = await readJSON(req);
      if (!/^[\w-]{11}$/.test(body?.videoId || '')) return json(400, { error: '无效的 YouTube 视频 ID。' });
      if (path === '/v1/youtube/caption-state') {
        if (Object.keys(body).some((key) => !['videoId', 'target', 'frame'].includes(key)) || !validRect(body.frame) || !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(body.target || '')) return json(400, { error: '字幕读取范围无效。' });
        await verifyPeer(req.socket, actualPort);
        controller.signal.throwIfAborted();
        // Reading the desktop requires an already-discovered, exact video title.
        const info = infos.get(body.videoId);
        if (!info) return json(409, { error: '请先加载当前视频的信息。' });
        if (!info.languages.some((language) => language.code === body.target)) return json(400, { error: '该视频未提供所选译文语言。' });
        const result = await captionReader.read({ title: info.title, frame: body.frame, target: body.target, signal: controller.signal });
        return json(200, { ...result, videoId: body.videoId, target: body.target });
      }
      if (fetching) return json(429, { error: '正在获取字幕信息，请稍后重试。' });
      fetching = true;
      try {
        const info = await getInfo(body.videoId, controller.signal);
        if (path === '/v1/youtube/video-info') return json(200, info);
        if (!info.sourceLanguage) return json(422, { error: '该视频没有可用的英文原字幕。' });
        const key = `${body.videoId}:${info.sourceLanguage}`;
        const cues = captions.get(key) || cache(captions, key, await captionFetcher(body.videoId, info.sourceLanguage, controller.signal));
        return json(200, { videoId: body.videoId, sourceLanguage: info.sourceLanguage, cues });
      } finally { fetching = false; }
    } catch (error) {
      if (error.name === 'AbortError') return;
      json(error.status || 422, { error: error.name === 'TimeoutError' ? '请求超时，请重试。' : error.message });
    }
  });
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
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT 必须在 1024–65535 之间。');
  const server = makeServer({ port });
  server.on('error', (error) => { console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。` : '字幕服务启动失败。'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Roam 双语字幕 ${VERSION}\nhttp://127.0.0.1:${port}\n仅使用 YouTube 自带翻译，不需要 API。\n本机只读桥仅提取当前 Roam YouTube 字幕；不截图、不保存 AX 树，不申请权限。\n按 Ctrl+C 停止。`));
}
