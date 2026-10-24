import test from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeClock } from '../src/clock.mjs';

test('iframe clock rejects spoofed messages, syncs playback, seeks, and restores modified source on teardown', () => {
  const previous = { window: globalThis.window, location: globalThis.location };
  globalThis.window = new EventTarget();
  globalThis.location = { origin: 'https://roamresearch.com' };
  const iframe = new EventTarget();
  const original = 'https://www.youtube.com/embed/M7lc1UVf-VE';
  iframe.src = original;
  iframe.getAttribute = () => iframe.src;
  iframe.setAttribute = (_key, value) => { iframe.src = value; };
  const sent = [];
  iframe.contentWindow = { postMessage: (data, origin) => sent.push({ data: JSON.parse(data), origin }) };
  const observed = [];
  const videos = [];
  let clock;
  const deliver = (data, source = iframe.contentWindow, origin = 'https://www.youtube.com') => {
    const event = new Event('message');
    Object.defineProperties(event, { data: { value: data }, source: { value: source }, origin: { value: origin } });
    window.dispatchEvent(event);
  };
  try {
    clock = new YouTubeClock(iframe, (time) => observed.push(time), () => {}, (id) => videos.push(id));
    assert.equal(new URL(iframe.src).searchParams.get('enablejsapi'), '1');
    deliver({ event: 'infoDelivery', info: { currentTime: 999 } }, {}, 'https://www.youtube.com');
    deliver({ event: 'infoDelivery', info: { currentTime: 999 } }, iframe.contentWindow, 'https://evil.example');
    assert.equal(observed.length, 0);
    deliver(JSON.stringify({ event: 'infoDelivery', info: { currentTime: 12, playerState: 2 } }));
    assert.equal(clock.currentTime(), 12);
    assert.equal(clock.ready, true);
    deliver({ event: 'infoDelivery', info: { videoData: { video_id: 'dQw4w9WgXcQ' } } });
    assert.deepEqual(videos, ['dQw4w9WgXcQ']);
    assert.equal(clock.isSynchronized(), false);
    deliver({ event: 'infoDelivery', info: { currentTime: 0, playerState: 2 } });
    clock.seek(60);
    assert.deepEqual(sent.at(-2).data, { event: 'command', func: 'seekTo', args: [60, true] });
    assert.equal(sent.at(-1).origin, 'https://www.youtube.com');
    clock.destroy(); clock = null;
    assert.equal(iframe.src, original);
    const before = observed.length;
    deliver({ event: 'infoDelivery', info: { currentTime: 77 } });
    assert.equal(observed.length, before);
  } finally {
    clock?.destroy();
    for (const key of ['window', 'location']) if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key];
  }
});
