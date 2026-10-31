import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNativeCc } from '../src/native-cc.mjs';

test('missing CC controls preserve an explicit off confirmation but never create one', () => {
  for (const reason of ['controls-hidden', 'controls-visible']) {
    assert.equal(resolveNativeCc('off', { state: 'unknown', reason }), 'off');
    assert.equal(resolveNativeCc('unknown', { state: 'unknown', reason }), 'unknown');
    assert.equal(resolveNativeCc('on', { state: 'unknown', reason }), 'unknown');
  }
});
test('positive native captions, missing players, and unknown responses close the gate', () => {
  assert.equal(resolveNativeCc('off', { state: 'on', reason: 'native-caption-visible' }), 'on');
  assert.equal(resolveNativeCc('off', { state: 'unknown', reason: 'player-not-visible' }), 'unknown');
  assert.equal(resolveNativeCc('off', { state: 'unknown', reason: 'unrecognized-control' }), 'unknown');
  assert.equal(resolveNativeCc('off', { state: 'unknown', reason: 'busy' }), 'unknown');
  assert.equal(resolveNativeCc('off', undefined), 'unknown');
});
