import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCues, parseJSON3, parseSubtitles } from '../src/core.mjs';
import { YouTubeClock } from '../src/clock.mjs';

test('normalization is idempotent and preserves literal angle brackets across the bridge', () => {
  const cues = parseSubtitles('WEBVTT\n\n00:00.000 --> 00:05.000\nUse &lt;T&gt; &amp; x &lt; y.');
  assert.equal(cues[0].text, 'Use <T> & x < y.');
  assert.deepEqual(normalizeCues(cues), cues);
  assert.equal(parseJSON3({ events: [{ tStartMs: 0, dDurationMs: 5000, segs: [{ utf8: 'Use <T> literally.' }] }] })[0].text, 'Use <T> literally.');
});
test('simultaneous source cues are retained instead of silently discarding one speaker', () => {
  const cues = normalizeCues([{ start: 0, end: 3, text: 'Speaker A' }, { start: 0, end: 3, text: 'Speaker B' }]);
  assert.equal(cues[0].text, 'Speaker A\nSpeaker B');
});
test('invalid time fields and malformed JSON3 entries fail safely', () => {
  assert.throws(() => parseSubtitles('WEBVTT\n\n00:67.000 --> 01:10.000\nBad'), /时间轴/);
  assert.deepEqual(parseJSON3({ events: [null, {}, { tStartMs: 0, dDurationMs: 1000, segs: [null, { utf8: 'Valid' }] }] }), [{ id: 0, start: 0, end: 1, text: 'Valid' }]);
});

function withClock(callback, options = {}) {
  const originalGlobals = { window: globalThis.window, location: globalThis.location };
  globalThis.window = new EventTarget();
  globalThis.location = { origin: 'https://roamresearch.com' };
  const iframe = new EventTarget();
  iframe.src = 'https://www.youtube.com/embed/M7lc1UVf-VE?enablejsapi=1';
  iframe.getAttribute = () => iframe.src;
  iframe.setAttribute = (_key, value) => { iframe.src = value; };
  const sent = [];
  iframe.contentWindow = { postMessage: (data) => sent.push(JSON.parse(data)) };
  let now = 0;
  const clock = new YouTubeClock(iframe, () => {}, () => {}, () => {}, { now: () => now, ...options });
  const deliver = (info) => {
    const event = new Event('message');
    Object.defineProperties(event, { data: { value: { event: 'infoDelivery', info } }, source: { value: iframe.contentWindow }, origin: { value: 'https://www.youtube.com' } });
    window.dispatchEvent(event);
  };
  try { callback({ clock, iframe, sent, deliver, advance: (value) => { now += value; } }); }
  finally { clock.destroy(); for (const [key, value] of Object.entries(originalGlobals)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
}
test('API changes notify the renderer so its native-CC gate can close immediately', () => {
  let changes = 0;
  withClock(({ iframe }) => {
    const event = new Event('message');
    Object.defineProperties(event, { data: { value: { event: 'onApiChange' } }, source: { value: iframe.contentWindow }, origin: { value: 'https://www.youtube.com' } });
    window.dispatchEvent(event);
    assert.equal(changes, 1);
  }, { onApiChange: () => { changes++; } });
});
test('clock rebases state/rate-only updates and never extrapolates indefinitely', () => withClock(({ clock, deliver, advance }) => {
  deliver({ currentTime: 10, playerState: 1, playbackRate: 1 });
  advance(500); deliver({ playbackRate: 2 });
  advance(500); assert.equal(clock.currentTime(), 11.5);
  deliver({ playerState: 2 });
  advance(1000); assert.equal(clock.currentTime(), 11.5);
  deliver({ playerState: 1 });
  advance(60000); assert.ok(clock.currentTime() <= 14.5, 'stale playback must freeze, not advance a minute');
  assert.equal(clock.isSynchronized(), false);
}));
test('seek before initial time is queued and replayed when the player becomes ready', () => withClock(({ clock, sent, deliver }) => {
  clock.seek(40);
  assert.equal(sent.some((data) => data.func === 'seekTo'), false);
  deliver({ currentTime: 0, playerState: 2 });
  assert.deepEqual(sent.filter((data) => data.func === 'seekTo').at(-1)?.args, [40, true]);
}));
test('paused players stay synchronized without periodic packets and can seek immediately', () => withClock(({ clock, deliver, advance, sent }) => {
  deliver({ currentTime: 10, playerState: 2 });
  advance(60000);
  assert.equal(clock.isSynchronized(), true);
  assert.equal(clock.currentTime(), 10);
  clock.seek(20);
  assert.deepEqual(sent.filter((data) => data.func === 'seekTo').at(-1)?.args, [20, true]);
}));
test('removing an enabled extension does not leave stale synchronization state', () => withClock(({ clock, iframe, deliver }) => {
  deliver({ currentTime: 1, playerState: 1 });
  assert.equal(clock.isSynchronized(), true);
  iframe.dispatchEvent(new Event('load'));
  assert.equal(clock.isSynchronized(), false);
}));
