import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestPerExpiration, buildCandidates, isGoodPremium, UnderlyingContext } from '../src/schwab/put-spread-scanner';
import { spyChain, testConfig } from './fixtures';

const ctx = (over: Partial<UnderlyingContext> = {}): UnderlyingContext => ({
  symbol: 'SPY',
  price: 600,
  closes: [],
  smas: { 50: 585, 200: 560 },
  hv20: 18,
  nextEarnings: null,
  ...over,
});

test('builds only OTM spreads inside the delta, width and credit/width bands', () => {
  const cands = buildCandidates(spyChain(), ctx(), testConfig());
  assert.ok(cands.length > 0);
  for (const c of cands) {
    assert.ok(c.shortDelta >= 0.16 && c.shortDelta <= 0.3, `delta ${c.shortDelta}`);
    assert.ok(c.width >= 2.5 && c.width <= 10, `width ${c.width}`);
    assert.ok(c.creditToWidth >= 0.2, `credit/width ${c.creditToWidth}`);
    assert.ok(c.shortStrike < 600);
    assert.ok(c.longStrike < c.shortStrike);
    assert.equal(c.dte, 45);
    assert.ok(c.score >= 0 && c.score <= 100);
  }
  // the 585 strike (delta .36) and 560 strike (delta .13) must never be the short leg
  assert.ok(!cands.some((c) => c.shortStrike === 585 || c.shortStrike === 560));
});

test('drops expirations outside the DTE window and spreads with thin liquidity', () => {
  assert.equal(buildCandidates(spyChain('2026-10-17', 12), ctx(), testConfig()).length, 0);
  const thin = spyChain('2026-11-20', 45, [
    { strike: 565, bid: 2.5, ask: 2.6, delta: -0.16, oi: 50 },
    { strike: 570, bid: 3.25, ask: 3.35, delta: -0.2, oi: 50 },
    { strike: 575, bid: 4.2, ask: 4.3, delta: -0.25, oi: 50 },
  ]);
  assert.equal(buildCandidates(thin, ctx(), testConfig()).length, 0);
  const wide = spyChain('2026-11-20', 45, [
    { strike: 565, bid: 2.0, ask: 3.1, delta: -0.16 },
    { strike: 575, bid: 3.8, ask: 4.7, delta: -0.25 },
  ]);
  assert.equal(buildCandidates(wide, ctx(), testConfig()).length, 0);
});

test('earnings before expiration blocks the spread when blackout is on, penalises score when off', () => {
  const withEarnings = ctx({ nextEarnings: '2026-11-01' });
  assert.equal(buildCandidates(spyChain(), withEarnings, testConfig()).length, 0);
  const allowed = buildCandidates(spyChain(), withEarnings, testConfig({ earningsBlackout: false }));
  const clean = buildCandidates(spyChain(), ctx(), testConfig());
  assert.ok(allowed.length > 0);
  assert.ok(allowed[0].earningsInWindow);
  assert.ok(allowed[0].score < clean.find((c) => c.id === allowed[0].id)!.score);
  assert.ok(!isGoodPremium(allowed[0], testConfig({ earningsBlackout: false })));
  // earnings after expiration is fine
  assert.ok(buildCandidates(spyChain(), ctx({ nextEarnings: '2026-12-10' }), testConfig()).length > 0);
});

test('weak trend or IV below realized vol disqualifies a candidate from alerts', () => {
  const good = bestPerExpiration(buildCandidates(spyChain(), ctx(), testConfig()))[0];
  assert.ok(isGoodPremium(good, testConfig()), `score ${good.score}`);
  const belowSma = bestPerExpiration(buildCandidates(spyChain(), ctx({ smas: { 50: 610, 200: 560 } }), testConfig()))[0];
  assert.equal(belowSma.trendOk, false);
  assert.ok(!isGoodPremium(belowSma, testConfig()));
  const cheapIv = bestPerExpiration(buildCandidates(spyChain(), ctx({ hv20: 40 }), testConfig()))[0];
  assert.ok(cheapIv.ivToHv! < 1);
  assert.ok(!isGoodPremium(cheapIv, testConfig()));
});

test('NaN greeks are skipped instead of crashing', () => {
  const chain = spyChain('2026-11-20', 45, [
    { strike: 565, bid: 2.5, ask: 2.6, delta: 'NaN' },
    { strike: 575, bid: 4.2, ask: 4.3, delta: -0.25 },
  ]);
  const cands = buildCandidates(chain, ctx(), testConfig());
  assert.ok(cands.every((c) => c.shortStrike === 575));
});

test('bestPerExpiration keeps one spread per underlying/expiration, highest score first', () => {
  const cands = buildCandidates(spyChain(), ctx(), testConfig());
  assert.ok(cands.length > 1);
  const best = bestPerExpiration(cands);
  assert.equal(best.length, 1);
  assert.equal(best[0].score, Math.max(...cands.map((c) => c.score)));
  // the alert-worthy spread must clear the 1/3-of-width rule even though cheaper ones are listed
  assert.ok(best[0].creditToWidth >= 0.33);
  assert.ok(cands.some((c) => c.creditToWidth < 0.33));
});
