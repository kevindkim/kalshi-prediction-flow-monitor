import { SchwabAuth } from './schwab-auth';
import {
  AccountNumberHash,
  MarketHoursResponse,
  OptionChainResponse,
  PlacedOrder,
  PriceHistoryResponse,
  QuoteResponse,
  SchwabOrder,
  SecuritiesAccount,
} from './schwab-types';

const API_BASE = 'https://api.schwabapi.com';

/**
 * Schwab allows 120 requests/minute per app. This is a simple sliding-window
 * limiter so a 10-ticker scan plus quotes never trips it.
 */
class RateLimiter {
  private timestamps: number[] = [];
  constructor(private readonly maxPerMinute: number) {}

  async acquire(): Promise<void> {
    while (true) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => now - t < 60_000);
      if (this.timestamps.length < this.maxPerMinute) {
        this.timestamps.push(now);
        return;
      }
      const waitMs = 60_000 - (now - this.timestamps[0]) + 25;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

export interface ChainParams {
  symbol: string;
  contractType?: 'PUT' | 'CALL' | 'ALL';
  strikeCount?: number;
  fromDate?: string; // YYYY-MM-DD
  toDate?: string;
  range?: 'OTM' | 'ITM' | 'ALL' | 'NTM' | 'SBK' | 'SNK';
  includeUnderlyingQuote?: boolean;
}

export class SchwabClient {
  private readonly limiter: RateLimiter;

  constructor(
    private readonly auth: SchwabAuth = new SchwabAuth(),
    maxRequestsPerMinute = Number(process.env.SCHWAB_RATE_LIMIT_PER_MIN || 110)
  ) {
    this.limiter = new RateLimiter(maxRequestsPerMinute);
  }

  // ---------------------------------------------------------------------
  // Market data
  // ---------------------------------------------------------------------

  async getOptionChain(params: ChainParams): Promise<OptionChainResponse> {
    const query: Record<string, string> = {
      symbol: params.symbol,
      contractType: params.contractType ?? 'PUT',
      strategy: 'SINGLE',
      includeUnderlyingQuote: String(params.includeUnderlyingQuote ?? true),
    };
    if (params.strikeCount) query.strikeCount = String(params.strikeCount);
    if (params.fromDate) query.fromDate = params.fromDate;
    if (params.toDate) query.toDate = params.toDate;
    if (params.range) query.range = params.range;
    return this.request<OptionChainResponse>('GET', '/marketdata/v1/chains', query);
  }

  /** Daily candles for the past `years` years (valid: 1,2,3,5,10,15,20), enough for a 200-day SMA. */
  async getDailyHistory(symbol: string, years = 1): Promise<PriceHistoryResponse> {
    return this.request<PriceHistoryResponse>('GET', '/marketdata/v1/pricehistory', {
      symbol,
      periodType: 'year',
      period: String(years),
      frequencyType: 'daily',
      frequency: '1',
      needExtendedHoursData: 'false',
    });
  }

  /** Equity-option market hours for a date (YYYY-MM-DD, default today). */
  async getOptionMarketHours(date?: string): Promise<MarketHoursResponse> {
    const query: Record<string, string> = { markets: 'option' };
    if (date) query.date = date;
    return this.request<MarketHoursResponse>('GET', '/marketdata/v1/markets', query);
  }

  async getQuotes(symbols: string[]): Promise<QuoteResponse> {
    if (symbols.length === 0) return {};
    return this.request<QuoteResponse>('GET', '/marketdata/v1/quotes', {
      symbols: symbols.join(','),
      fields: 'quote',
    });
  }

  // ---------------------------------------------------------------------
  // Accounts & positions
  // ---------------------------------------------------------------------

  async getAccountNumbers(): Promise<AccountNumberHash[]> {
    return this.request<AccountNumberHash[]>('GET', '/trader/v1/accounts/accountNumbers');
  }

