# Kalshi Prediction Flow Monitor

Ever wonder where the biggest tickets on Kalshi are landing? This TypeScript CLI authenticates with your API keys, listens to the live trade firehose, and flags any order that clears a $5,000 notional bar. Trades stay anonymous, but the stream gives you instant signal on where size is moving.

Future iterations will layer in market swing detection, a lightweight web surface, and real-time notifications—this repo is the foundation.

## How It Works
- After a quick RSA-PSS signing handshake (`src/kalshi-signer.ts`, `src/kalshi-auth.ts`), we grab a session token and open an authenticated WebSocket.
- `KalshiClient` keeps the `trade` channel alive and emits every message as an event (`src/kalshi-client.ts`).
- `TradeFilter` calculates notional in dollars using the taker’s side-specific price and emits `bigTrade` events when the value hits or exceeds $5,000 (`src/trade-filter.ts`).
- `getMarketDetails` enriches those trades with titles, rules, and expirations so the alert reads like a headline instead of a ticker symbol (`src/kalshi-market-lookup.ts`).

```
WebSocket → KalshiClient → TradeFilter (≥ $5k) → Market Lookup → Alert
```

## Key Business Rules
- Threshold defaults to **$5,000**; pass a different value into `new TradeFilter(thresholdUsd)` to adjust.
- Notional uses the dollar field (`price_dollars * count`) to avoid cents-to-dollars mistakes.
- YES/NO pricing is asymmetric—the filter picks `yes_price_dollars` or `no_price_dollars` based on the taker side.
- Metadata failures fall back to the raw ticker, keeping the stream resilient even if REST lookups lag or rate limit.

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
- A Kalshi API key pair (API Key ID + RSA private key in PEM format)

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in your credentials (never commit the real values):
   ```bash
   cp .env.example .env
   ```
3. Store the PEM file referenced by `KALSHI_PRIVATE_KEY_PATH` (defaults to `./kalshi-private-key.pem`) locally and keep it out of version control.

## Running the Stream
```bash
npm run start
```
This executes `ts-node src/kalshi-client.ts`, signs in, subscribes to the trade feed, and prints alerts whenever a trade clears the current threshold.

## Customising & Extending
- Want a different signal? Change the threshold or add volume/ticker filters inside `src/trade-filter.ts`.
- Need alerts elsewhere? Swap the console logger in the `bigTrade` handler for Slack/Discord webhooks or a REST hook.
- Watching high-velocity markets? Layer in caching inside `getMarketDetails` to minimize REST latency.

## Next Steps
- Add automated tests around the signer and notional math before you rely on this in production.
- Instrument reconnection logic and structured logging if you plan to keep the monitor running 24/7.
