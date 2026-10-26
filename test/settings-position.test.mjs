import test from 'node:test';
import assert from 'node:assert/strict';
import { popoverPosition } from '../src/settings.mjs';

test('settings remain underneath the video instead of moving into the right sidebar', () => {
  const result = popoverPosition({ left: 1242, right: 1272, top: 562, bottom: 592 }, { width: 272, height: 210 }, { width: 1668, height: 760 }, { left: 396, right: 1272, bottom: 556 });
  assert.equal(result.top, 598); assert.equal(result.left, 1000);
  assert.equal(result.maxHeight, 154);
});
test('a preview side button still anchors settings below the video, not beside the button', () => {
  const result = popoverPosition({ left: 720, right: 744, top: 130, bottom: 154 }, { width: 272, height: 210 }, { width: 1280, height: 800 }, { left: 100, right: 720, bottom: 440 });
  assert.equal(result.top, 446); assert.equal(result.left, 448);
});
test('a narrow viewport keeps the card within the video column', () => {
  const result = popoverPosition({ left: 280, right: 304, top: 350, bottom: 374 }, { width: 272, height: 210 }, { width: 320, height: 600 }, { left: 12, right: 304, bottom: 350 });
  assert.ok(result.left >= 12 && result.left + 272 <= 304);
  assert.equal(result.top, 380); assert.ok(result.maxHeight <= 212);
});
