/**
 * Pure math for bull put credit spreads. No I/O so it is easy to unit test.
 *
 * Conventions: prices are per-share option prices (e.g. 1.25), one contract
 * controls 100 shares, so dollar values multiply by 100.
 */

export const CONTRACT_MULTIPLIER = 100;

export interface LegQuote {
  bid: number;
  ask: number;
}

export function mid(q: LegQuote): number {
  return (q.bid + q.ask) / 2;
}

/** Credit if you sell the short leg at bid and buy the long leg at ask. */
export function naturalCredit(shortLeg: LegQuote, longLeg: LegQuote): number {
  return round2(shortLeg.bid - longLeg.ask);
}

/** Credit at both legs' midpoints; the usual starting limit price. */
export function midCredit(shortLeg: LegQuote, longLeg: LegQuote): number {
  return round2(mid(shortLeg) - mid(longLeg));
}

export function spreadWidth(shortStrike: number, longStrike: number): number {
  return round2(shortStrike - longStrike);
}

export function maxProfitDollars(credit: number, contracts = 1): number {
  return round2(credit * CONTRACT_MULTIPLIER * contracts);
}

export function maxLossDollars(width: number, credit: number, contracts = 1): number {
  return round2((width - credit) * CONTRACT_MULTIPLIER * contracts);
}

/** Return on risk = credit / (width - credit). 0.33 means you make $1 for every $3 risked. */
export function returnOnRisk(width: number, credit: number): number {
  const risk = width - credit;
  return risk <= 0 ? Infinity : credit / risk;
}

export function annualizedReturnOnRisk(width: number, credit: number, dte: number): number {
  if (dte <= 0) return 0;
  return returnOnRisk(width, credit) * (365 / dte);
}

export function breakeven(shortStrike: number, credit: number): number {
  return round2(shortStrike - credit);
}

/** Probability the short strike expires OTM ≈ 1 - |delta|. */
export function probabilityOtmFromDelta(shortDelta: number): number {
  return clamp(1 - Math.abs(shortDelta), 0, 1);
}

/** tastytrade's shortcut for probability of profit on a credit spread: 1 - credit/width. */
export function probabilityOfProfit(width: number, credit: number): number {
  if (width <= 0) return 0;
  return clamp(1 - credit / width, 0, 1);
}

/**
 * Expected value per spread in dollars using a binary outcome model
 * (full credit kept with probability p, full loss otherwise). Crude but
 * useful to rank candidates against each other.
 */
export function expectedValueDollars(width: number, credit: number, pop: number): number {
  return round2(pop * maxProfitDollars(credit) - (1 - pop) * maxLossDollars(width, credit));
}

/** Fraction of the opening credit that has been captured: (credit - debitToClose) / credit. */
export function profitCapturedPct(openCredit: number, currentDebit: number): number {
  if (openCredit <= 0) return 0;
  return (openCredit - currentDebit) / openCredit;
}

/** Debit at which pct of the max profit has been captured, e.g. 50% of a 1.00 credit = 0.50. */
export function targetCloseDebit(openCredit: number, pct: number, tick = 0.01): number {
  return roundToTick(openCredit * (1 - pct), tick);
}

/** Debit at which the loss equals `multiple` x credit received (2.0 => debit = 3 x credit? no: see below). */
export function stopLossDebit(openCredit: number, stopLossMultiple: number, tick = 0.01): number {
  // "Close at 2x credit" in common usage means: close when the spread is worth
  // 2x what you sold it for (debit = 2 * credit, i.e. a loss equal to 1x credit).
  return roundToTick(openCredit * stopLossMultiple, tick);
}

/** Number of spreads so that max loss ≤ riskPct of account value. */
export function contractsForRisk(accountValue: number, riskPct: number, width: number, credit: number): number {
  const perSpreadRisk = maxLossDollars(width, credit);
  if (perSpreadRisk <= 0) return 0;
  return Math.max(0, Math.floor((accountValue * riskPct) / perSpreadRisk));
}

export function sma(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** Annualized historical (realized) volatility from daily closes, in percent to match Schwab's IV field. */
export function historicalVolatilityPct(closes: number[], period = 20): number | null {
  if (closes.length < period + 1) return null;
  const recent = closes.slice(-(period + 1));
  const logReturns: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    if (recent[i - 1] > 0 && recent[i] > 0) logReturns.push(Math.log(recent[i] / recent[i - 1]));
  }
  if (logReturns.length < 2) return null;
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance = logReturns.reduce((a, r) => a + (r - mean) ** 2, 0) / (logReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

export function bidAskSpreadPct(q: LegQuote): number {
  const m = mid(q);
  return m <= 0 ? Infinity : (q.ask - q.bid) / m;
}

export function roundToTick(value: number, tick: number): number {
  if (tick <= 0) return round2(value);
  return round2(Math.round(value / tick) * tick);
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100 + 0; // + 0 turns -0 into 0
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  return Math.round((to - from) / 86_400_000);
}
