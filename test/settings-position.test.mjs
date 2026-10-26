import test from 'node:test';
import assert from 'node:assert/strict';
import { popoverPosition } from '../src/settings.mjs';

test('free space beside the video is used before covering subtitles', () => {
  const result = popoverPosition({ left: 1242, right: 1272, top: 562, bottom: 592 }, { width: 320, height: 386 }, { width: 1668, height: 963 }, { right: 1272 });
  assert.equal(result.left, 1280); assert.equal(result.top, 562);
});
test('a narrow viewport keeps all settings on screen', () => {
  const result = popoverPosition({ left: 280, right: 304, top: 450, bottom: 474 }, { width: 296, height: 380 }, { width: 320, height: 600 }, { right: 304 });
  assert.ok(result.left >= 12 && result.left + 296 <= 308);
  assert.ok(result.top >= 12 && result.top + 380 <= 588);
});
