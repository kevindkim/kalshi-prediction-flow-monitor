import { SchwabClient } from './schwab-client';
import { PlacedOrder, QuoteResponse, SchwabPosition } from './schwab-types';
import { StrategyConfig } from './strategy-config';
import { parseOptionSymbol } from './option-symbol';
import { daysBetween, profitCapturedPct, round2, stopLossDebit, targetCloseDebit } from './spread-math';

/**
 * Pairs short and long put legs from Schwab positions into bull put spreads
 * and decides which ones deserve a "close it" prompt.
 */
export interface OpenSpread {
  id: string;
  underlying: string;
  expiration: string;
  dte: number;
  shortStrike: number;
  longStrike: number;
  shortSymbol: string;
  longSymbol: string;
  quantity: number;
  width: number;
  openCredit: number; // per spread, from average prices
  maxProfit: number; // $ total
  maxLoss: number; // $ total
}

export interface SpreadStatus extends OpenSpread {
  currentMidDebit: number; // what it costs to close at mid now
  currentNaturalDebit: number; // shortAsk - longBid
  profitCaptured: number; // 0.55 = 55% of max profit
  unrealizedPnl: number; // $ total at mid
  targetCloseDebit: number;
  stopDebit: number;
  action:
    | 'HOLD'
    | 'TAKE_PROFIT'
    | 'TAKE_PROFIT_URGENT'
    | 'STOP_LOSS'
    | 'MANAGE_DTE'
    | 'SHORT_STRIKE_TESTED'
    | 'ASSIGNMENT_RISK';
  message: string;
  hasWorkingCloseOrder: boolean;
}

export function pairPutSpreads(positions: SchwabPosition[]): OpenSpread[] {
  type Leg = { symbol: string; underlying: string; expiration: string; strike: number; qty: number; avg: number };
  const shorts: Leg[] = [];
  const longs: Leg[] = [];

  for (const p of positions) {
    if (p.instrument.assetType !== 'OPTION') continue;
    const parsed = parseOptionSymbol(p.instrument.symbol);
    if (!parsed || parsed.putCall !== 'PUT') continue;
    const leg: Leg = {
      symbol: p.instrument.symbol,
      underlying: parsed.underlying,
      expiration: parsed.expiration,
      strike: parsed.strike,
      qty: p.shortQuantity > 0 ? p.shortQuantity : p.longQuantity,
      avg: p.averagePrice,
    };
    if (p.shortQuantity > 0) shorts.push(leg);
    else if (p.longQuantity > 0) longs.push(leg);
  }

  const spreads: OpenSpread[] = [];
  // Highest short strike first so each short grabs the nearest long below it.
  shorts.sort((a, b) => b.strike - a.strike);
  for (const s of shorts) {
    const partner = longs
      .filter((l) => l.underlying === s.underlying && l.expiration === s.expiration && l.strike < s.strike && l.qty > 0)
      .sort((a, b) => b.strike - a.strike)[0];
    if (!partner) continue;
    const qty = Math.min(s.qty, partner.qty);
    partner.qty -= qty;
    const width = round2(s.strike - partner.strike);
    const openCredit = round2(s.avg - partner.avg);
    const today = new Date().toISOString().slice(0, 10);
    spreads.push({
      id: `${s.underlying}_${s.expiration}_${s.strike}/${partner.strike}`,
      underlying: s.underlying,
      expiration: s.expiration,
      dte: daysBetween(today, s.expiration),
      shortStrike: s.strike,
      longStrike: partner.strike,
      shortSymbol: s.symbol,
      longSymbol: partner.symbol,
      quantity: qty,
      width,
      openCredit,
      maxProfit: round2(openCredit * 100 * qty),
      maxLoss: round2((width - openCredit) * 100 * qty),
    });
  }
  return spreads;
}

