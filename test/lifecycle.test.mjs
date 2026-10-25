import test from 'node:test';
import assert from 'node:assert/strict';
import { claimRenderer, releaseRenderer } from '../src/lifecycle.mjs';

test('a second renderer only starts after the known first renderer has actually unloaded', () => {
  const host = {};
  const first = { active: false, unload() { releaseRenderer(host, first); } };
  const second = { active: false, unload() { releaseRenderer(host, second); } };
  assert.equal(claimRenderer(host, first), true);
  assert.equal(claimRenderer(host, second), true);
  assert.equal(first.active, false);
  assert.equal(second.active, true);
});

test('an unknown or non-releasing prior renderer blocks a new renderer rather than hiding its DOM', () => {
  const host = {};
  const stuck = { active: true, unload() { this.active = false; } };
  const next = { active: false, unload() {} };
  assert.equal(claimRenderer(host, stuck), true);
  assert.equal(claimRenderer(host, next), false);
  assert.equal(next.active, false);
  releaseRenderer(host, stuck);
  assert.equal(claimRenderer(host, next, { unknownRenderer: true }), false);
});
