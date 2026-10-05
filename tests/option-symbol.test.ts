import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatOptionSymbol, parseOptionSymbol } from '../src/schwab/option-symbol';

test('formats OCC symbols with 6-char padded root and 8-digit strike', () => {
  assert.equal(formatOptionSymbol('AAPL', '2025-10-17', 'PUT', 230), 'AAPL  251017P00230000');
  assert.equal(formatOptionSymbol('SPY', '2026-11-20', 'PUT', 640), 'SPY   261120P00640000');
  assert.equal(formatOptionSymbol('SPXW', '2026-01-16', 'CALL', 5040.5), 'SPXW  260116C05040500');
});

test('parses symbols back into their parts', () => {
  assert.deepEqual(parseOptionSymbol('AAPL  251017P00230000'), {
    underlying: 'AAPL',
    expiration: '2025-10-17',
    putCall: 'PUT',
    strike: 230,
  });
  assert.equal(parseOptionSymbol('AAPL'), null);
  assert.equal(parseOptionSymbol('AAPL  251017X00230000'), null);
});

test('round-trips', () => {
  const sym = formatOptionSymbol('META', '2025-11-07', 'PUT', 192.5);
  assert.deepEqual(parseOptionSymbol(sym), { underlying: 'META', expiration: '2025-11-07', putCall: 'PUT', strike: 192.5 });
});
