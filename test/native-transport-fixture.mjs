import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

// Explicit, isolated test server. No helper, graph, native accessibility, or
// YouTube network calls. Source modules are served from a fixed allowlist.
const files = new Map([
  ['/test/native-transport-browser.mjs', new URL('./native-transport-browser.mjs', import.meta.url)],
  ['/src/caption-session.mjs', new URL('../src/caption-session.mjs', import.meta.url)],
  ['/src/core.mjs', new URL('../src/core.mjs', import.meta.url)],
]);
const server = createServer(async (req, res) => {
  if (req.url === '/native-transport' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    res.end('<!doctype html><title>Owned native-fetch transport fixture</title><p>Local fixture captions, real browser fetch.</p><script type="module">import {runNativeTransportAcceptance} from "/test/native-transport-browser.mjs"; window.runNativeTransportAcceptance=runNativeTransportAcceptance;</script>');
  } else if (req.method === 'GET' && files.has(req.url)) {
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
    res.end(await readFile(files.get(req.url)));
  } else if (req.method === 'POST' && req.url === '/stream') {
    let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 1000) { res.writeHead(413); res.end(); return; } }
    let body; try { body = JSON.parse(raw); } catch { res.writeHead(400); res.end(); return; }
    if (body.videoId !== 'vif8NQcjVf0' || body.target !== 'zh-Hans') { res.writeHead(400); res.end(); return; }
    const base = { videoId: body.videoId, target: body.target, captionPolicy: 'same-source-v1' }, sourceFingerprint = 'a'.repeat(64);
    const events = [
      { ...base, sequence: 1, type: 'info', cacheDisposition: 'miss', info: { videoId: body.videoId, title: 'Native transport fixture', sourceLanguage: 'en', languages: [{ code: body.target }] } },
      { ...base, sequence: 2, type: 'source-ready', language: 'en', sourceFingerprint, cues: [{ start: 0, end: 2, text: 'Native transport English' }] },
      { ...base, sequence: 3, type: 'target-ready', language: body.target, sourceFingerprint, targetType: 'auto-translated', pairId: 'b'.repeat(64), cues: [{ start: 0, end: 2, text: '原生传输中文' }] },
      { ...base, sequence: 4, type: 'complete', outcome: 'bilingual' },
    ];
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
    res.write(events.slice(0, 2).map(JSON.stringify).join('\n') + '\n');
    setTimeout(() => { if (!res.destroyed) res.end(events.slice(2).map(JSON.stringify).join('\n') + '\n'); }, 25);
  } else { res.writeHead(404); res.end(); }
});
server.listen(Number(process.env.PORT || 17324), '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port, pid: process.pid })));
process.on('SIGTERM', () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
