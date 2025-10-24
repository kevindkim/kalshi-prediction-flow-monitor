# Kalshi Prediction Flow Monitor

A TypeScript CLI-based flow tracker using Kalshi that authenticates with API keys, streams live public trades via WebSockets, and filters for "big trades" ($5k+ notional trades) with helpful market details. Trades are anonymous, but gives a sense of where the big money is going. 

Future iterations will include market-level swings and a web interface, as well as notifications.


## How It Works
- `generateKalshiAuthHeaders` signs requests with RSA-PSS so we can log in over REST and open an authenticated WebSocket (`src/kalshi-signer.ts`, `src/kalshi-auth.ts`).
– `KalshiClient` subscribes to the `trade` channel and emits each trade as an event (`src/kalshi-client.ts`).
– `TradeFilter` tracks notional in USD using the side-specific dollar price and share count, emits `bigTrade` events when the value meets the $5,000 threshold (`src/trade-filter.ts`).
– `getMarketDetails` fetches titles, rules, and expirations for the ticker so alerts include helpful context like market rules, name, prices, contracts (`src/kalshi-market-lookup.ts`).

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
- A Kalshi API key pair (API Key ID + RSA private key in PEM format)

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` (never commit secrets):
   ```env
   KALSHI_API_KEY_ID=your-key-id
   KALSHI_PRIVATE_KEY_PATH=./kalshi-private-key.pem
   ```
3. Store the PEM file referenced above (default path is `./kalshi-private-key.pem`). Only keep it locally.

## Running the Stream
```bash
npx ts-node src/kalshi-client.ts
```
You should see the authentication moment, subscription confirmation, and the "big trades" over $5k that meet the criteria with metadata. 

## Next Steps
- Tests
- Market-level swings (10% change in Yes)
- Web interface
- Notifications 