import { OrderLeg, SchwabOrder } from './schwab-types';
import { roundToTick, targetCloseDebit } from './spread-math';

/** Schwab accepts price as a string; two decimals covers the penny-increment names this strategy trades. */
export function formatPrice(price: number): string {
  return price.toFixed(2);
}

/**
 * Order JSON builders for Schwab vertical put spreads.
 *
 * Opening a bull put spread = SELL_TO_OPEN the higher strike put and
 * BUY_TO_OPEN the lower strike put for a NET_CREDIT. Closing reverses both
 * legs for a NET_DEBIT. Both are complexOrderStrategyType VERTICAL.
 *
 * When a profit target is attached, the open order becomes a TRIGGER
 * (first-triggers-second) whose child is a GOOD_TILL_CANCEL NET_DEBIT close
 * at the target debit. Schwab documents TRIGGER for equities; whether a
 * NET_CREDIT VERTICAL parent may carry a NET_DEBIT VERTICAL child is not
 * confirmed, so the CLI defaults to "place open → wait for fill → place GTC
 * close" and only uses this variant behind --trigger. Validate it with
 * previewOrder first.
 */
export interface SpreadLegs {
  shortSymbol: string; // higher strike put, sold
  longSymbol: string; // lower strike put, bought
  quantity: number;
}

function legs(spread: SpreadLegs, opening: boolean): OrderLeg[] {
  const shortInstruction = opening ? 'SELL_TO_OPEN' : 'BUY_TO_CLOSE';
  const longInstruction = opening ? 'BUY_TO_OPEN' : 'SELL_TO_CLOSE';
  // Same leg order as schwab-py's bull_put_vertical_open/close templates.
  return [
    {
      instruction: longInstruction,
      quantity: spread.quantity,
      instrument: { symbol: spread.longSymbol, assetType: 'OPTION' },
    },
    {
      instruction: shortInstruction,
      quantity: spread.quantity,
      instrument: { symbol: spread.shortSymbol, assetType: 'OPTION' },
    },
  ];
}

export function buildBullPutCloseOrder(
  spread: SpreadLegs,
  netDebit: number,
  duration: 'DAY' | 'GOOD_TILL_CANCEL' = 'GOOD_TILL_CANCEL',
  tick = 0.01
): SchwabOrder {
  if (netDebit < 0) throw new Error('Close debit must be >= 0');
  return {
    orderType: 'NET_DEBIT',
    session: 'NORMAL',
    price: formatPrice(roundToTick(netDebit, tick)),
    quantity: spread.quantity,
    duration,
    orderStrategyType: 'SINGLE',
    complexOrderStrategyType: 'VERTICAL',
    orderLegCollection: legs(spread, false),
  };
}

export interface OpenOrderOptions {
  duration?: 'DAY' | 'GOOD_TILL_CANCEL';
  /** Fraction of credit to lock in with an attached GTC close, e.g. 0.5. Omit to skip. */
  profitTargetPct?: number;
  tick?: number;
}

export function buildBullPutOpenOrder(spread: SpreadLegs, netCredit: number, opts: OpenOrderOptions = {}): SchwabOrder {
  if (netCredit <= 0) throw new Error('Open credit must be > 0');
  const tick = opts.tick ?? 0.01;
  const base: SchwabOrder = {
    orderType: 'NET_CREDIT',
    session: 'NORMAL',
    price: formatPrice(roundToTick(netCredit, tick)),
    quantity: spread.quantity,
    duration: opts.duration ?? 'DAY',
    orderStrategyType: 'SINGLE',
    complexOrderStrategyType: 'VERTICAL',
    orderLegCollection: legs(spread, true),
  };
  if (opts.profitTargetPct === undefined) return base;

  const closeDebit = targetCloseDebit(netCredit, opts.profitTargetPct, tick);
  return {
    ...base,
    orderStrategyType: 'TRIGGER',
    childOrderStrategies: [buildBullPutCloseOrder(spread, Math.max(closeDebit, tick), 'GOOD_TILL_CANCEL', tick)],
  };
}
