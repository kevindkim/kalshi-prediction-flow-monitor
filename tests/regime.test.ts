import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRegime, DEFAULT_REGIME_CONFIG, sizeMultiplierForVix } from '../src/schwab/regime';

test('vol targeting: full size at or below the reference VIX, then reference / VIX', () => {
  assert.equal(sizeMultiplierForVix(12), 1);
  assert.equal(sizeMultiplierForVix(18), 1);
  assert.equal(sizeMultiplierForVix(24), 0.75);
  assert.equal(sizeMultiplierForVix(36), 0.5);
  assert.equal(sizeMultiplierForVix(90), 0.2);
  assert.equal(sizeMultiplierForVix(500), 0.1); // floor
  assert.equal(sizeMultiplierForVix(null), 1);
});

test('contango allows entries, backwardation pauses them', () => {
  const calm = classifyRegime(14, 17);
  assert.equal(calm.label, 'CALM');
  assert.equal(classifyRegime(24, 27).label, 'ELEVATED');
  assert.equal(calm.contango, true);
  assert.equal(calm.allowNewEntries, true);

  const spike = classifyRegime(28, 24);
  assert.equal(spike.contango, false);
  assert.equal(spike.allowNewEntries, false);
  assert.equal(spike.label, 'PAUSE');

  const extreme = classifyRegime(40, 45); // contango but VIX above the hard cap
  assert.equal(extreme.allowNewEntries, false);
});

test('missing data degrades gracefully', () => {
  const r = classifyRegime(null, null, DEFAULT_REGIME_CONFIG);
  assert.equal(r.sizeMultiplier, 1);
  assert.equal(r.allowNewEntries, true);
  assert.equal(r.termStructureRatio, null);
});
