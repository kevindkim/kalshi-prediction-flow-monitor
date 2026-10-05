import { SchwabClient } from './schwab-client';
import { clamp, round2 } from './spread-math';

/**
 * Market-wide volatility regime used to scale (or pause) new put spread
 * entries. Two inputs, both free from Schwab's quotes endpoint:
 *
 *   VIX level      → vol-targeting multiplier = min(1, vixReference / VIX).
 *                    Moreira–Muir (2017) and Harvey et al. (2018) show scaling
 *                    exposure inversely with volatility raises Sharpe and trims
 *                    the left tail, because losses cluster when vol is high.
 *                    Above a hard cap (default 35) no new entries at all.
 *   VIX / VIX3M    → term structure. Contango (< 1) is the normal, premium-
 *                    harvesting regime ~80% of the time; backwardation (≥ 1)
 *                    means a vol spike is in progress and new short premium is
 *                    paused. The flip back to contango is historically the
 *                    richest entry window.
 *
 * See docs/quant-strategy-research.md §3.2 and §4.4.
 */
export interface RegimeConfig {
  vixSymbol: string;
  vix3mSymbol: string;
  /** Full size at or below this VIX; above it size scales as vixReference / VIX. */
  vixReference: number;
  /** Floor for the multiplier so a spike never rounds size to zero on its own. */
  minSizeMultiplier: number;
  /** Pause new entries when VIX / VIX3M is at or above this (1.0 = backwardation). */
  maxTermStructureRatio: number;
  /** Pause new entries when VIX is at or above this, regardless of term structure. */
  maxVixForNewEntries: number;
}

export const DEFAULT_REGIME_CONFIG: RegimeConfig = {
  vixSymbol: process.env.SPREAD_VIX_SYMBOL || '$VIX',
  vix3mSymbol: process.env.SPREAD_VIX3M_SYMBOL || '$VIX3M',
  vixReference: Number(process.env.SPREAD_VIX_REFERENCE || 18),
  minSizeMultiplier: Number(process.env.SPREAD_MIN_SIZE_MULTIPLIER || 0.1),
  maxTermStructureRatio: Number(process.env.SPREAD_MAX_TERM_STRUCTURE_RATIO || 1.0),
  maxVixForNewEntries: Number(process.env.SPREAD_MAX_VIX_FOR_ENTRY || 35),
};

export interface Regime {
  vix: number | null;
  vix3m: number | null;
  termStructureRatio: number | null; // vix / vix3m
  contango: boolean | null;
  sizeMultiplier: number; // 0..1
  allowNewEntries: boolean;
  label: string;
  reasons: string[];
}

export function sizeMultiplierForVix(vix: number | null, cfg: RegimeConfig = DEFAULT_REGIME_CONFIG): number {
  if (vix === null || !Number.isFinite(vix) || vix <= 0) return 1;
  if (vix <= cfg.vixReference) return 1;
  return round2(clamp(cfg.vixReference / vix, cfg.minSizeMultiplier, 1));
}

/** Pure function so it can be unit tested without Schwab. */
export function classifyRegime(vix: number | null, vix3m: number | null, cfg: RegimeConfig = DEFAULT_REGIME_CONFIG): Regime {
  const reasons: string[] = [];
  const ratio = vix !== null && vix3m !== null && vix3m > 0 ? round2(vix / vix3m) : null;
  const contango = ratio === null ? null : ratio < 1;
  const sizeMultiplier = sizeMultiplierForVix(vix, cfg);
  let allow = true;

  if (vix === null) {
    reasons.push('VIX unavailable — regime filters skipped');
  } else {
    reasons.push(`VIX ${vix.toFixed(2)} → size ×${sizeMultiplier}`);
    if (vix >= cfg.maxVixForNewEntries) {
      allow = false;
      reasons.push(`VIX ≥ ${cfg.maxVixForNewEntries}: no new entries`);
    }
  }
  if (ratio !== null) {
    reasons.push(
      contango
        ? `VIX/VIX3M ${ratio} — contango (normal premium-selling regime)`
        : `VIX/VIX3M ${ratio} — backwardation (vol spike in progress)`
    );
    if (ratio >= cfg.maxTermStructureRatio) {
      allow = false;
      reasons.push(`Term structure ≥ ${cfg.maxTermStructureRatio}: new entries paused until it normalises`);
    }
  }

  const label = !allow ? 'PAUSE' : sizeMultiplier >= 1 ? 'CALM' : sizeMultiplier >= 0.5 ? 'ELEVATED' : 'HIGH';
  return { vix, vix3m, termStructureRatio: ratio, contango, sizeMultiplier, allowNewEntries: allow, label, reasons };
}

export async function fetchRegime(client: SchwabClient, cfg: RegimeConfig = DEFAULT_REGIME_CONFIG): Promise<Regime> {
  try {
    const quotes = await client.getQuotes([cfg.vixSymbol, cfg.vix3mSymbol]);
    const last = (sym: string): number | null => {
      const q = quotes[sym]?.quote;
      const v = q?.lastPrice ?? q?.mark ?? q?.closePrice;
      return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
    };
    return classifyRegime(last(cfg.vixSymbol), last(cfg.vix3mSymbol), cfg);
  } catch (error) {
    console.warn('⚠️ Could not fetch VIX regime:', (error as Error).message);
    return classifyRegime(null, null, cfg);
  }
}
