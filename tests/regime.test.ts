import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRegime, DEFAULT_REGIME_CONFIG, sizeMultiplierForVix } from '../src/schwab/regime';

test('VIX buckets scale size down as vol rises', () => {
  assert.equal(sizeMultiplierForVix(12), 1);
  assert.equal(sizeMultiplierForVix(15), 1);
  assert.equal(sizeMultiplierForVix(18), 0.75);
  assert.equal(sizeMultiplierForVix(24), 0.5);
  assert.equal(sizeMultiplierForVix(28), 0.25);
  assert.equal(sizeMultiplierForVix(45), 0.1);
  assert.equal(sizeMultiplierForVix(null), 1);
});

test('contango allows entries, backwardation pauses them', () => {
  const calm = classifyRegime(14, 17);
  assert.equal(calm.label, 'CALM');
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
