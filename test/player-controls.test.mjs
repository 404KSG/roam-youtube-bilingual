import test from 'node:test';
import assert from 'node:assert/strict';
import { subtitleMetrics } from '../src/surface.mjs';

// The reported paused embed is about 886 x 496 CSS pixels; its bottom
// transport/time controls occupy roughly 110px. Captions must clear that area.
test('paused or unconfirmed player controls have a protected bottom region', () => {
  const metrics = subtitleMetrics(886, 496);
  assert.ok(metrics.bottom >= 120, 'captions still overlap the native control region');
  assert.ok(metrics.bottom <= 136, 'the safe region should not consume most of the picture');
  assert.ok(metrics.maxCaptionHeight + metrics.bottom <= 488);
});

test('confirmed idle playback can use the normal low caption position', () => {
  const metrics = subtitleMetrics(886, 496, 1, 0.08, { controlsHidden: true });
  assert.ok(metrics.bottom >= 38 && metrics.bottom <= 41);
  assert.ok(metrics.maxCaptionHeight > 0);
});

test('control-safe caption budgets fit small previews and large players', () => {
  for (const [width, height] of [[160, 90], [320, 180], [640, 360], [1920, 1080]]) {
    const metrics = subtitleMetrics(width, height);
    assert.ok(metrics.bottom >= 0 && metrics.bottom <= height);
    assert.ok(metrics.maxCaptionHeight >= 0 && metrics.maxCaptionHeight + metrics.bottom <= height);
  }
  assert.ok(subtitleMetrics(160, 90).maxCaptionHeight < 24, 'tiny interactive players must not squeeze captions into controls');
  assert.equal(subtitleMetrics(1920, 1080).bottom, 128, 'fullscreen controls do not need a screen-proportional gutter');
});
