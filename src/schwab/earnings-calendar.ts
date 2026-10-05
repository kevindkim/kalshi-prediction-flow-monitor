import fs from 'fs';
import path from 'path';

/**
 * Earnings dates. Schwab's API does not expose an earnings calendar, so the
 * scanner reads them from (in priority order):
 *   1. SPREAD_EARNINGS_JSON  — path to a JSON file { "AAPL": "2025-10-30", ... }
 *   2. SPREAD_EARNINGS       — inline "AAPL=2025-10-30,MSFT=2025-10-29"
 *   3. Finnhub (free tier) if FINNHUB_API_KEY is set
 * Missing data is treated as "unknown" and the candidate is flagged, not dropped.
 */
export interface EarningsLookup {
  nextEarnings(symbol: string): Promise<string | null>; // YYYY-MM-DD or null
}

export class StaticEarningsLookup implements EarningsLookup {
  private readonly dates: Record<string, string>;

  constructor(dates?: Record<string, string>) {
    this.dates = dates ?? loadStaticDates();
  }

  async nextEarnings(symbol: string): Promise<string | null> {
    const today = new Date().toISOString().slice(0, 10);
    const d = this.dates[symbol.toUpperCase()];
    return d && d >= today ? d : null;
  }
}

export class FinnhubEarningsLookup implements EarningsLookup {
  private cache = new Map<string, string | null>();
  constructor(private readonly apiKey: string, private readonly fallback: EarningsLookup = new StaticEarningsLookup()) {}

  async nextEarnings(symbol: string): Promise<string | null> {
    const fromStatic = await this.fallback.nextEarnings(symbol);
    if (fromStatic) return fromStatic;
    if (this.cache.has(symbol)) return this.cache.get(symbol) ?? null;
    try {
      const today = new Date();
      const to = new Date(today.getTime() + 120 * 86_400_000);
      const url = new URL('https://finnhub.io/api/v1/calendar/earnings');
      url.searchParams.set('symbol', symbol);
      url.searchParams.set('from', today.toISOString().slice(0, 10));
      url.searchParams.set('to', to.toISOString().slice(0, 10));
      url.searchParams.set('token', this.apiKey);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as { earningsCalendar?: Array<{ date: string }> };
      const dates = (data.earningsCalendar ?? []).map((e) => e.date).sort();
      const next = dates[0] ?? null;
      this.cache.set(symbol, next);
      return next;
    } catch (error) {
      console.warn(`⚠️ Earnings lookup failed for ${symbol}:`, (error as Error).message);
      this.cache.set(symbol, null);
      return null;
    }
  }
}

export function createEarningsLookup(): EarningsLookup {
  const key = process.env.FINNHUB_API_KEY;
  return key ? new FinnhubEarningsLookup(key) : new StaticEarningsLookup();
}

function loadStaticDates(): Record<string, string> {
  const out: Record<string, string> = {};
  const jsonPath = process.env.SPREAD_EARNINGS_JSON;
  if (jsonPath) {
    const resolved = path.resolve(process.cwd(), jsonPath);
    if (fs.existsSync(resolved)) {
      Object.assign(out, JSON.parse(fs.readFileSync(resolved, 'utf8')));
    }
  }
  const inline = process.env.SPREAD_EARNINGS;
  if (inline) {
    for (const pair of inline.split(',')) {
      const [sym, date] = pair.split('=').map((s) => s.trim());
      if (sym && date) out[sym.toUpperCase()] = date;
    }
  }
  return out;
}
