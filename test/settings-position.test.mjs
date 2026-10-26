import test from 'node:test';
import assert from 'node:assert/strict';
import { popoverPosition } from '../src/settings.mjs';
const video = { left: 396, right: 1272, bottom: 556 };
const anchor = { left: 1242, right: 1272, top: 562, bottom: 592 };

test('settings prefer below the video when the complete card fits', () => {
  const result = popoverPosition(anchor, { width: 272, height: 194 }, { width: 1668, height: 963 }, video);
  assert.equal(result.top, 598); assert.equal(result.left, 1000); assert.equal(result.placement, 'below-video');
});
test('a bottom-edge trigger opens upward instead of clipping into a small scrolling strip', () => {
  const result = popoverPosition(anchor, { width: 272, height: 194 }, { width: 1668, height: 760 }, video);
  assert.equal(result.top, 362); assert.equal(result.placement, 'above-trigger');
  assert.ok(result.maxHeight >= 194 && result.left + 272 <= video.right);
});
test('preview side controls use the video edge rather than jumping into the sidebar', () => {
  const result = popoverPosition({ right: 744, top: 130, bottom: 154 }, { width: 272, height: 194 }, { width: 1280, height: 600 }, { left: 100, right: 720, bottom: 540 });
  assert.equal(result.top, 340); assert.equal(result.left, 448); assert.equal(result.placement, 'above-trigger');
});
test('expanded colors can flip a previously below-video card upward', () => {
  const a = { right: 720, top: 440, bottom: 470 }, v = { left: 100, right: 720, bottom: 440 }, viewport = { width: 1280, height: 700 };
  assert.equal(popoverPosition(a, { width: 272, height: 194 }, viewport, v).placement, 'below-video');
  const expanded = popoverPosition(a, { width: 272, height: 234 }, viewport, v);
  assert.equal(expanded.placement, 'above-trigger'); assert.ok(expanded.maxHeight >= 234);
});
test('only a viewport shorter than the card requires internal scrolling', () => {
  const result = popoverPosition({ right: 304, top: 110, bottom: 134 }, { width: 272, height: 234 }, { width: 320, height: 150 }, { left: 12, right: 304, bottom: 110 });
  assert.equal(result.top, 8); assert.equal(result.maxHeight, 134); assert.equal(result.placement, 'viewport-fit');
  assert.ok(result.left >= 8 && result.left + 272 <= 312);
});
test('zoomed visual viewport bounds constrain both axes', () => {
  const result = popoverPosition({ right: 500, top: 474, bottom: 500 }, { width: 272, height: 194 }, { left: 30, top: 50, width: 400, height: 500 }, { left: 20, right: 550, bottom: 474 });
  assert.ok(result.left >= 38 && result.left + 272 <= 422);
  assert.ok(result.top >= 58 && result.top + 194 <= 542);
});
