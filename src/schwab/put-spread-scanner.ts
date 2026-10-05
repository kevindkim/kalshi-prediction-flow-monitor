import { SchwabClient } from './schwab-client';
import { OptionContract, OptionChainResponse } from './schwab-types';
import { StrategyConfig } from './strategy-config';
import { EarningsLookup } from './earnings-calendar';
import {
  annualizedReturnOnRisk,
  bidAskSpreadPct,
  breakeven,
  clamp,
  expectedValueDollars,
  historicalVolatilityPct,
  maxLossDollars,
  maxProfitDollars,
  midCredit,
  naturalCredit,
  probabilityOfProfit,
  probabilityOtmFromDelta,
  returnOnRisk,
  round2,
  sma,
  spreadWidth,
} from './spread-math';

export interface SpreadCandidate {
  id: string; // e.g. AAPL_2025-11-21_225/220
  underlying: string;
  underlyingPrice: number;
  expiration: string; // YYYY-MM-DD
  dte: number;
  shortStrike: number;
  longStrike: number;
  shortSymbol: string;
  longSymbol: string;
  width: number;
  midCredit: number;
  naturalCredit: number;
  creditToWidth: number;
  maxProfit: number; // $ per spread at mid credit
  maxLoss: number; // $ per spread at mid credit
  returnOnRisk: number;
  annualizedRor: number;
  breakeven: number;
  cushionPct: number; // distance from spot to short strike
  shortDelta: number;
  probOtm: number;
  probProfit: number;
  expectedValue: number;
  shortIv: number; // percent
  hv20: number | null; // percent
  ivToHv: number | null;
  shortOpenInterest: number;
  longOpenInterest: number;
  shortBidAskPct: number;
  longBidAskPct: number;
  aboveSmas: Record<number, boolean>;
  trendOk: boolean;
  isIndex: boolean;
  sizeFactor: number; // 1.0, or 0.5 for an index ETF below its SMAs
  nextEarnings: string | null;
  earningsInWindow: boolean;
  score: number; // 0-100
  reasons: string[]; // why it was flagged as good / caveats
}

export interface UnderlyingContext {
  symbol: string;
  price: number;
  closes: number[];
  smas: Record<number, number | null>;
  hv20: number | null;
  nextEarnings: string | null;
}

/** Normalises Schwab's occasional "NaN" strings. */
export function greek(value: number | 'NaN' | undefined | null): number | null {
  if (value === undefined || value === null || value === 'NaN') return null;
  return Number.isFinite(value) ? value : null;
}

export function expirationFromKey(key: string): { expiration: string; dte: number } {
  // "2025-11-21:46" -> date + DTE
  const [expiration, dte] = key.split(':');
  return { expiration, dte: Number(dte) };
}

