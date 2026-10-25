import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { activeCueIndex } from '../src/core.mjs';
import { singleLine } from '../src/protocol.mjs';

// Exercise the real controller methods without constructing browser DOM.
const source = await readFile(new URL('../src/extension.mjs', import.meta.url), 'utf8');
const controller = source.slice(source.indexOf('class VideoCaptions {'), source.indexOf('\nfunction scan()'));
function harness({ request = async () => ({ ok: true }) } = {}) {
  const commands = [], videos = new Map();
  const context = { videos, config: { target: 'zh-Hans' }, AbortController, DOMException, clearTimeout, activeCueIndex, singleLine,
    verifyHealth: data => data, request };
  const Controller = vm.runInNewContext(`${controller}; VideoCaptions`, context);
  const video = Object.create(Controller.prototype);
  Object.assign(video, { enabled: false, loading: false, disposed: false, epoch: 0, videoId: 'vif8NQcjVf0',
    tracks: new Map(), box: { hidden: false }, source: { textContent: 'English' }, target: { textContent: '中文' }, noticeBox: {},
    clock: { unloadCaptions: () => commands.push('off'), restoreCaptions: () => { assert.equal(video.box.hidden, true); commands.push('restore'); } },
    updateIcon() {}, notice(message) { this.lastNotice = message; },
    loadInfo: async () => ({ sourceLanguage: 'en', languages: [{ code: 'zh-Hans' }] }),
    loadTrack: async language => { if (language !== 'en') throw new Error('YouTube 429'); return []; },
  });
  videos.set({}, video);
  return { video, commands };
}

test('a failed target download never disables existing native captions', async () => {
  const { video, commands } = harness();
  await video.turnOn();
  assert.deepEqual(commands, []);
  assert.equal(video.enabled, false);
  assert.equal(video.box.hidden, true);
  assert.equal(video.lastError, 'YouTube 429');
});

test('closing the render gate is side-effect-free for native CC, even while disabled', () => {
  const { video, commands } = harness();
  video.ccState = 'off'; video.closeNativeGate(); video.turnOff();
  assert.deepEqual(commands, []);
  assert.equal(video.ccState, 'unknown');
  assert.equal(video.box.hidden, true);
});

test('native CC restoration happens only after the custom overlay is hidden', () => {
  const { video, commands } = harness();
  video.enabled = true; video.nativeWasOn = true; video.nativeChanged = true;
  video.turnOff();
  assert.deepEqual(commands, ['restore']);
});

test('English and translated cues use their own independent time boundaries', () => {
  const { video } = harness();
  Object.assign(video, { enabled: true, ccState: 'off', ccVerifiedAt: Date.now(), time: 5, info: { sourceLanguage: 'en' } });
  video.clock.isSynchronized = () => true;
  video.tracks.set('en', [{ start: 0, end: 10, text: 'English sentence' }]);
  video.tracks.set('zh-Hans', [{ start: 0, end: 2, text: '已过期' }, { start: 2, end: 10, text: '当前译文' }]);
  video.drawPair = () => {};
  video.updatePair();
  assert.equal(video.pair.source, 'English sentence');
  assert.equal(video.pair.target, '当前译文');
});

test('the last metadata subscriber cancels the underlying request', async () => {
  let resolve, upstream;
  const { video } = harness({ request: (_path, _body, signal) => { upstream = signal; return new Promise(yes => { resolve = yes; }); } });
  delete video.loadInfo;
  const abort = new AbortController(), pending = video.loadInfo(abort.signal);
  abort.abort();
  try { assert.equal(upstream.aborted, true); }
  finally { resolve({ videoId: video.videoId, languages: [] }); await pending.catch(() => {}); }
});

test('closing one metadata consumer does not cancel another active consumer', async () => {
  let resolve, calls = 0, upstream;
  const { video } = harness({ request: (_path, _body, signal) => { calls++; upstream = signal; return new Promise(yes => { resolve = yes; }); } });
  delete video.loadInfo;
  const abort = new AbortController();
  const first = video.loadInfo(abort.signal), second = video.loadInfo();
  abort.abort(); assert.equal(upstream.aborted, false);
  resolve({ videoId: video.videoId, languages: [] });
  const results = await Promise.allSettled([first, second]);
  assert.equal(results[0].status, 'rejected'); assert.equal(results[1].status, 'fulfilled'); assert.equal(calls, 1);
});

test('a video switch starts fresh metadata and discards the previous late response', async () => {
  const pending = [];
  const { video } = harness({ request: (_path, body) => new Promise(resolve => pending.push({ id: body.videoId, resolve })) });
  delete video.loadInfo;
  const old = video.loadInfo();
  video.videoChanged('dQw4w9WgXcQ');
  const current = video.loadInfo();
  try { assert.equal(pending.length, 2); }
  finally {
    for (const item of [...pending].reverse()) item.resolve({ videoId: item.id, languages: [] });
    await Promise.allSettled([old, current]);
  }
  assert.equal(video.info.videoId, 'dQw4w9WgXcQ');
});

test('an expired CC-off confirmation cannot keep the overlay visible', () => {
  const { video } = harness();
  Object.assign(video, { enabled: true, ccState: 'off', ccVerifiedAt: Date.now() - 2000, pair: { source: 'English', target: '中文' } });
  video.drawPair();
  assert.equal(video.box.hidden, true);
});
