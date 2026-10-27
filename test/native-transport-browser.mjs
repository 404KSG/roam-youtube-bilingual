import { CaptionSession } from '../src/caption-session.mjs';

// Run on the owned local transport fixture. The HTTP server supplies fixture
// captions; window.fetch and its streaming Response are real browser APIs.
export async function runNativeTransportAcceptance() {
  if (location.hostname !== '127.0.0.1' || location.pathname !== '/native-transport') throw new Error('Owned transport fixture required.');
  const nativeFetch = globalThis.fetch;
  if (!Function.prototype.toString.call(nativeFetch).includes('[native code]')) throw new Error('This test requires unmodified native fetch.');
  const events = [];
  const session = new CaptionSession({
    videoId: 'vif8NQcjVf0', target: 'zh-Hans', epoch: 1,
    signal: AbortSignal.timeout(5000), url: new URL('/stream', location.href).href,
    onEvent: event => events.push(event),
  });
  await session.start();
  if (globalThis.fetch !== nativeFetch) throw new Error('Native fetch was replaced.');
  if (events.find(event => event.type === 'source-ready')?.cues[0].text !== 'Native transport English') throw new Error('Missing source through native fetch.');
  if (events.find(event => event.type === 'target-ready')?.cues[0].text !== '原生传输中文') throw new Error('Missing target through native fetch.');
  if (events.at(-1)?.outcome !== 'bilingual') throw new Error('Incomplete real HTTP stream.');
  return { nativeFetchUnmodified: true, realHttpPost: true, sourceDelivered: true, targetDelivered: true, terminalValidated: true };
}
