import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../src/schwab/spread-math';

test('credit, width, max profit/loss, return on risk', () => {
  const short = { bid: 3.25, ask: 3.35 };
  const long = { bid: 1.9, ask: 2.0 };
  assert.equal(m.midCredit(short, long), 1.35);
  assert.equal(m.naturalCredit(short, long), 1.25);
  assert.equal(m.spreadWidth(570, 560), 10);
  assert.equal(m.maxProfitDollars(1.35), 135);
  assert.equal(m.maxLossDollars(10, 1.35), 865);
  assert.equal(Number(m.returnOnRisk(5, 1.65).toFixed(3)), 0.493); // the 1/3-width rule ≈ 50% ROR
  assert.equal(m.breakeven(570, 1.35), 568.65);
});

test('probabilities and expected value', () => {
  assert.equal(m.probabilityOtmFromDelta(-0.2), 0.8);
  assert.equal(m.probabilityOfProfit(5, 1.5), 0.7);
  // $1.50 on a $5-wide at 70% POP is zero EV — the research brief's worked example
  assert.equal(m.expectedValueDollars(5, 1.5, 0.7), 0);
  assert.ok(m.expectedValueDollars(5, 1.65, 0.8) > 0);
});

test('profit capture and target/stop debits', () => {
  assert.equal(m.profitCapturedPct(1.0, 0.45), 0.55);
  assert.equal(m.targetCloseDebit(3.0, 0.5), 1.5);
  assert.equal(m.targetCloseDebit(1.27, 0.65), 0.44);
  assert.equal(m.stopLossDebit(1.0, 2), 2.0);
  assert.equal(m.roundToTick(1.234, 0.05), 1.25);
});

test('position sizing at 2% risk', () => {
  // $100k account, 2% = $2,000 risk; $5-wide at $1.65 credit risks $335/spread → 5 spreads
  assert.equal(m.contractsForRisk(100_000, 0.02, 5, 1.65), 5);
  assert.equal(m.contractsForRisk(10_000, 0.02, 5, 1.65), 0);
});

test('sma and realized volatility', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
  assert.equal(m.sma(closes, 50), 134.5);
  assert.equal(m.sma(closes, 200), null);
  const flat = Array(30).fill(100);
  assert.equal(m.historicalVolatilityPct(flat, 20), 0);
  const noisy = Array.from({ length: 30 }, (_, i) => 100 * (1 + (i % 2 === 0 ? 0.01 : -0.01)));
  const hv = m.historicalVolatilityPct(noisy, 20)!;
  assert.ok(hv > 20 && hv < 40, `hv=${hv}`);
});