export function evaluateSpread(
  spread: OpenSpread,
  quotes: QuoteResponse,
  cfg: StrategyConfig,
  underlyingPrice: number | null,
  hasWorkingCloseOrder: boolean
): SpreadStatus {
  const sq = quotes[spread.shortSymbol]?.quote;
  const lq = quotes[spread.longSymbol]?.quote;
  if (!sq || !lq) throw new Error(`Missing quotes for ${spread.id}`);

  const shortMid = (sq.bidPrice + sq.askPrice) / 2;
  const longMid = (lq.bidPrice + lq.askPrice) / 2;
  const currentMidDebit = round2(Math.max(0, shortMid - longMid));
  const currentNaturalDebit = round2(Math.max(0, sq.askPrice - lq.bidPrice));
  const captured = profitCapturedPct(spread.openCredit, currentMidDebit);
  const unrealized = round2((spread.openCredit - currentMidDebit) * 100 * spread.quantity);
  const target = targetCloseDebit(spread.openCredit, cfg.profitTargetPct, cfg.priceTick);
  const stop = stopLossDebit(spread.openCredit, cfg.stopLossMultiple, cfg.priceTick);

  let action: SpreadStatus['action'] = 'HOLD';
  let message = `Holding: ${Math.round(captured * 100)}% of max profit captured, ${spread.dte} DTE`;

  if (underlyingPrice !== null && underlyingPrice <= spread.shortStrike && spread.dte <= 1) {
    action = 'ASSIGNMENT_RISK';
    message = `Short ${spread.shortStrike}P is in the money with ${spread.dte} DTE — close the whole spread today to avoid assignment/pin risk`;
  } else if (currentMidDebit >= stop) {
    action = 'STOP_LOSS';
    message = `Spread is worth ${currentMidDebit.toFixed(2)} vs ${spread.openCredit.toFixed(2)} credit (${cfg.stopLossMultiple}x) — consider closing to cap the loss`;
  } else if (captured >= cfg.profitPromptMaxPct) {
    action = 'TAKE_PROFIT_URGENT';
    message = `${Math.round(captured * 100)}% of max profit captured — past the ${Math.round(
      cfg.profitPromptMaxPct * 100
    )}% ceiling; remaining ${round2(currentMidDebit * 100 * spread.quantity)} of credit is not worth the tail risk`;
  } else if (captured >= cfg.profitPromptMinPct) {
    action = 'TAKE_PROFIT';
    message = `${Math.round(captured * 100)}% of max profit captured — in the ${Math.round(cfg.profitPromptMinPct * 100)}–${Math.round(
      cfg.profitPromptMaxPct * 100
    )}% take-profit zone`;
  } else if (underlyingPrice !== null && underlyingPrice <= spread.shortStrike) {
    action = 'SHORT_STRIKE_TESTED';
    message = `Underlying ${underlyingPrice.toFixed(2)} is at/below the short ${spread.shortStrike} strike — decide: roll, close, or hold`;
  } else if (spread.dte <= cfg.manageDte) {
    action = 'MANAGE_DTE';
    message = `${spread.dte} DTE ≤ ${cfg.manageDte}: gamma risk rising — close or roll even though only ${Math.round(captured * 100)}% captured`;
  }

  return {
    ...spread,
    currentMidDebit,
    currentNaturalDebit,
    profitCaptured: round2(captured),
    unrealizedPnl: unrealized,
    targetCloseDebit: target,
    stopDebit: stop,
    action,
    message,
    hasWorkingCloseOrder,
  };
}

/** Does a working/queued order already buy back this spread's short leg? */
export function hasWorkingClose(spread: OpenSpread, orders: PlacedOrder[]): boolean {
  const active = new Set(['WORKING', 'QUEUED', 'ACCEPTED', 'PENDING_ACTIVATION', 'AWAITING_PARENT_ORDER']);
  const matches = (o: PlacedOrder): boolean =>
    active.has(o.status) &&
    (o.orderLegCollection ?? []).some(
      (leg) => leg.instrument.symbol === spread.shortSymbol && leg.instruction === 'BUY_TO_CLOSE'
    );
  return orders.some((o) => matches(o) || (o.childOrderStrategies ?? []).some((c) => matches(c as PlacedOrder)));
}

export class PositionMonitor {
  constructor(private readonly client: SchwabClient, private readonly cfg: StrategyConfig) {}

  async snapshot(accountHash: string): Promise<{ statuses: SpreadStatus[]; accountValue: number | null }> {
    const [account, orders] = await Promise.all([
      this.client.getAccountWithPositions(accountHash),
      this.client.getOrders(accountHash, 59).catch((e) => {
        console.warn('⚠️ Could not load orders:', (e as Error).message);
        return [] as PlacedOrder[];
      }),
    ]);
    const positions = account.securitiesAccount.positions ?? [];
    const spreads = pairPutSpreads(positions);
    if (spreads.length === 0) return { statuses: [], accountValue: account.securitiesAccount.currentBalances?.liquidationValue ?? null };

    const symbols = new Set<string>();
    for (const s of spreads) {
      symbols.add(s.shortSymbol);
      symbols.add(s.longSymbol);
      symbols.add(s.underlying);
    }
    const quotes = await this.client.getQuotes([...symbols]);

    const statuses = spreads.map((s) =>
      evaluateSpread(s, quotes, this.cfg, quotes[s.underlying]?.quote?.lastPrice ?? null, hasWorkingClose(s, orders))
    );
    return { statuses, accountValue: account.securitiesAccount.currentBalances?.liquidationValue ?? null };
  }
}