/** Build every short/long put pairing in a chain that satisfies the config. Pure given inputs. */
export function buildCandidates(
  chain: OptionChainResponse,
  ctx: UnderlyingContext,
  cfg: StrategyConfig
): SpreadCandidate[] {
  const out: SpreadCandidate[] = [];
  const price = chain.underlyingPrice || chain.underlying?.mark || ctx.price;

  const aboveSmas: Record<number, boolean> = {};
  for (const p of cfg.trendSmaPeriods) {
    const s = ctx.smas[p];
    aboveSmas[p] = s === null || s === undefined ? true : price > s; // unknown SMA = don't block
  }
  const trendOk = Object.values(aboveSmas).every(Boolean);
  const isIndex = cfg.indexSymbols.includes(chain.symbol.toUpperCase());
  // Trend is a hard gate for single stocks (below the 200-SMA daily moves roughly double);
  // for index ETFs the evidence is mixed, so a weak trend halves size instead.
  const sizeFactor = trendOk ? 1 : isIndex ? 0.5 : 0;

  for (const [expKey, strikes] of Object.entries(chain.putExpDateMap ?? {})) {
    const { expiration, dte } = expirationFromKey(expKey);
    if (dte < cfg.minDte || dte > cfg.maxDte) continue;

    const earningsInWindow = !!ctx.nextEarnings && ctx.nextEarnings <= expiration;
    if (earningsInWindow && cfg.earningsBlackout) continue;

    const contracts: OptionContract[] = Object.values(strikes)
      .map((arr) => arr[0])
      // bid = 0 or ask = 0 means a one-sided/stale quote — reject (Aug 5 2024 lesson)
      .filter((c): c is OptionContract => !!c && !c.nonStandard && c.bid > 0 && c.ask > 0)
      .sort((a, b) => a.strikePrice - b.strikePrice);

    for (const short of contracts) {
      const delta = greek(short.delta);
      if (delta === null) continue;
      const absDelta = Math.abs(delta);
      if (absDelta < cfg.minShortDelta || absDelta > cfg.maxShortDelta) continue;
      if (short.strikePrice >= price) continue; // must be OTM

      for (const long of contracts) {
        if (long.strikePrice >= short.strikePrice) continue;
        const width = spreadWidth(short.strikePrice, long.strikePrice);
        if (width < cfg.minWidth || width > cfg.maxWidth) continue;

        const credit = midCredit(short, long);
        const natural = naturalCredit(short, long);
        if (credit <= 0) continue;
        const creditToWidth = credit / width;
        if (creditToWidth < cfg.minCreditToWidth) continue;

        const shortSpreadPct = bidAskSpreadPct(short);
        const longSpreadPct = bidAskSpreadPct(long);
        const liquidOk =
          short.openInterest >= cfg.minOpenInterest &&
          long.openInterest >= cfg.minOpenInterest &&
          (short.totalVolume ?? 0) >= cfg.minVolume &&
          (long.totalVolume ?? 0) >= cfg.minVolume &&
          (shortSpreadPct <= cfg.maxBidAskPct || short.ask - short.bid <= cfg.maxBidAskAbs) &&
          (longSpreadPct <= cfg.maxBidAskPct || long.ask - long.bid <= cfg.maxBidAskAbs);
        if (!liquidOk) continue;

        const probOtm = probabilityOtmFromDelta(delta);
        const probProfit = probabilityOfProfit(width, credit);
        // EV net of slippage: realistic fills land ~4–7¢ worse than mid (FlashAlpha)
        const ev = expectedValueDollars(width, Math.max(0, credit - cfg.expectedSlippage), probOtm);
        if (ev < cfg.minExpectedValue) continue;
        const ivToHv = ctx.hv20 && ctx.hv20 > 0 ? round2(short.volatility / ctx.hv20) : null;

        const candidate: SpreadCandidate = {
          id: `${chain.symbol}_${expiration}_${short.strikePrice}/${long.strikePrice}`,
          underlying: chain.symbol,
          underlyingPrice: price,
          expiration,
          dte,
          shortStrike: short.strikePrice,
          longStrike: long.strikePrice,
          shortSymbol: short.symbol,
          longSymbol: long.symbol,
          width,
          midCredit: credit,
          naturalCredit: natural,
          creditToWidth: round2(creditToWidth),
          maxProfit: maxProfitDollars(credit),
          maxLoss: maxLossDollars(width, credit),
          returnOnRisk: round2(returnOnRisk(width, credit)),
          annualizedRor: round2(annualizedReturnOnRisk(width, credit, dte)),
          breakeven: breakeven(short.strikePrice, credit),
          cushionPct: round2(((price - short.strikePrice) / price) * 100),
          shortDelta: round2(absDelta),
          probOtm: round2(probOtm),
          probProfit: round2(probProfit),
          expectedValue: ev,
          shortIv: round2(short.volatility),
          hv20: ctx.hv20 === null ? null : round2(ctx.hv20),
          ivToHv,
          shortOpenInterest: short.openInterest,
          longOpenInterest: long.openInterest,
          shortBidAskPct: round2(shortSpreadPct),
          longBidAskPct: round2(longSpreadPct),
          aboveSmas,
          trendOk,
          isIndex,
          sizeFactor,
          nextEarnings: ctx.nextEarnings,
          earningsInWindow,
          score: 0,
          reasons: [],
        };
        candidate.score = scoreCandidate(candidate, cfg);
        candidate.reasons = describeCandidate(candidate, cfg);
        out.push(candidate);
      }
    }
  }
  return out;
}

