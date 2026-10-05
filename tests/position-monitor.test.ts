import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSpread, hasWorkingClose, pairPutSpreads } from '../src/schwab/position-monitor';
import { QuoteResponse, PlacedOrder } from '../src/schwab/schwab-types';
import { optionPosition, testConfig } from './fixtures';
import { formatOptionSymbol } from '../src/schwab/option-symbol';

const EXP = '2026-11-20';
const shortSym = formatOptionSymbol('META', EXP, 'PUT', 200);
const longSym = formatOptionSymbol('META', EXP, 'PUT', 190);

function quotes(shortBid: number, shortAsk: number, longBid: number, longAsk: number, underlying = 230): QuoteResponse {
  const q = (bid: number, ask: number) => ({
    assetMainType: 'OPTION',
    symbol: 'x',
    quote: { bidPrice: bid, askPrice: ask, lastPrice: (bid + ask) / 2, mark: (bid + ask) / 2, closePrice: 0 },
  });
  return {
    [shortSym]: q(shortBid, shortAsk),
    [longSym]: q(longBid, longAsk),
    META: { assetMainType: 'EQUITY', symbol: 'META', quote: { bidPrice: underlying, askPrice: underlying, lastPrice: underlying, mark: underlying, closePrice: underlying } },
  };
}

test('pairs short and long puts of the same underlying/expiration into spreads', () => {
  const spreads = pairPutSpreads([
    optionPosition('META', EXP, 200, -2, 5.0),
    optionPosition('META', EXP, 190, 2, 2.0),
    optionPosition('AAPL', EXP, 220, -1, 3.0), // no partner
    { ...optionPosition('MSFT', EXP, 400, 1, 1), instrument: { assetType: 'EQUITY', symbol: 'MSFT' } },
  ]);
  assert.equal(spreads.length, 1);
  const s = spreads[0];
  assert.equal(s.id, `META_${EXP}_200/190`);
  assert.equal(s.quantity, 2);
  assert.equal(s.width, 10);
  assert.equal(s.openCredit, 3);
  assert.equal(s.maxProfit, 600);
  assert.equal(s.maxLoss, 1400);
});

test('pairs each short with the nearest long below it and respects quantities', () => {
  const spreads = pairPutSpreads([
    optionPosition('SPY', EXP, 580, -3, 4.0),
    optionPosition('SPY', EXP, 575, 1, 3.0),
    optionPosition('SPY', EXP, 570, 2, 2.0),
  ]);
  assert.equal(spreads.length, 1);
  assert.equal(spreads[0].longStrike, 575);
  assert.equal(spreads[0].quantity, 1);
});

test('take-profit zone: prompts at 50%, escalates at 65%', () => {
  const base = pairPutSpreads([optionPosition('META', EXP, 200, -1, 5.0), optionPosition('META', EXP, 190, 1, 2.0)])[0];
  const spread = { ...base, dte: 30 };
  const cfg = testConfig();
  // credit 3.00; close now for 1.35 mid → 55% captured
  const tp = evaluateSpread(spread, quotes(2.0, 2.1, 0.65, 0.75), cfg, 230, false);
  assert.equal(tp.action, 'TAKE_PROFIT');
  assert.equal(tp.profitCaptured, 0.55);
  assert.equal(tp.targetCloseDebit, 1.5);
  assert.equal(tp.stopDebit, 6);
  // close for 0.90 → 70% captured
  const urgent = evaluateSpread(spread, quotes(1.3, 1.4, 0.4, 0.5), cfg, 230, false);
  assert.equal(urgent.action, 'TAKE_PROFIT_URGENT');
  // close for 2.40 → 20% captured, plenty of time: hold
  const hold = evaluateSpread(spread, quotes(3.4, 3.5, 1.0, 1.1), cfg, 230, false);
  assert.equal(hold.action, 'HOLD');
});

test('loss and time rules: 2x credit stop, 21 DTE management, tested short strike, assignment risk', () => {
  const base = pairPutSpreads([optionPosition('META', EXP, 200, -1, 5.0), optionPosition('META', EXP, 190, 1, 2.0)])[0];
  const cfg = testConfig();
  // spread now worth 6.20 ≥ 2 × 3.00
  assert.equal(evaluateSpread({ ...base, dte: 30 }, quotes(8.0, 8.2, 1.9, 2.0, 205), cfg, 205, false).action, 'STOP_LOSS');
  // 20 DTE, only 20% captured
  assert.equal(evaluateSpread({ ...base, dte: 20 }, quotes(3.4, 3.5, 1.0, 1.1), cfg, 230, false).action, 'MANAGE_DTE');
  // underlying through the short strike but loss not yet at stop
  assert.equal(evaluateSpread({ ...base, dte: 30 }, quotes(5.0, 5.2, 1.4, 1.5, 199), cfg, 199, false).action, 'SHORT_STRIKE_TESTED');
  // ITM with 1 DTE
  assert.equal(evaluateSpread({ ...base, dte: 1 }, quotes(5.0, 5.2, 1.4, 1.5, 199), cfg, 199, false).action, 'ASSIGNMENT_RISK');
});

test('detects a working GTC close order, including inside a TRIGGER child', () => {
  const spread = pairPutSpreads([optionPosition('META', EXP, 200, -1, 5.0), optionPosition('META', EXP, 190, 1, 2.0)])[0];
  const working = {
    orderId: 1,
    status: 'WORKING',
    orderLegCollection: [{ instruction: 'BUY_TO_CLOSE', quantity: 1, instrument: { symbol: shortSym, assetType: 'OPTION' } }],
  } as unknown as PlacedOrder;
  const filledParent = {
    orderId: 2,
    status: 'FILLED',
    orderLegCollection: [{ instruction: 'SELL_TO_OPEN', quantity: 1, instrument: { symbol: shortSym, assetType: 'OPTION' } }],
    childOrderStrategies: [working],
  } as unknown as PlacedOrder;
  const cancelled = { ...working, status: 'CANCELED' } as PlacedOrder;
  assert.equal(hasWorkingClose(spread, [working]), true);
  assert.equal(hasWorkingClose(spread, [filledParent]), true);
  assert.equal(hasWorkingClose(spread, [cancelled]), false);
  assert.equal(hasWorkingClose(spread, []), false);
});
