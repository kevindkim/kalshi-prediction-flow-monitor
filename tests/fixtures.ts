import { OptionChainResponse, OptionContract, SchwabPosition } from '../src/schwab/schwab-types';
import { StrategyConfig } from '../src/schwab/strategy-config';
import { formatOptionSymbol } from '../src/schwab/option-symbol';

export function testConfig(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
  return {
    watchlist: ['SPY'],
    minDte: 30,
    maxDte: 50,
    targetDte: 45,
    manageDte: 21,
    minShortDelta: 0.16,
    maxShortDelta: 0.3,
    minWidth: 2.5,
    maxWidth: 10,
    minCreditToWidth: 0.2,
    goodCreditToWidth: 0.33,
    minOpenInterest: 500,
    minVolume: 50,
    minExpectedValue: 5,
    maxBidAskPct: 0.1,
    maxBidAskAbs: 0.1,
    minIvToHvRatio: 1.0,
    minIvRank: 30,
    trendSmaPeriods: [50, 200],
    indexSymbols: ['SPY', 'QQQ', 'IWM'],
    expectedSlippage: 0.05,
    earningsBlackout: true,
    profitTargetPct: 0.5,
    profitPromptMinPct: 0.5,
    profitPromptMaxPct: 0.65,
    stopLossMultiple: 2,
    riskPerTradePct: 0.02,
    maxAggregateRiskPct: 0.1,
    maxOpenSpreads: 10,
    maxPerUnderlying: 1,
    goodPremiumMinScore: 65,
    maxAlertsPerScan: 5,
    alertCooldownHours: 20,
    attachProfitTargetOnOpen: true,
    priceTick: 0.01,
    ...overrides,
  };
}

export interface ContractSpec {
  strike: number;
  bid: number;
  ask: number;
  delta: number | 'NaN';
  oi?: number;
  volume?: number;
  iv?: number;
}

export function contract(symbol: string, expiration: string, dte: number, spec: ContractSpec): OptionContract {
  return {
    putCall: 'PUT',
    symbol: formatOptionSymbol(symbol, expiration, 'PUT', spec.strike),
    description: `${symbol} ${expiration} ${spec.strike} P`,
    bid: spec.bid,
    ask: spec.ask,
    last: (spec.bid + spec.ask) / 2,
    mark: (spec.bid + spec.ask) / 2,
    bidSize: 10,
    askSize: 10,
    totalVolume: spec.volume ?? 500,
    openInterest: spec.oi ?? 2000,
    volatility: spec.iv ?? 25,
    delta: spec.delta,
    gamma: 0.01,
    theta: -0.05,
    vega: 0.2,
    strikePrice: spec.strike,
    expirationDate: `${expiration}T20:00:00Z`,
    daysToExpiration: dte,
    inTheMoney: false,
    multiplier: 100,
  };
}

/** SPY at 600 with a plausible 45 DTE put ladder. */
export function spyChain(expiration = '2026-11-20', dte = 45, specs?: ContractSpec[]): OptionChainResponse {
  const ladder: ContractSpec[] = specs ?? [
    { strike: 550, bid: 1.1, ask: 1.2, delta: -0.08 },
    { strike: 555, bid: 1.45, ask: 1.55, delta: -0.1 },
    { strike: 560, bid: 1.9, ask: 2.0, delta: -0.13 },
    { strike: 565, bid: 2.5, ask: 2.6, delta: -0.16 },
    { strike: 570, bid: 3.25, ask: 3.35, delta: -0.2 },
    { strike: 575, bid: 4.7, ask: 4.8, delta: -0.25 },
    { strike: 580, bid: 6.5, ask: 6.6, delta: -0.3 },
    { strike: 585, bid: 8.3, ask: 8.4, delta: -0.36 },
  ];
  const strikes: Record<string, OptionContract[]> = {};
  for (const s of ladder) strikes[`${s.strike}.0`] = [contract('SPY', expiration, dte, s)];
  return {
    symbol: 'SPY',
    status: 'SUCCESS',
    underlyingPrice: 600,
    underlying: { symbol: 'SPY', last: 600, mark: 600, bid: 599.9, ask: 600.1, close: 598 },
    putExpDateMap: { [`${expiration}:${dte}`]: strikes },
    callExpDateMap: {},
  };
}

export function optionPosition(symbol: string, expiration: string, strike: number, qty: number, avg: number): SchwabPosition {
  return {
    shortQuantity: qty < 0 ? -qty : 0,
    longQuantity: qty > 0 ? qty : 0,
    averagePrice: avg,
    marketValue: 0,
    instrument: {
      assetType: 'OPTION',
      symbol: formatOptionSymbol(symbol, expiration, 'PUT', strike),
      putCall: 'PUT',
      underlyingSymbol: symbol,
    },
  };
}
