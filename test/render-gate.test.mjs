import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { activeCueIndex } from '../src/core.mjs';
import { singleLine, validateConfig } from '../src/protocol.mjs';
import { createSubtitlePreferences } from '../src/preferences.mjs';
import { alignCaptionTracks } from '../src/alignment.mjs';
import { readingSegments, visibleSegment } from '../src/reading.mjs';
import { resolveNativeCc } from '../src/native-cc.mjs';
import { phaseMessage } from '../src/caption-session.mjs';

// Exercise the real controller methods without constructing browser DOM.
const source = await readFile(new URL('../src/extension.mjs', import.meta.url), 'utf8');
const controller = source.slice(source.indexOf('class VideoCaptions {'), source.indexOf('\nfunction scan()'));
function harness({ request = async () => ({ ok: true }), now = Date.now, CaptionSessionImpl, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const commands = [], videos = new Map();
  const context = { videos, preferences: createSubtitlePreferences(null), validateConfig, AbortController, DOMException, setTimeout: setTimer, clearTimeout: clearTimer, activeCueIndex, singleLine, alignCaptionTracks, readingSegments, visibleSegment, resolveNativeCc, phaseMessage, Date: { now }, settings: null, document: { hidden: false }, SERVICE_URL: 'http://127.0.0.1:17321', VERSION: 'test', encodeURIComponent,
    CaptionSession: CaptionSessionImpl || class { constructor({ epoch }) { this.epoch = epoch; } async start() { throw new Error('YouTube 429'); } }, verifyHealth: data => data, request };
  const Controller = vm.runInNewContext(`${controller}; VideoCaptions`, context);
  const video = Object.create(Controller.prototype);
  Object.assign(video, { enabled: false, wantsEnabled: false, config: { target: 'zh-Hans', fontSize: 20 }, loading: false, disposed: false, epoch: 0, videoId: 'vif8NQcjVf0',
    captionData: null, box: { hidden: false }, source: { textContent: 'English' }, target: { textContent: '中文' }, noticeBox: { dataset: {} },
    clock: { unloadCaptions: () => commands.push('off'), restoreCaptions: () => { assert.equal(video.box.hidden, true); commands.push('restore'); } },
    updateIcon() {}, notice(message) { this.lastNotice = message; },
    loadInfo: async () => ({ sourceLanguage: 'en', languages: [{ code: 'zh-Hans' }] }),
    loadTrack: async language => { if (language !== 'en') throw new Error('YouTube 429'); return []; },
  });
  videos.set({}, video);
  return { video, commands };
}
function installCaptionData(video, source, target = null) {
  const fingerprint = 'a'.repeat(64); video.captionData = { epoch: video.epoch, videoId: video.videoId, targetLanguage: 'zh-Hans', source: { language: 'en', fingerprint, cues: source }, target: target ? { language: 'zh-Hans', sourceFingerprint: fingerprint, pairId: 'b'.repeat(64), cues: target } : null };
}

test('a failed target download never disables existing native captions', async () => {
  const { video, commands } = harness();
  await video.turnOn();
  assert.deepEqual(commands, []);
  assert.equal(video.enabled, false);
  assert.equal(video.box.hidden, true);
  assert.equal(video.lastError, 'YouTube 429');
});

test('post-source stream failure tears down delayed native CC work before it can unload captions', async () => {
  let resolveCc; class BrokenSession { constructor(args) { Object.assign(this, args); } async start() { const base = { videoId: 'vif8NQcjVf0', target: 'zh-Hans' }; this.onEvent({ ...base, type: 'info', info: { videoId: base.videoId, sourceLanguage: 'en', languages: [] } }, this); this.onEvent({ ...base, type: 'source-ready', language: 'en', sourceFingerprint: 'a'.repeat(64), cues: [{ start: 0, end: 1, text: 'English' }] }, this); throw new Error('truncated'); } }
  const { video, commands } = harness({ CaptionSessionImpl: BrokenSession, request: (path, _body, signal) => path.endsWith('health') ? Promise.resolve({ ok: true }) : new Promise(resolve => { resolveCc = () => resolve({ videoId: 'vif8NQcjVf0', state: 'on', reason: 'control', checkedAt: Date.now() }); signal.addEventListener('abort', () => {}, { once: true }); }) }); video.wantsEnabled = true; video.surface = { host: { style: { display: 'block' } } }; video.screenFrame = () => ({ x: 0, y: 0, width: 1, height: 1 });
  await video.turnOn(); resolveCc(); await Promise.resolve(); assert.equal(video.enabled, false); assert.equal(video.captionData, null); assert.deepEqual(commands, []); assert.equal(video.wantsEnabled, true);
});
test('post-source failure restores captions when this instance already unloaded them', async () => {
  class BrokenSession { constructor(args) { Object.assign(this, args); } async start() { const base = { videoId: 'vif8NQcjVf0', target: 'zh-Hans' }; this.onEvent({ ...base, type: 'info', info: { videoId: base.videoId, sourceLanguage: 'en', languages: [] } }, this); this.onEvent({ ...base, type: 'source-ready', language: 'en', sourceFingerprint: 'a'.repeat(64), cues: [{ start: 0, end: 1, text: 'English' }] }, this); await Promise.resolve(); throw new Error('invalid stream'); } }
  const { video, commands } = harness({ CaptionSessionImpl: BrokenSession, request: async path => path.endsWith('health') ? { ok: true } : { videoId: 'vif8NQcjVf0', state: 'on', reason: 'control', checkedAt: Date.now() } }); video.wantsEnabled = true; video.surface = { host: { style: { display: 'block' } } }; video.screenFrame = () => ({ x: 0, y: 0, width: 1, height: 1 });
  await video.turnOn(); assert.deepEqual(commands, ['off', 'restore']); assert.equal(video.enabled, false);
});
test('a failed restoration keeps the saved ON choice without automatic retries', async () => {
  const { video } = harness(); let attempts = 0;
  video.wantsEnabled = true; video.updateIcon = () => { attempts++; };
  await video.turnOn();
  video.restoreIfNeeded(); video.restoreIfNeeded(true);
  assert.equal(video.wantsEnabled, true); assert.equal(video.restoreAttempted, true); assert.ok(attempts >= 1);
  assert.equal(video.config.target, 'zh-Hans');
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

test('English-led grouping does not carry translation from an earlier source segment', () => {
  const { video } = harness();
  Object.assign(video, { enabled: true, ccState: 'off', ccVerifiedAt: Date.now(), time: 5, info: { sourceLanguage: 'en' } });
  video.clock.isSynchronized = () => true;
  installCaptionData(video, [{ start: 0, end: 2, text: 'Earlier English' }, { start: 2, end: 10, text: 'English sentence' }], [{ start: 0, end: 2, text: '已过期' }, { start: 2, end: 10, text: '当前译文' }]);
  video.drawPair = () => {};
  video.updatePair();
  assert.equal(video.pair.source, 'English sentence');
  assert.equal(video.pair.target, '当前译文');
});

test('the displayed Chinese paragraph stays fixed while the English segment stays fixed', () => {
  const { video } = harness();
  Object.assign(video, { enabled: true, ccState: 'off', ccVerifiedAt: Date.now(), info: { sourceLanguage: 'en' } });
  video.clock.isSynchronized = () => true; video.drawPair = () => {};
  installCaptionData(video, [{ start: 0, end: 4, text: 'One English segment' }], [{ start: 0, end: 1, text: '完整的' }, { start: 1, end: 4, text: '中文段落。' }]);
  for (const time of [.5, 1.5, 3.5]) { video.time = time; video.updatePair(); assert.equal(video.pair.target, '完整的中文段落。'); }
});

test('a genuinely empty translated segment retains English rather than borrowing a neighboring translation', () => {
  const { video } = harness();
  Object.assign(video, { enabled: true, ccState: 'off', ccVerifiedAt: Date.now(), time: 5, info: { sourceLanguage: 'en' } });
  video.clock.isSynchronized = () => true; video.drawPair = () => {};
  installCaptionData(video, [{ start: 0, end: 2, text: 'Earlier.' }, { start: 2, end: 6, text: 'English without a translation.' }], [{ start: 0, end: 2, text: '上一句。' }]);
  video.updatePair();
  assert.equal(video.pair.source, 'English without a translation.'); assert.equal(video.pair.target, '');
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

test('slow process discovery does not invalidate a freshly captured native state', async () => {
  let time = 1000, refreshed = false;
  const { video } = harness({ now: () => time, request: async () => { time = 2900; return { videoId: 'vif8NQcjVf0', state: 'off', reason: 'control', checkedAt: 2850 }; } });
  installCaptionData(video, [{ start: 0, end: 1, text: 'English' }]);
  Object.assign(video, { enabled: true, info: { sourceLanguage: 'en' }, surface: { host: { style: { display: 'block' } } }, screenFrame: () => ({ x: 0, y: 0, width: 800, height: 450 }), updatePair: () => { refreshed = true; } });
  await video.checkNativeCc();
  assert.equal(video.ccState, 'off'); assert.equal(video.ccVerifiedAt, 2850); assert.equal(refreshed, true);
});

test('an old snapshot is still rejected even if its response has just arrived', async () => {
  let time = 1000;
  const { video } = harness({ now: () => time, request: async () => { time = 2900; return { videoId: 'vif8NQcjVf0', state: 'off', reason: 'control', checkedAt: 1000 }; } });
  installCaptionData(video, [{ start: 0, end: 1, text: 'English' }]);
  Object.assign(video, { enabled: true, info: { sourceLanguage: 'en' }, surface: { host: { style: { display: 'block' } } }, screenFrame: () => ({ x: 0, y: 0, width: 800, height: 450 }) });
  await video.checkNativeCc(); assert.equal(video.ccState, 'unknown'); assert.equal(video.box.hidden, true);
});

test('a target error persists through later successful native CC checks while English remains available', async () => {
  const { video } = harness({ request: async () => ({ videoId: 'vif8NQcjVf0', state: 'off', reason: 'control', checkedAt: Date.now() }) });
  installCaptionData(video, [{ start: 0, end: 2, text: 'English' }]);
  Object.assign(video, { enabled: true, info: { sourceLanguage: 'en' }, targetError: 'Translated captions are unavailable; English remains available.', surface: { host: { style: { display: 'block' } } }, screenFrame: () => ({ x: 0, y: 0, width: 800, height: 450 }), updatePair() {} });
  await video.checkNativeCc(); assert.equal(video.targetError, 'Translated captions are unavailable; English remains available.');
});

test('CC-off confirmation does not erase the pending translation indicator', async () => {
  const { video } = harness({ request: async () => ({ videoId: 'vif8NQcjVf0', state: 'off', reason: 'control', checkedAt: Date.now() }) });
  installCaptionData(video, [{ start: 0, end: 2, text: 'English' }]);
  Object.assign(video, { enabled: true, loading: true, surface: { host: { style: { display: 'block' } } }, screenFrame: () => ({ x: 0, y: 0, width: 800, height: 450 }), updatePair() {} });
  delete video.notice;
  video.notice('Loading translation…', 0);
  await video.checkNativeCc();
  assert.equal(video.noticeBox.hidden, false);
  assert.equal(video.noticeBox.textContent, 'Loading translation…');
});
test('an old transient timer cannot hide loading and OFF clears the persistent indicator', () => {
  const timers = new Map(); let next = 0;
  const { video } = harness({ setTimer: fn => { timers.set(++next, fn); return next; }, clearTimer: id => timers.delete(id) });
  delete video.notice;
  video.notice('Earlier transient message'); const oldTimer = [...timers.values()][0];
  installCaptionData(video, [{ start: 0, end: 2, text: 'English' }]);
  video.enabled = true; video.loading = true; video.info = { sourceLanguage: 'en' };
  const session = video.session = { epoch: video.epoch }; video.captionData.owner = session; video.checkNativeCc = async () => {};
  video.handleSessionEvent({ type: 'source-ready', language: 'en', sourceFingerprint: 'a'.repeat(64), cues: [{ start: 0, end: 2, text: 'English' }] }, session);
  assert.equal(timers.size, 0, 'pending translation must not have an auto-hide timer');
  oldTimer();
  assert.equal(video.noticeBox.hidden, false);
  assert.equal(video.noticeBox.textContent, 'Loading translation…');
  video.turnOff(); assert.equal(video.noticeBox.hidden, true);
});
test('a temporary action notice can be shown without losing pending translation status afterward', () => {
  const timers = new Map(); let next = 0;
  const { video } = harness({ setTimer: fn => { timers.set(++next, fn); return next; }, clearTimer: id => timers.delete(id) });
  installCaptionData(video, [{ start: 0, end: 2, text: 'English' }]); video.enabled = true; video.loading = true; delete video.notice;
  video.refreshStatusNotice();
  video.notice('Fullscreen is unavailable.');
  assert.equal(video.noticeBox.textContent, 'Fullscreen is unavailable.');
  [...timers.values()][0]();
  assert.equal(video.noticeBox.hidden, false); assert.equal(video.noticeBox.textContent, 'Loading translation…');
  assert.equal(video.noticeBox.dataset.kind, 'loading'); assert.equal(timers.size, 0);
});
test('translation failure replaces loading and survives subsequent CC checks', async () => {
  const { video } = harness({ request: async () => ({ videoId: 'vif8NQcjVf0', state: 'off', reason: 'control', checkedAt: Date.now() }) });
  const session = { epoch: 0 }; installCaptionData(video, [{ start: 0, end: 2, text: 'English' }]);
  Object.assign(video, { enabled: true, loading: true, wantsEnabled: true, session, surface: { host: { style: { display: 'block' } } }, screenFrame: () => ({ x: 0, y: 0, width: 800, height: 450 }), updatePair() {} });
  video.captionData.owner = session; delete video.notice;
  video.handleSessionEvent({ type: 'target-error', message: 'YouTube returned HTTP 429.' }, session);
  await video.checkNativeCc();
  assert.equal(video.loading, false); assert.equal(video.noticeBox.hidden, false);
  assert.equal(video.noticeBox.dataset.kind, 'error'); assert.doesNotMatch(video.noticeBox.textContent, /loading|queued/i);
  assert.equal(video.statusMessage(), 'YouTube returned HTTP 429.'); assert.equal(video.wantsEnabled, true);
});
test('target-ready removes loading even when this particular cue has no translation', () => {
  const { video } = harness(); const session = { epoch: 0 };
  installCaptionData(video, [{ start: 0, end: 2, text: 'English without a matching target cue' }]);
  Object.assign(video, { enabled: true, loading: true, session, ccState: 'off', ccVerifiedAt: Date.now(), time: 1 });
  video.captionData.owner = session; video.clock.isSynchronized = () => true; video.drawPair = () => {}; delete video.notice;
  video.notice('Loading translation…');
  video.handleSessionEvent({ type: 'target-ready', language: 'zh-Hans', sourceFingerprint: 'a'.repeat(64), pairId: 'b'.repeat(64), cues: [{ start: 10, end: 12, text: 'Later target' }] }, session);
  assert.equal(video.noticeBox.hidden, true); assert.equal(video.loadingMessage(), '');
  assert.equal(video.pair.target, '', 'an actual upstream gap is not presented as pending download');
});
test('settings progress drops the old native-CC warning after an off confirmation', async () => {
  const { video } = harness({ request: async () => ({ videoId: 'vif8NQcjVf0', state: 'off', reason: 'control', checkedAt: Date.now() }) });
  installCaptionData(video, [{ start: 0, end: 2, text: 'English' }]);
  Object.assign(video, { enabled: true, loading: true, ccState: 'on', surface: { host: { style: { display: 'block' } } }, screenFrame: () => ({ x: 0, y: 0, width: 800, height: 450 }), updatePair() {} });
  assert.match(video.statusMessage(), /Native captions are still on/);
  await video.checkNativeCc();
  assert.equal(video.statusMessage(), 'Loading translation…');
});
test('an expired CC-off confirmation cannot keep the overlay visible', () => {
  const { video } = harness();
  Object.assign(video, { enabled: true, ccState: 'off', ccVerifiedAt: Date.now() - 2000, pair: { source: 'English', target: '中文' } });
  video.drawPair();
  assert.equal(video.box.hidden, true);
});
test('repeated static-text CC evidence unloads again but neither rearms the warning nor claims restoration ownership', async () => {
  const { video, commands } = harness({ request: async () => ({ videoId: 'vif8NQcjVf0', state: 'on', reason: 'native-caption-visible', checkedAt: Date.now() }) });
  installCaptionData(video, [{ start: 0, end: 2, text: 'English' }]);
  Object.assign(video, { enabled: true, info: { sourceLanguage: 'en' }, surface: { host: { style: { display: 'block' } } }, screenFrame: () => ({ x: 0, y: 0, width: 800, height: 450 }) });
  let notices = 0; video.notice = () => { notices++; };
  await video.checkNativeCc(); video.nextCcCheck = 0;
  await video.checkNativeCc();
  assert.deepEqual(commands, ['off', 'off']);
  assert.equal(notices, 1);
  assert.notEqual(video.nativeWasOn, true);
  assert.notEqual(video.nativeChanged, true);
});
test('an explicit CC-off control observation rearms a later real CC-on warning', async () => {
  const states = ['on', 'off', 'on'];
  const { video, commands } = harness({ request: async () => ({ videoId: 'vif8NQcjVf0', state: states.shift(), reason: 'control', checkedAt: Date.now() }) });
  installCaptionData(video, [{ start: 0, end: 2, text: 'English' }]);
  Object.assign(video, { enabled: true, info: { sourceLanguage: 'en' }, surface: { host: { style: { display: 'block' } } }, screenFrame: () => ({ x: 0, y: 0, width: 800, height: 450 }) });
  video.clock.isSynchronized = () => true;
  const notices = []; video.notice = message => notices.push(message);
  await video.checkNativeCc(); video.nextCcCheck = 0;
  await video.checkNativeCc(); video.nextCcCheck = 0;
  await video.checkNativeCc();
  assert.deepEqual(commands, ['off', 'off']);
  assert.deepEqual(notices, ['Native captions are still on. Bilingual subtitles remain hidden.', 'Native captions are still on. Bilingual subtitles remain hidden.']);
  assert.equal(video.nativeWasOn, true);
  assert.equal(video.nativeChanged, true);
});