  /** Resolves the account hash from SCHWAB_ACCOUNT_NUMBER, or the first account if unset. */
  async resolveAccountHash(): Promise<string> {
    const accounts = await this.getAccountNumbers();
    if (accounts.length === 0) throw new Error('No Schwab accounts returned');
    const wanted = process.env.SCHWAB_ACCOUNT_NUMBER;
    if (wanted) {
      const match = accounts.find((a) => a.accountNumber === wanted || a.accountNumber.endsWith(wanted));
      if (!match) throw new Error(`Account ${wanted} not found among ${accounts.length} accounts`);
      return match.hashValue;
    }
    return accounts[0].hashValue;
  }

  async getAccountWithPositions(accountHash: string): Promise<SecuritiesAccount> {
    return this.request<SecuritiesAccount>('GET', `/trader/v1/accounts/${accountHash}`, {
      fields: 'positions',
    });
  }

  // ---------------------------------------------------------------------
  // Orders
  // ---------------------------------------------------------------------

  /**
   * Places an order. Schwab returns 201 with an empty body and the new order's
   * URL in the Location header, so the id is parsed from there. The header can
   * be missing when the order fills instantly; callers should then reconcile
   * via getOrders().
   */
  async placeOrder(accountHash: string, order: SchwabOrder): Promise<{ orderId: string | null }> {
    const res = await this.rawRequest('POST', `/trader/v1/accounts/${accountHash}/orders`, undefined, order);
    const location = res.headers.get('location') || '';
    const orderId = location.split('/').filter(Boolean).pop() || null;
    return { orderId };
  }

  /** Asks Schwab to validate/price an order without placing it. */
  async previewOrder(accountHash: string, order: SchwabOrder): Promise<unknown> {
    return this.request<unknown>('POST', `/trader/v1/accounts/${accountHash}/previewOrder`, undefined, order);
  }

  /** Polls an order until it reaches a terminal state or the timeout passes. */
  async waitForFill(accountHash: string, orderId: string, timeoutMs: number, pollMs = 10_000): Promise<PlacedOrder> {
    const terminal = new Set(['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED', 'REPLACED']);
    const deadline = Date.now() + timeoutMs;
    let order = await this.getOrder(accountHash, orderId);
    while (!terminal.has(order.status) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs));
      order = await this.getOrder(accountHash, orderId);
    }
    return order;
  }

  async getOrder(accountHash: string, orderId: string): Promise<PlacedOrder> {
    return this.request<PlacedOrder>('GET', `/trader/v1/accounts/${accountHash}/orders/${orderId}`);
  }

  async cancelOrder(accountHash: string, orderId: string): Promise<void> {
    await this.rawRequest('DELETE', `/trader/v1/accounts/${accountHash}/orders/${orderId}`);
  }

  /** Schwab caps the lookback window at 60 days. */
  async getOrders(accountHash: string, daysBack = 59, status?: string): Promise<PlacedOrder[]> {
    const to = new Date();
    const from = new Date(to.getTime() - Math.min(daysBack, 59) * 86_400_000);
    const query: Record<string, string> = {
      fromEnteredTime: from.toISOString(),
      toEnteredTime: to.toISOString(),
      maxResults: '500',
    };
    if (status) query.status = status;
    return this.request<PlacedOrder[]>('GET', `/trader/v1/accounts/${accountHash}/orders`, query);
  }

  // ---------------------------------------------------------------------
  // Plumbing
  // ---------------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    query?: Record<string, string>,
    body?: unknown
  ): Promise<T> {
    const res = await this.rawRequest(method, path, query, body);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  private async rawRequest(
    method: string,
    path: string,
    query?: Record<string, string>,
    body?: unknown,
    attempt = 0
  ): Promise<Response> {
    await this.limiter.acquire();
    const token = await this.auth.getAccessToken();
    const url = new URL(`${API_BASE}${path}`);
    if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 429 && attempt < 3) {
      const retryAfter = Number(res.headers.get('retry-after') || 5);
      console.warn(`⏳ Schwab rate limited, retrying in ${retryAfter}s`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return this.rawRequest(method, path, query, body, attempt + 1);
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Schwab ${method} ${path} failed: ${res.status} ${res.statusText}\n${errText}`);
    }
    return res;
  }
}
