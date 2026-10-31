import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { subtitleMetrics } from '../src/surface.mjs';

// Exercise the real position controller and interaction policy together, with
// deterministic geometry/time. Browser tests separately exercise native focus.
const extension = await readFile(new URL('../src/extension.mjs', import.meta.url), 'utf8');
const controller = extension.slice(extension.indexOf('class VideoCaptions {'), extension.indexOf('\nfunction scan()'));
const surfaceSource = await readFile(new URL('../src/surface.mjs', import.meta.url), 'utf8');
function fixture({ state = 2, focused = false, hovered = false, recent = false, controlsHidden = true } = {}) {
  const now = 10000;
  const iframe = { matches: () => hovered, getBoundingClientRect: () => ({ width: 886, height: 496 }) };
  const context = vm.createContext({ Date: { now: () => now }, subtitleMetrics, document: { activeElement: focused ? iframe : null } });
  const Surface = vm.runInContext(`${surfaceSource.replace(/^export /gm, '')}; VideoSurface`, context);
  const Controller = vm.runInContext(`${controller}; VideoCaptions`, context);
  const surface = Object.assign(Object.create(Surface.prototype), { iframe, now: () => now, lastInteraction: now - (recent ? 500 : 5000), host: { style: { display: 'block' } }, viewport: { width: 886, height: 496, scaleY: 1 } });
  const video = Object.assign(Object.create(Controller.prototype), {
    iframe, surface, enabled: true, disposed: false, ccState: 'off', ccVerifiedAt: now,
    nativeControlsHidden: controlsHidden, nativeControlsVisible: false, clock: { state },
    pair: { source: 'A paused caption.', target: '暂停字幕。' },
    config: { sourceFontSize: 20, targetFontSize: 18, sourceColor: '#fff', targetColor: '#fff' },
    box: { hidden: false, style: {}, getBoundingClientRect: () => ({ height: 60 }) },
    source: { style: {} }, target: { style: {} }, textWidth: () => 100, fitRow() {},
  });
  return { video, surface, gap: () => 496 - parseFloat(video.box.style.top) - 60 };
}

test('paused captions return low when controls are confirmed hidden and the mouse has left', () => {
  const { video, gap } = fixture(); video.drawPair();
  assert.ok(Math.abs(gap() - 39.68) < 0.1, `paused caption retained a ${gap()}px control inset`);
});
test('sticky iframe focus does not pin paused or playing captions after fresh hidden-controls evidence', () => {
  for (const state of [1, 2]) {
    const { video, gap } = fixture({ state, focused: true }); video.drawPair();
    assert.ok(Math.abs(gap() - 39.68) < 0.1, `state ${state} retained a ${gap()}px control inset`);
  }
});
test('visible controls, hover, and recent focus still reserve the transport area', () => {
  for (const options of [{ controlsHidden: false }, { hovered: true }, { focused: true, recent: true }]) {
    const { video, gap } = fixture(options); video.drawPair(); assert.equal(gap(), 128);
  }
});
test('focus without hidden-controls evidence remains conservative', () => {
  const { surface } = fixture({ focused: true });
  assert.equal(surface.isInteracting(), true);
});
test('unchanged paused text moves down and back up as controls hide and reappear', () => {
  const { video, gap } = fixture({ focused: true, controlsHidden: false });
  const pair = video.pair;
  video.drawPair(); assert.equal(gap(), 128);
  video.nativeControlsHidden = true; video.drawPair(); assert.ok(gap() < 41);
  video.nativeControlsHidden = false; video.drawPair(); assert.equal(gap(), 128);
  assert.equal(video.pair, pair); assert.equal(video.source.textContent, pair.source);
});
test('expired native-state evidence never lowers or exposes paused captions', () => {
  const { video } = fixture(); video.ccVerifiedAt -= 2000; video.drawPair();
  assert.equal(video.box.hidden, true);
});