/**
 * 0–100 score. Weights (sum 100):
 *   35 premium richness   — credit/width above the 1/3 floor, IV vs realized vol
 *   25 probability        — short delta near the sweet spot (0.16–0.25), cushion
 *   15 time               — DTE close to the 45-day target
 *   15 trend              — above the configured SMAs
 *   10 liquidity          — OI and tight markets
 * Earnings inside the window costs 25 points when blackout is off.
 */
export function scoreCandidate(c: SpreadCandidate, cfg: StrategyConfig): number {
  // premium: 0 at the listing floor, 1 at goodCreditToWidth + 0.10 (a very rich spread)
  const premiumRatio = clamp(
    (c.creditToWidth - cfg.minCreditToWidth) / (cfg.goodCreditToWidth + 0.1 - cfg.minCreditToWidth),
    0,
    1
  );
  const ivHv = c.ivToHv === null ? 0.5 : clamp((c.ivToHv - 0.8) / 0.8, 0, 1); // 0.8x→0, 1.6x→1
  const premium = 35 * (0.6 * premiumRatio + 0.4 * ivHv);

  // Research shows a plateau from ~0.12 to 0.25 delta; penalise outside it (0.30 → 0.5, 0.35 → 0).
  const deltaSweet =
    c.shortDelta > 0.25 ? 1 - clamp((c.shortDelta - 0.25) / 0.1, 0, 1) : 1 - clamp((0.16 - c.shortDelta) / 0.08, 0, 1);
  const cushion = clamp(c.cushionPct / 10, 0, 1);
  const probability = 25 * (0.6 * deltaSweet + 0.4 * cushion);

  const time = 15 * (1 - clamp(Math.abs(c.dte - cfg.targetDte) / 15, 0, 1));

  const smaCount = Object.keys(c.aboveSmas).length;
  const smaHits = Object.values(c.aboveSmas).filter(Boolean).length;
  const trend = 15 * (smaCount === 0 ? 1 : smaHits / smaCount);

  const oi = clamp(Math.min(c.shortOpenInterest, c.longOpenInterest) / 1000, 0, 1);
  const tight = 1 - clamp(Math.max(c.shortBidAskPct, c.longBidAskPct) / cfg.maxBidAskPct, 0, 1);
  const liquidity = 10 * (0.5 * oi + 0.5 * tight);

  let score = premium + probability + time + trend + liquidity;
  if (c.earningsInWindow) score -= 25;
  return Math.round(clamp(score, 0, 100));
}

export function describeCandidate(c: SpreadCandidate, cfg: StrategyConfig): string[] {
  const r: string[] = [];
  r.push(
    `Collect ${c.midCredit.toFixed(2)} on a ${c.width}-wide spread (${Math.round(c.creditToWidth * 100)}% of width${
      c.creditToWidth >= cfg.goodCreditToWidth ? ', clears the 1/3 rule' : `, below the ${Math.round(cfg.goodCreditToWidth * 100)}% rule`
    })`
  );
  r.push(`Return on risk ${Math.round(c.returnOnRisk * 100)}% (${Math.round(c.annualizedRor * 100)}% annualized over ${c.dte} DTE)`);
  r.push(`Short ${c.shortStrike}P delta ${c.shortDelta} → ~${Math.round(c.probOtm * 100)}% chance it expires OTM; ${c.cushionPct}% below spot`);
  if (c.ivToHv !== null) {
    r.push(
      c.ivToHv >= cfg.minIvToHvRatio
        ? `IV ${c.shortIv}% vs 20d realized ${c.hv20}% (${c.ivToHv}x) — options are pricing more movement than the stock is showing`
        : `⚠️ IV ${c.shortIv}% is below realized ${c.hv20}% (${c.ivToHv}x) — premium is not rich`
    );
  }
  if (!c.trendOk) {
    const below = Object.entries(c.aboveSmas)
      .filter(([, ok]) => !ok)
      .map(([p]) => `${p}-day`);
    r.push(
      c.isIndex
        ? `⚠️ Below its ${below.join(' and ')} SMA — index trend is mixed evidence, so size is halved`
        : `⚠️ Below its ${below.join(' and ')} SMA — single stocks below trend are rejected`
    );
  }
  if (c.earningsInWindow) r.push(`⚠️ Earnings ${c.nextEarnings} falls before expiration`);
  else if (c.nextEarnings) r.push(`Next earnings ${c.nextEarnings} (after expiration)`);
  else r.push('Earnings date unknown — check before entering');
  return r;
}

