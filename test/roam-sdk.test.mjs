import test from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeClock } from '../src/clock.mjs';

test('existing Roam YT.Player keeps its message channel id', () => {
  const oldWindow = globalThis.window, oldLocation = globalThis.location;
  const iframe = new EventTarget(); iframe.id = 'roam-player'; iframe.src = 'https://www.youtube.com/embed/vif8NQcjVf0?enablejsapi=1'; iframe.getAttribute = () => iframe.src;
  const sent = []; iframe.contentWindow = { postMessage: (message) => sent.push(JSON.parse(message)) };
  globalThis.window = new EventTarget(); window.YT = { get: (id) => id === iframe.id ? { id: 1, getIframe: () => iframe, getCurrentTime: () => 321, getPlayerState: () => 2, getPlaybackRate: () => 1 } : null }; globalThis.location = { origin: 'https://roamresearch.com' };
  let clock;
  try {
    clock = new YouTubeClock(iframe, () => {});
    assert.equal(clock.channelId, 1);
    assert.equal(sent[0].event, 'listening'); assert.equal(sent[0].id, 1);
    clock.readSdk(); assert.equal(clock.currentTime(), 321); assert.equal(clock.isSynchronized(), true);
    clock.time = 12; clock.hasTime = true; clock.ready = true;
    clock.setNativeTranslation('en', 'ja', { sourceTrack: { kind: '', name: '', vss_id: '.en', languageName: 'English' }, targetName: 'Japanese' });
    const selection = sent.find((message) => message.func === 'setOption');
    assert.deepEqual(selection.args[2], { languageCode: 'en', languageName: 'English', kind: '', name: '', vss_id: '.en', translationLanguage: { languageCode: 'ja', languageName: 'Japanese' } });
  } finally {
    clock?.destroy();
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldLocation === undefined) delete globalThis.location; else globalThis.location = oldLocation;
  }
});
