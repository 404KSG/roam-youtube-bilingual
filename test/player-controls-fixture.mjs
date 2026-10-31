import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

// Explicit local-only layout server. It never runs the subtitle helper or CuaDriver.
const files = new Map([
  ['/test-controls-fixture', [new URL('./player-controls-fixture.html', import.meta.url), 'text/html']],
  ['/test/player-controls-browser.mjs', [new URL('./player-controls-browser.mjs', import.meta.url), 'text/javascript']],
  ['/test/subtitle-stability-browser.mjs', [new URL('./subtitle-stability-browser.mjs', import.meta.url), 'text/javascript']],
  ['/test/paused-position-browser.mjs', [new URL('./paused-position-browser.mjs', import.meta.url), 'text/javascript']],
  ['/src/surface.mjs', [new URL('../src/surface.mjs', import.meta.url), 'text/javascript']],
  ['/roam-youtube-bilingual.js', [new URL('../dist/roam-youtube-bilingual.js', import.meta.url), 'text/javascript']],
]);
const server = createServer(async (req, res) => {
  const asset = files.get(new URL(req.url, 'http://127.0.0.1').pathname);
  if (req.method !== 'GET' || !asset) { res.writeHead(404); res.end(); return; }
  try {
    const data = await readFile(asset[0]);
    res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8`, 'Cache-Control': 'no-store' }); res.end(data);
  } catch { res.writeHead(404); res.end('Build the extension before running this fixture.'); }
});
server.listen(Number(process.env.PORT || 0), '127.0.0.1', () => console.log(`Control-clearance fixture: http://127.0.0.1:${server.address().port}/test-controls-fixture`));
process.on('SIGTERM', () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