/** True when a candidate clears the "particularly good premium" bar used for alerts. */
export function isGoodPremium(c: SpreadCandidate, cfg: StrategyConfig): boolean {
  if (c.score < cfg.goodPremiumMinScore) return false;
  if (c.creditToWidth < cfg.goodCreditToWidth) return false;
  if (c.sizeFactor <= 0) return false; // single stock below trend
  if (c.earningsInWindow) return false;
  if (c.ivToHv !== null && c.ivToHv < cfg.minIvToHvRatio) return false;
  return true;
}

/**
 * Keep the single best spread per underlying+expiration so alerts aren't 40
 * near-duplicates. Spreads that clear the 1/3-of-width rule are preferred over
 * cheaper ones regardless of score, then highest score, then return on risk.
 */
export function bestPerExpiration(candidates: SpreadCandidate[], cfg: StrategyConfig): SpreadCandidate[] {
  const rank = (c: SpreadCandidate): number => (c.creditToWidth >= cfg.goodCreditToWidth ? 1000 : 0) + c.score;
  const best = new Map<string, SpreadCandidate>();
  for (const c of candidates) {
    const key = `${c.underlying}_${c.expiration}`;
    const cur = best.get(key);
    if (!cur || rank(c) > rank(cur) || (rank(c) === rank(cur) && c.returnOnRisk > cur.returnOnRisk)) best.set(key, c);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

export function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

export class PutSpreadScanner {
  constructor(
    private readonly client: SchwabClient,
    private readonly cfg: StrategyConfig,
    private readonly earnings: EarningsLookup
  ) {}

  async loadContext(symbol: string): Promise<UnderlyingContext> {
    const [history, nextEarnings] = await Promise.all([
      this.client.getDailyHistory(symbol, 1),
      this.earnings.nextEarnings(symbol),
    ]);
    const closes = (history.candles ?? []).map((c) => c.close);
    const smas: Record<number, number | null> = {};
    for (const p of this.cfg.trendSmaPeriods) smas[p] = sma(closes, p);
    return {
      symbol,
      price: closes[closes.length - 1] ?? 0,
      closes,
      smas,
      hv20: historicalVolatilityPct(closes, 20),
      nextEarnings,
    };
  }

  async scanSymbol(symbol: string): Promise<SpreadCandidate[]> {
    const [chain, ctx] = await Promise.all([
      this.client.getOptionChain({
        symbol,
        contractType: 'PUT',
        range: 'OTM',
        fromDate: isoDaysFromNow(this.cfg.minDte),
        toDate: isoDaysFromNow(this.cfg.maxDte),
      }),
      this.loadContext(symbol),
    ]);
    if (chain.status && chain.status !== 'SUCCESS') {
      console.warn(`⚠️ Chain for ${symbol} returned status ${chain.status}`);
    }
    return buildCandidates(chain, ctx, this.cfg);
  }

  /** Scans the whole watchlist sequentially (3 requests per name keeps us well under the rate limit). */
  async scanWatchlist(symbols = this.cfg.watchlist): Promise<SpreadCandidate[]> {
    const all: SpreadCandidate[] = [];
    for (const symbol of symbols) {
      try {
        const found = await this.scanSymbol(symbol);
        console.log(`🔎 ${symbol}: ${found.length} spreads pass filters`);
        all.push(...found);
      } catch (error) {
        console.error(`❌ Scan failed for ${symbol}:`, (error as Error).message);
      }
    }
    return all.sort((a, b) => b.score - a.score);
  }
}
