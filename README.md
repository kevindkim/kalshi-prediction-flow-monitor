# Kalshi Prediction Flow Monitor

Two tools live here: the original Kalshi big-trade stream (below) and a **Schwab bull put spread scanner/monitor** that prompts you by email or text when premium is rich and when an open spread has hit 50–65% of max profit. Jump to [Schwab put spread monitor](#schwab-put-spread-monitor).

A TypeScript CLI-based flow tracker using Kalshi that authenticates with API keys, streams live public trades via WebSockets, and filters for "big trades" ($5k+ notional trades) with helpful market details. Trades are anonymous, but gives a sense of where the big money is going. It's meant for you to read as it scrolls.

Future iterations will include market-level swings and a web interface, as well as notifications.

## How It Works (Technically)
- `generateKalshiAuthHeaders` signs requests with RSA-PSS so we can log in over REST and open an authenticated WebSocket (`src/kalshi-signer.ts`, `src/kalshi-auth.ts`).
- `KalshiClient` subscribes to the `trade` channel and emits each trade as an event (`src/kalshi-client.ts`).
- `TradeFilter` tracks total trade $ value in USD and emits `bigTrade` events when the value meets the $5,000 bar (`src/trade-filter.ts`).
– `getMarketDetails` fetches titles, rules, and expirations for the ticker so alerts include plain-language context (`src/kalshi-market-lookup.ts`).

```
WebSocket → KalshiClient → TradeFilter (≥ $5k) → Market Lookup → Alert
```

Sample alert:
```
💰 BIG TRADE: $8,456.00
Oklahoma City vs Indiana Winner?
Rules: If Oklahoma City wins, YES resolves.
Expires: 10/23/2025, 9:30:00 PM

Ticker: KXNBAGAME-25OCT23OKCIND-OKC
Side: yes | Price: 68¢ | Size: 12,435 contracts
```

## Prerequisites
- Node.js 18+
- Kalshi API key pair (API Key ID + RSA private key in PEM format), just need a regular account to create

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in your Kalshi credentials, go to kalshi.com and sign up + generate an API Key.
   ```bash
   cp .env.example .env
   ```
3. Store the PEM file referenced above (default path is `./kalshi-private-key.pem`). Only keep it locally.

## Running the Stream
```bash
npm run start
```
You should see the authentication, subscription confirmation, and any trade alerts above the $5k cutoff.

## Next Steps
- Add automated tests around notional calculation and signer logic before productionising.
- Instrument reconnection logic and structured logging if you plan to run the monitor continuously.

---

# Schwab put spread monitor

Sells bullish put credit spreads systematically against the Schwab Trader API:

- **Scans up to 10 names** for 30–50 DTE bull put spreads, scores each on premium richness
  (credit/width, implied vs 20-day realized vol), probability (short delta 0.16–0.30), time to
  the 45-DTE target, trend (above 50/200-day SMA) and liquidity, and **emails/texts you** when a
  spread is "particularly good" (score ≥ 65 and credit ≥ 1/3 of width).
- **Watches open spreads** every 15 minutes and prompts you to close in the **50–65% of max
  profit** zone (escalating past 65%), at **2× credit** loss, at **21 DTE**, when the short strike
  is tested, and the day before expiration if it is in the money.
- **Places orders only with `--confirm`**: a NET_CREDIT vertical to open, then, after the fill, a
  GTC NET_DEBIT close at 50% of the actual credit. Every alert contains the exact command to act.

The research behind the defaults is in [`docs/put-spread-strategy-research.md`](docs/put-spread-strategy-research.md);
the API details are in [`docs/schwab-api-reference.md`](docs/schwab-api-reference.md).

```
Schwab chains + price history → scanner (filters + score) → "rich premium" email/SMS → open --confirm
Schwab positions + quotes      → monitor (50/65% · 2x stop · 21 DTE) → "close it" email/SMS → close --confirm
```

## Setup
1. Create an app at developer.schwab.com ("Trader API – Individual") with **both** the Accounts
   and Trading and the Market Data products, callback `https://127.0.0.1:8182/callback`. Wait
   for status "Ready For Use".
2. Fill the `SCHWAB_*`, `SPREAD_WATCHLIST`, email and (optionally) Twilio values in `.env`
   (see `.env.example`). Gmail needs an app password.
3. Log in once a week (the refresh token lasts 7 days):
   ```bash
   npm run spreads -- auth
   npm run spreads -- auth status
   npm run spreads -- test-notify
   ```

## Commands
```bash
npm run spreads -- scan --notify                 # rank spreads, alert on the good ones
npm run spreads -- monitor --notify              # status of open spreads, alert on actionable ones
npm run spreads -- monitor --auto-target         # also place a GTC 50% close on any spread missing one
npm run spreads -- open SPY 2026-11-20 580 575 --qty 2 --credit 1.80            # dry run, prints order JSON
npm run spreads -- open SPY 2026-11-20 580 575 --qty 2 --credit 1.80 --confirm  # sends it, then places the GTC close after fill
npm run spreads -- close SPY_2026-11-20_580/575 --pct 0.5 --confirm             # GTC close at 50% of credit
npm run spreads -- close SPY_2026-11-20_580/575 --debit 0.60 --confirm --day    # take it now
npm run spreads -- run --notify                  # loop during market hours: monitor every 15 min, scan hourly
```
Sample "good premium" alert:
```
▶ SPY $600.00 — sell 2026-11-20 580/575 put spread  [score 75]
   Credit ~1.80 mid (1.70 natural) on $5 width → 56% on risk, 45 DTE
   Max profit $180 / max loss $320 per spread · POP ~70% · breakeven 578.2
   • Collect 1.80 on a 5-wide spread (36% of width, clears the 1/3 rule)
   • IV 25% vs 20d realized 18% (1.39x) — options are pricing more movement than the stock is showing
   Size at 2% risk: 6 spreads
   → npm run spreads -- open SPY 2026-11-20 580 575 --qty 6 --credit 1.80 --confirm
```
Sample close prompt:
```
✅ META 2026-11-20 200/190 ×1 — TAKE PROFIT
   55% of max profit captured — in the 50–65% take-profit zone
   Opened for 3.00, closes now for ~1.35 mid (1.45 natural) → P/L $165 of $300 max
   → npm run spreads -- close META_2026-11-20_200/190 --debit 1.35 --confirm   (take 55% now)
   → npm run spreads -- close META_2026-11-20_200/190 --pct 0.5 --confirm     (GTC at 50% of credit)
```

## Layout
| File | Purpose |
|---|---|
| `src/schwab/schwab-auth.ts` | OAuth login, token file, 30-min refresh, 7-day expiry warning |
| `src/schwab/schwab-client.ts` | Rate-limited (120/min) client: chains, quotes, price history, positions, orders |
| `src/schwab/strategy-config.ts` | Every strategy threshold with its env override |
| `src/schwab/spread-math.ts` | Credit, width, ROR, POP, EV, profit-captured, sizing, SMA, realized vol |
| `src/schwab/put-spread-scanner.ts` | Chain → candidates → filters → 0–100 score → "good premium" test |
| `src/schwab/position-monitor.ts` | Pairs legs into spreads, 50/65% · 2x · 21 DTE · tested · assignment rules |
| `src/schwab/spread-orders.ts` | NET_CREDIT open / NET_DEBIT close JSON (schwab-py templates) |
| `src/schwab/notifier.ts` | Email (nodemailer) + SMS (Twilio or carrier gateway) with cooldown dedupe |
| `src/schwab/earnings-calendar.ts` | Earnings dates from env/JSON/Finnhub (Schwab has no endpoint) |
| `src/schwab/put-spread-monitor.ts` | The CLI |
| `tests/` | 27 unit tests: `npm test` |

## Notes and limits
- IV **rank** needs a year of IV history Schwab does not provide; the scanner uses IV vs 20-day
  realized vol as the richness signal instead.
- Earnings dates must come from `SPREAD_EARNINGS`, a JSON file, or a free Finnhub key. Unknown
  dates are flagged in the alert, not silently ignored.
- Stops are evaluated on the spread mid at each monitor tick and sent as limit-debit closes;
  resting stop orders on spreads trigger on bad marks.
- The chained TRIGGER order (open + child GTC close in one ticket) is behind `--trigger` because
  Schwab only documents it for equities. Use `--preview` to let Schwab validate it first.
- Nothing is sent to Schwab without `--confirm`. This is a tool, not advice.
