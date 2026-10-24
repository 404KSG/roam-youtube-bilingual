import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { makeServer } from '../server/index.mjs';
import { createTranslator } from '../server/translator.mjs';

test('real HTTP bridge calls an OpenAI-compatible provider without exposing its key to the client', async (t) => {
  let received;
  const provider = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received = { url: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '{"translations":[{"id":42,"text":"一起观看原文与译文。"}]}' } }] }));
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const translator = createTranslator({ baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: 'mock-provider-private-key', model: 'mock-only' });
  const bridge = makeServer({ token: 'mock-pairing-code-123', translator });
  await new Promise((resolve) => bridge.listen(0, '127.0.0.1', resolve));
  t.after(() => Promise.all([bridge, provider].map((server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }))));
  const response = await fetch(`http://127.0.0.1:${bridge.address().port}/v1/translate`, {
    method: 'POST', headers: { Authorization: 'Bearer mock-pairing-code-123', 'Content-Type': 'application/json', Origin: 'https://roamresearch.com' },
    body: JSON.stringify({ target: 'zh-CN', entries: [{ id: 42, text: 'Watch the original and the translation together.' }] }),
  });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text).translations, [{ id: 42, text: '一起观看原文与译文。' }]);
  assert.equal(text.includes('mock-provider-private-key'), false);
  assert.equal(received.auth, 'Bearer mock-provider-private-key');
  assert.equal(received.url, '/v1/chat/completions');
  assert.equal(received.body.model, 'mock-only');
});
