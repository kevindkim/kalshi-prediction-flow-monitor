import 'dotenv/config';

/**
 * Bull put credit spread strategy parameters.
 *
 * Defaults follow the research summarised in docs/put-spread-strategy-research.md:
 *   - enter ~45 DTE, manage/close by 21 DTE
 *   - short strike delta 0.16–0.30 (≈70–84% probability OTM)
 *   - list spreads collecting ≥ 20% of width; alert only at ≥ 1/3 of width (tastytrade rule)
 *   - take profit at 50% of max credit, prompt between 50% and 65%
 *   - stop out at 2x credit received (i.e. loss = 100% of credit, 200% of credit as closing debit)
 *   - risk 1% of account per spread, ≤ 10% of account at risk across all spreads, max 10 names
 *   - trend (above 50/200 SMA) is a hard gate for single stocks and a half-size factor for index ETFs
 *   - expected value is computed net of ~$0.05 of slippage per spread
 * See docs/quant-strategy-research.md for the evidence behind each default.
 * Every value can be overridden with an environment variable.
 */
export interface StrategyConfig {
  watchlist: string[];
  minDte: number;
  maxDte: number;
  targetDte: number;
  manageDte: number;
  minShortDelta: number;
  maxShortDelta: number;
  minWidth: number;
  maxWidth: number;
  minCreditToWidth: number; // hard filter for listing candidates
  goodCreditToWidth: number; // the 1/3-width rule; required for a 'good premium' alert
  minOpenInterest: number;
  minVolume: number; // today's volume per leg
  minExpectedValue: number; // $ per spread, binary-outcome EV; ~slippage
  maxBidAskPct: number; // bid-ask spread as fraction of mid, per leg
  maxBidAskAbs: number; // or absolute dollars, whichever is looser
  minIvToHvRatio: number; // implied vs 20-day realized vol; >1 = premium rich
  minIvRank: number; // only used when an external IV rank is provided
  trendSmaPeriods: number[]; // underlying must be above all of these
  indexSymbols: string[]; // ETFs where a weak trend halves size instead of rejecting
  expectedSlippage: number; // $/share per spread taken off the credit before computing EV
  earningsBlackout: boolean;
  profitTargetPct: number; // 0.50
  profitPromptMinPct: number; // 0.50
  profitPromptMaxPct: number; // 0.65
  stopLossMultiple: number; // close when debit >= credit * (1 + multiple) → 2.0 = 2x credit
  riskPerTradePct: number; // of account liquidation value, max loss per spread
  maxAggregateRiskPct: number; // sum of max losses across open spreads, as a fraction of account
  maxOpenSpreads: number;
  maxPerUnderlying: number;
  goodPremiumMinScore: number; // 0-100 scanner score needed to notify
  maxAlertsPerScan: number;
  alertCooldownHours: number;
  attachProfitTargetOnOpen: boolean;
  priceTick: number; // 0.01 for penny-increment names, 0.05 otherwise
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (Number.isNaN(value)) throw new Error(`${name} must be numeric, got "${raw}"`);
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function list(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export const DEFAULT_WATCHLIST = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'AMD', 'IWM'];

export function loadStrategyConfig(): StrategyConfig {
  const watchlist = list('SPREAD_WATCHLIST', DEFAULT_WATCHLIST);
  if (watchlist.length > 10) {
    console.warn(`⚠️ Watchlist has ${watchlist.length} names; scanning more than ~10 can hit Schwab's 120 req/min limit.`);
  }
  return {
    watchlist,
    minDte: num('SPREAD_MIN_DTE', 30),
    maxDte: num('SPREAD_MAX_DTE', 50),
    targetDte: num('SPREAD_TARGET_DTE', 45),
    manageDte: num('SPREAD_MANAGE_DTE', 21),
    minShortDelta: num('SPREAD_MIN_SHORT_DELTA', 0.16),
    maxShortDelta: num('SPREAD_MAX_SHORT_DELTA', 0.3),
    minWidth: num('SPREAD_MIN_WIDTH', 2.5),
    maxWidth: num('SPREAD_MAX_WIDTH', 10),
    minCreditToWidth: num('SPREAD_MIN_CREDIT_TO_WIDTH', 0.2),
    goodCreditToWidth: num('SPREAD_GOOD_CREDIT_TO_WIDTH', 0.33),
    minOpenInterest: num('SPREAD_MIN_OPEN_INTEREST', 500),
    minVolume: num('SPREAD_MIN_VOLUME', 50),
    minExpectedValue: num('SPREAD_MIN_EXPECTED_VALUE', 5),
    maxBidAskPct: num('SPREAD_MAX_BID_ASK_PCT', 0.1),
    maxBidAskAbs: num('SPREAD_MAX_BID_ASK_ABS', 0.1),
    minIvToHvRatio: num('SPREAD_MIN_IV_HV_RATIO', 1.0),
    minIvRank: num('SPREAD_MIN_IV_RANK', 30),
    trendSmaPeriods: list('SPREAD_TREND_SMA_PERIODS', ['50', '200']).map(Number),
    indexSymbols: list('SPREAD_INDEX_SYMBOLS', ['SPY', 'QQQ', 'IWM', 'DIA', 'XSP', 'SPX']),
    expectedSlippage: num('SPREAD_EXPECTED_SLIPPAGE', 0.05),
    earningsBlackout: bool('SPREAD_EARNINGS_BLACKOUT', true),
    profitTargetPct: num('SPREAD_PROFIT_TARGET_PCT', 0.5),
    profitPromptMinPct: num('SPREAD_PROFIT_PROMPT_MIN_PCT', 0.5),
    profitPromptMaxPct: num('SPREAD_PROFIT_PROMPT_MAX_PCT', 0.65),
    stopLossMultiple: num('SPREAD_STOP_LOSS_MULTIPLE', 2.0),
    riskPerTradePct: num('SPREAD_RISK_PER_TRADE_PCT', 0.01),
    maxAggregateRiskPct: num('SPREAD_MAX_AGGREGATE_RISK_PCT', 0.1),
    maxOpenSpreads: num('SPREAD_MAX_OPEN', 10),
    maxPerUnderlying: num('SPREAD_MAX_PER_UNDERLYING', 1),
    goodPremiumMinScore: num('SPREAD_GOOD_PREMIUM_MIN_SCORE', 65),
    maxAlertsPerScan: num('SPREAD_MAX_ALERTS_PER_SCAN', 5),
    alertCooldownHours: num('SPREAD_ALERT_COOLDOWN_HOURS', 20),
    attachProfitTargetOnOpen: bool('SPREAD_ATTACH_PROFIT_TARGET', true),
    priceTick: num('SPREAD_PRICE_TICK', 0.01),
  };
}
