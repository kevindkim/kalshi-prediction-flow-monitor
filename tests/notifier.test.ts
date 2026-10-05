import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildCloseAlert, buildOpportunityAlert, Notifier } from '../src/schwab/notifier';
import { bestPerExpiration, buildCandidates } from '../src/schwab/put-spread-scanner';
import { evaluateSpread, pairPutSpreads } from '../src/schwab/position-monitor';
import { fillCreditFromOrder } from '../src/schwab/put-spread-monitor';
import { optionPosition, spyChain, testConfig } from './fixtures';
import { formatOptionSymbol } from '../src/schwab/option-symbol';
import { PlacedOrder } from '../src/schwab/schwab-types';

test('opportunity alert includes a ready-to-run open command sized to risk', () => {
  const cfg = testConfig();
  const best = bestPerExpiration(
    buildCandidates(spyChain(), { symbol: 'SPY', price: 600, closes: [], smas: { 50: 585, 200: 560 }, hv20: 18, nextEarnings: null }, cfg)
  );
  const alert = buildOpportunityAlert(best, cfg, 100_000);
  assert.match(alert.subject, /SPY \d+\/\d+ \d+% ROR/);
  assert.match(alert.text, /npm run spreads -- open SPY 2026-11-20 \d+ \d+ --qty \d+ --credit \d+\.\d{2} --confirm/);
  assert.match(alert.text, /GTC close at 50%/);
});

test('close alert offers both "take it now" and "GTC at target" commands', () => {
  const cfg = testConfig();
  const EXP = '2026-11-20';
  const spread = { ...pairPutSpreads([optionPosition('META', EXP, 200, -1, 5.0), optionPosition('META', EXP, 190, 1, 2.0)])[0], dte: 30 };
  const shortSym = formatOptionSymbol('META', EXP, 'PUT', 200);
  const longSym = formatOptionSymbol('META', EXP, 'PUT', 190);
  const q = (bid: number, ask: number) => ({ assetMainType: 'OPTION', symbol: 'x', quote: { bidPrice: bid, askPrice: ask, lastPrice: 0, mark: 0, closePrice: 0 } });
  const status = evaluateSpread(spread, { [shortSym]: q(2.0, 2.1), [longSym]: q(0.65, 0.75) }, cfg, 230, false);
  const alert = buildCloseAlert([status], cfg);
  assert.match(alert.subject, /META 200\/190: 55% captured — TAKE PROFIT/);
  assert.match(alert.text, /close META_2026-11-20_200\/190 --debit 1\.35 --confirm/);
  assert.match(alert.text, /close META_2026-11-20_200\/190 --pct 0\.5 --confirm/);
});

test('notifier honours cooldown using its state file and stays quiet without channels', async () => {
  const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'alerts-')), 'state.json');
  const notifier = new Notifier({ statePath });
  assert.deepEqual(notifier.channels, []);
  const sent = await notifier.send({ key: 'k', subject: 's', text: 't' }, 1);
  assert.equal(sent, false); // no channels configured → logged, not sent
});

test('fillCreditFromOrder nets the executed leg prices', () => {
  const order = {
    orderLegCollection: [
      { instruction: 'BUY_TO_OPEN', quantity: 2, instrument: { symbol: 'L', assetType: 'OPTION' } },
      { instruction: 'SELL_TO_OPEN', quantity: 2, instrument: { symbol: 'S', assetType: 'OPTION' } },
    ],
    orderActivityCollection: [
      {
        executionType: 'FILL',
        quantity: 2,
        executionLegs: [
          { legId: 1, price: 2.0, quantity: 2, time: '' },
          { legId: 2, price: 3.3, quantity: 2, time: '' },
        ],
      },
    ],
  } as unknown as PlacedOrder;
  assert.equal(fillCreditFromOrder(order), 1.3);
  assert.equal(fillCreditFromOrder({ orderLegCollection: [], orderActivityCollection: [] } as unknown as PlacedOrder), null);
});
