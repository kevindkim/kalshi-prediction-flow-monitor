import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBullPutCloseOrder, buildBullPutOpenOrder } from '../src/schwab/spread-orders';

const legs = { shortSymbol: 'SPY   261120P00640000', longSymbol: 'SPY   261120P00630000', quantity: 2 };

test('open order matches the schwab-py bull_put_vertical_open template', () => {
  const order = buildBullPutOpenOrder(legs, 1.25);
  assert.deepEqual(order, {
    orderType: 'NET_CREDIT',
    session: 'NORMAL',
    price: '1.25',
    quantity: 2,
    duration: 'DAY',
    orderStrategyType: 'SINGLE',
    complexOrderStrategyType: 'VERTICAL',
    orderLegCollection: [
      { instruction: 'BUY_TO_OPEN', quantity: 2, instrument: { symbol: legs.longSymbol, assetType: 'OPTION' } },
      { instruction: 'SELL_TO_OPEN', quantity: 2, instrument: { symbol: legs.shortSymbol, assetType: 'OPTION' } },
    ],
  });
});

test('close order is a GTC NET_DEBIT that reverses both legs', () => {
  const order = buildBullPutCloseOrder(legs, 0.625);
  assert.equal(order.orderType, 'NET_DEBIT');
  assert.equal(order.duration, 'GOOD_TILL_CANCEL');
  assert.equal(order.price, '0.63');
  assert.deepEqual(
    order.orderLegCollection.map((l) => l.instruction),
    ['SELL_TO_CLOSE', 'BUY_TO_CLOSE']
  );
});

test('attaching a 50% profit target produces a TRIGGER with a GTC child at half the credit', () => {
  const order = buildBullPutOpenOrder(legs, 3.0, { profitTargetPct: 0.5 });
  assert.equal(order.orderStrategyType, 'TRIGGER');
  assert.equal(order.childOrderStrategies?.length, 1);
  const child = order.childOrderStrategies![0];
  assert.equal(child.orderType, 'NET_DEBIT');
  assert.equal(child.price, '1.50');
  assert.equal(child.duration, 'GOOD_TILL_CANCEL');
});

test('rejects nonsense prices', () => {
  assert.throws(() => buildBullPutOpenOrder(legs, 0));
  assert.throws(() => buildBullPutCloseOrder(legs, -1));
});
