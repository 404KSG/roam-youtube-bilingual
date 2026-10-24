import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { fetchCaptions } from './captions.mjs';
import { createTranslator } from './translator.mjs';
import { parseSubtitles } from '../src/core.mjs';
import { VERSION, SERVICE_ID, API_VERSION } from '../src/protocol.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export function allowedOrigin(origin, port) {
  return !origin || new Set(['https://roamresearch.com', 'https://www.roamresearch.com', `http://127.0.0.1:${port}`, `http://localhost:${port}`]).has(origin);
}
function authorized(header, token) {
  const received = Buffer.from(header || '');
  const expected = Buffer.from(`Bearer ${token}`);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
async function readJSON(request) {
  if (!(request.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('请求必须为 application/json。'), { status: 415 });
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 65536) throw Object.assign(new Error('请求超过 64 KB。'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw Object.assign(new Error('JSON 格式无效。'), { status: 400 }); }
}

export function makeServer({ token, port = 17321, demo = false, captionFetcher = fetchCaptions, translator = createTranslator({ baseUrl: process.env.OPENAI_BASE_URL, apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL }) } = {}) {
  if (!token || token.length < 16) throw new Error('BRIDGE_TOKEN 至少需要 16 个字符。');
  const captionCache = new Map();
  let fetching = false;
  const server = createServer(async (req, res) => {
    const json = (status, body) => {
      if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
    };
    const host = req.headers.host;
    const actualPort = server.address()?.port || port;
    if (![`127.0.0.1:${actualPort}`, `localhost:${actualPort}`].includes(host)) return json(403, { error: '不允许的 Host。' });
    const origin = req.headers.origin;
    if (!allowedOrigin(origin, actualPort)) return json(403, { error: '此网页不允许访问本机服务。' });
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' });
      return res.end();
    }
    const url = new URL(req.url, `http://127.0.0.1:${actualPort}`);
    const assets = new Map([
      ['/', ['demo/index.html', 'text/html']], ['/demo', ['demo/index.html', 'text/html']],
      ['/demo/sample.vtt', ['demo/sample.vtt', 'text/vtt']],
      ['/roam-layout', ['demo/roam-layout.html', 'text/html']],
      ['/extension.js', ['extension.js', 'text/javascript']],
      ['/roam-youtube-bilingual.js', ['dist/roam-youtube-bilingual.js', 'text/javascript']],
    ]);
    if (req.method === 'GET' && assets.has(url.pathname)) {
      const [path, mime] = assets.get(url.pathname);
      try {
        const content = await readFile(resolve(root, path));
        res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'Cache-Control': 'no-store' }); res.end(content);
      } catch { json(404, { error: '文件不存在，请先运行 npm run build。' }); }
      return;
    }
    if (!authorized(req.headers.authorization, token)) return json(401, { error: '本机服务配对码不正确。请从服务终端复制配对码。' });
    const controller = new AbortController();
    res.once('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      if (req.method === 'GET' && url.pathname === '/health') return json(200, { ok: true, service: SERVICE_ID, apiVersion: API_VERSION, version: VERSION, demo, apiConfigured: Boolean(process.env.OPENAI_MODEL), provider: 'OpenAI-compatible Chat Completions' });
      if (req.method === 'POST' && url.pathname === '/v1/captions') {
        const body = await readJSON(req);
        if (!/^[\w-]{11}$/.test(body?.videoId || '') || !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(body?.language || 'en')) return json(400, { error: '视频 ID 或字幕语言无效。' });
        const key = `${body.videoId}:${body.language || 'en'}`;
        let cues = captionCache.get(key);
        if (!cues) {
          if (fetching) return json(429, { error: '正在获取另一条视频的字幕，请稍后重试。' });
          fetching = true;
          try {
            cues = demo ? parseSubtitles(await readFile(resolve(root, 'demo/sample.vtt'), 'utf8')) : await captionFetcher(body.videoId, body.language || 'en', controller.signal);
            captionCache.set(key, cues);
            while (captionCache.size > 20) captionCache.delete(captionCache.keys().next().value);
          } finally { fetching = false; }
        }
        return json(200, { cues, source: demo ? 'demo-fixture' : 'youtube', demo, videoId: body.videoId, language: body.language || 'en' });
      }
      if (req.method === 'POST' && url.pathname === '/v1/translate') {
        const body = await readJSON(req);
        if (demo) {
          const { validateRequest } = await import('./translator.mjs');
          validateRequest(body);
          const captions = parseSubtitles(await readFile(resolve(root, 'demo/sample.vtt'), 'utf8'));
          const translations = ['好用的工具，应该帮助你专注于想法本身。', '你可以同时观看原文与译文。', '点击字幕，就能回到视频中的那个时刻。', '你的 API 密钥保存在自己的电脑上。', '这些是演示字幕，并非演示视频的真实转录。'];
          return json(200, { translations: body.entries.map((entry) => ({ id: entry.id, text: translations[captions.findIndex((c) => c.text === entry.text)] || '【演示模式：此句未调用翻译 API】' })), demo: true, target: body.target });
        }
        return json(200, { translations: await translator.translate(body, controller.signal), demo: false, target: body.target });
      }
      return json(404, { error: '接口不存在。' });
    } catch (error) {
      if (error.name === 'AbortError') return;
      // Never forward provider bodies, headers, stderr or key values to a graph.
      const message = error.name === 'TimeoutError' ? '请求超时，请重试。' : error.message === 'fetch failed' ? '无法连接翻译 API，请检查地址和网络。' : error.message;
      return json(error.status || 422, { error: message });
    }
  });
  server.requestTimeout = 90000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT || 17321);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT 必须在 1024–65535 之间。');
  const demo = process.argv.includes('--demo');
  const token = process.env.BRIDGE_TOKEN || randomBytes(24).toString('base64url');
  const server = makeServer({ token, port, demo });
  server.on('error', (error) => { console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请更换 PORT。` : error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Roam 双语字幕 ${VERSION} ${demo ? '【演示：预置字幕与译文，无 API 调用】' : '本机服务'}\n地址：http://127.0.0.1:${port}\n配对码：${token}\nAPI Key 仅从本机环境配置读取，不发送到 Roam。按 Ctrl+C 停止。`);
  });
}
