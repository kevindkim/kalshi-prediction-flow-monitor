# Schwab Trader API — Reference for the Put Spread Monitor

Compiled 2026-10-05 from the schwab-py source and docs (alexgolec), Schwabdev docs
(tylerebowers), Go clients generated from Schwab's own OpenAPI spec (kebroad, major),
schwab-client-js, and community field notes. developer.schwab.com itself was not readable
from the research sandbox, so anything not derivable from those sources is tagged
**[UNCONFIRMED]**. This is what `src/schwab/schwab-client.ts` implements.

Base URLs: `https://api.schwabapi.com/trader/v1`, `https://api.schwabapi.com/marketdata/v1`,
OAuth at `https://api.schwabapi.com/v1/oauth/...`.

## 1. OAuth 2.0 (`schwab-auth.ts`)

- **Authorize**: `GET https://api.schwabapi.com/v1/oauth/authorize?client_id={APP_KEY}&redirect_uri={CALLBACK}&response_type=code[&state=...]`
- **Token**: `POST https://api.schwabapi.com/v1/oauth/token`
  - `Authorization: Basic base64(APP_KEY:APP_SECRET)`, `Content-Type: application/x-www-form-urlencoded`
  - first exchange: `grant_type=authorization_code&code={CODE}&redirect_uri={CALLBACK}`. The code in the
    callback query is URL-encoded and usually ends in `%40` (`@`); decode before sending.
  - refresh: `grant_type=refresh_token&refresh_token={REFRESH}`
  - response: `{ "expires_in": 1800, "token_type": "Bearer", "scope": "api", "refresh_token", "access_token", "id_token" }`
- **Lifetimes**: access token 30 min (refresh with ≥ 1 min leeway). Refresh token 7 days, hard
  limit: "requests for a new access token using a refresh token older than seven days are
  rejected with an invalid_client error" (schwab-py). Refreshing does **not** extend the refresh
  token; a browser re-login is required weekly. A dead refresh token returns 400/401 — alert once,
  don't retry in a loop.
- **Callback URL**: must be `https`, host `127.0.0.1` only, no trailing slash, byte-for-byte
  match with the registered value. Default here: `https://127.0.0.1:8182/callback`.
- **App setup**: on developer.schwab.com create a "Trader API – Individual" app and add BOTH
  products, *Accounts and Trading Production* and *Market Data Production*; missing one gives
  401 "Client not authorized". Status must be "Ready For Use" (1–3 days after creation).
- All API calls: `Authorization: Bearer {access_token}`.

## 2. Market data

### `GET /marketdata/v1/chains`
Params: `symbol` (req), `contractType=CALL|PUT|ALL`, `strikeCount`, `includeUnderlyingQuote`,
`strategy=SINGLE|ANALYTICAL|COVERED|VERTICAL|...`, `range=ITM|NTM|OTM|SAK|SBK|SNK|ALL`,
`fromDate`/`toDate` (`yyyy-MM-dd`), `expMonth`, `optionType=S|NS|ALL`.
The scanner calls `symbol=…&contractType=PUT&strategy=SINGLE&range=OTM&fromDate=…&toDate=…`.
Always bound by dates: an unfiltered `$SPX` chain "will exceed the buffer on Schwab's end".

Response:
```json
{ "symbol":"SPY", "status":"SUCCESS", "underlyingPrice": 600.1, "volatility": 29,
  "underlying": { "symbol":"SPY", "last":…, "mark":…, "bid":…, "ask":…, "close":… },
  "callExpDateMap": {},
  "putExpDateMap": { "2026-11-20:46": { "640.0": [ { …OptionContract… } ] } } }
```
Map key is `"YYYY-MM-DD:daysToExpiration"`; strike key is a decimal string; the value is an
**array** (length > 1 only for adjusted/non-standard contracts — filter `nonStandard`).
OptionContract fields used: `putCall, symbol, description, bid, ask, last, mark, bidSize,
askSize, totalVolume, openInterest, volatility` (IV in percent), `delta, gamma, theta, vega,
strikePrice, expirationDate, daysToExpiration, inTheMoney, multiplier, nonStandard`.
**Greeks can arrive as the string `"NaN"`** — `greek()` in the scanner sanitises them.
`mark` is Schwab's mark, not always exactly the midpoint; the scanner computes its own mid and
never prices off `last`.

### `GET /marketdata/v1/quotes?symbols=A,B&fields=quote`
Object keyed by symbol: `{ "SPY": { "assetMainType", "symbol", "quote": { "bidPrice", "askPrice",
"lastPrice", "mark", "closePrice", "totalVolume", … } } }`. Option symbols also carry
`delta, gamma, theta, vega, volatility, openInterest` in `quote`. Option symbols must be the
padded 21-char form or the response is silently empty.

### `GET /marketdata/v1/pricehistory`
`symbol, periodType=day|month|year|ytd, period, frequencyType=minute|daily|weekly|monthly,
frequency, needExtendedHoursData`. Valid `period` per type: day 1–5,10; month 1,2,3,6;
year 1,2,3,5,10,15,20. For a 200-day SMA use `periodType=year&period=1&frequencyType=daily`.
Response: `{ "candles":[{ "open","high","low","close","volume","datetime"(epoch ms) }], "symbol", "empty" }`.

### `GET /marketdata/v1/markets?markets=option[&date=YYYY-MM-DD]`
`{ "option": { "EQO": { "isOpen": true, "sessionHours": { "regularMarket": [{ "start": "…-04:00", "end": "…" }] } } } }`.
Used by `run` to gate scanning/monitoring to the regular session.

## 3. Trader endpoints

- `GET /trader/v1/accounts/accountNumbers` → `[ { "accountNumber", "hashValue" } ]`. Every other
  trader path uses `hashValue`.
- `GET /trader/v1/accounts/{hash}?fields=positions` → `{ "securitiesAccount": { "positions": [ … ],
  "currentBalances": { "liquidationValue", "buyingPower", "optionBuyingPower" } } }`.
  Position: `{ "shortQuantity", "longQuantity", "averagePrice", "marketValue",
  "instrument": { "assetType":"OPTION", "symbol":"SPY   261120P00640000", "putCall":"PUT",
  "underlyingSymbol":"SPY" } }`. Positions are **not** grouped into spreads; `pairPutSpreads()`
  rebuilds them by underlying + expiration (short leg matched to the nearest long below it).
- `GET /trader/v1/accounts/{hash}/orders?fromEnteredTime=…&toEnteredTime=…[&status=…]&maxResults=…`
  — both times required (ISO-8601), **window ≤ 60 days**. Status enum includes
  `AWAITING_PARENT_ORDER, ACCEPTED, PENDING_ACTIVATION, QUEUED, WORKING, REJECTED, PENDING_CANCEL,
  CANCELED, PENDING_REPLACE, REPLACED, FILLED, EXPIRED, NEW`.
- `POST /trader/v1/accounts/{hash}/orders` → **201 with empty body**; the order id is only in the
  `Location` header (`…/orders/{orderId}`). The header can be missing on an instant fill — fall
  back to listing orders. Rejections: 400 `{ "message", "errors": [...] }`.
- `GET /trader/v1/accounts/{hash}/orders/{orderId}` → `orderId, status, enteredTime, closeTime,
  filledQuantity, remainingQuantity, price, orderLegCollection[{ legId, instruction, quantity,
  instrument }], orderActivityCollection[{ executionType:"FILL", executionLegs[{ legId, price,
  quantity, time }] }], childOrderStrategies`. Net fill credit is not pre-netted
  **[UNCONFIRMED]**; `fillCreditFromOrder()` sums signed leg prices.
- `DELETE …/orders/{orderId}` cancels; `PUT` replaces; `POST …/previewOrder` validates without
  placing (used by `open --preview`).

## 4. Order JSON for a bull put credit spread (`spread-orders.ts`)

Open (sell 640P / buy 630P ×1 for $1.25 credit) — identical to schwab-py `bull_put_vertical_open`:
```json
{ "session": "NORMAL", "duration": "DAY", "orderType": "NET_CREDIT",
  "complexOrderStrategyType": "VERTICAL", "price": "1.25", "quantity": 1,
  "orderStrategyType": "SINGLE",
  "orderLegCollection": [
    { "instruction": "BUY_TO_OPEN",  "quantity": 1, "instrument": { "symbol": "SPY   261120P00630000", "assetType": "OPTION" } },
    { "instruction": "SELL_TO_OPEN", "quantity": 1, "instrument": { "symbol": "SPY   261120P00640000", "assetType": "OPTION" } } ] }
```
Close at 50% (buy back for $0.63 or less when credit was $1.25) — `bull_put_vertical_close`:
```json
{ "session": "NORMAL", "duration": "GOOD_TILL_CANCEL", "orderType": "NET_DEBIT",
  "complexOrderStrategyType": "VERTICAL", "price": "0.63", "quantity": 1,
  "orderStrategyType": "SINGLE",
  "orderLegCollection": [
    { "instruction": "SELL_TO_CLOSE", "quantity": 1, "instrument": { "symbol": "SPY   261120P00630000", "assetType": "OPTION" } },
    { "instruction": "BUY_TO_CLOSE",  "quantity": 1, "instrument": { "symbol": "SPY   261120P00640000", "assetType": "OPTION" } } ] }
```
`price` is sent as a string. `GOOD_TILL_CANCEL` lasts ≈ 180 days. Options trade only in
`session: NORMAL`.

**Auto-placing the 50% close.** Schwab supports `orderStrategyType: "TRIGGER"` with
`childOrderStrategies` (first-triggers-second), but its documented examples are equity-only and
**whether a NET_CREDIT VERTICAL parent may carry a NET_DEBIT VERTICAL GTC child is
[UNCONFIRMED]**. The CLI therefore defaults to: place the open → poll `GET order` until
`FILLED` → compute the fill credit → place the GTC NET_DEBIT close. `open --trigger` builds
the single TRIGGER order instead; test it with `--preview` first.

## 5. Option symbol format (`option-symbol.ts`)

21 characters: root left-justified and space-padded to 6, `YYMMDD`, `P`/`C`, strike × 1000
zero-padded to 8. `AAPL  251017P00230000` = AAPL 2025-10-17 230 put; `SPXW  260116C05040500`.
Symbols from chain/position responses are already in this form — reuse them verbatim.

## 6. Rate limits

120 requests per minute per app and 4,000 order-related calls per day (Schwabdev); over the limit
→ HTTP 429. The client uses a sliding-window limiter at 110/min and retries 429s with the
`Retry-After` header. A full 10-name scan costs ~20 requests (chain + price history per name).

## 7. Gotchas baked into the code

- Access token refresh every 30 min; refresh token dies after 7 days → `auth status` warns and
  `getAccessToken()` fails loudly with the re-login command.
- Callback trailing slash / wrong host / app still "Approved – Pending" are the top auth failures.
- Greeks/IV may be `"NaN"`; deep-ITM contracts can show delta ±1.
- Positions show per-leg quantities only; resting closing orders are not reflected in positions,
  so `hasWorkingClose()` checks the orders list before prompting.
- 60-day max lookback on order queries; `getOrders()` clamps to 59 days.
- Instant fills may omit `Location`; reconcile via `getOrders(…, 'FILLED')`.

## 8. Why a thin fetch wrapper instead of a library

`schwab-client-js` (ships `bullPutVerticalOpen/Close` helpers) and `@sudowealth/schwab-api`
(typed, Zod, built-in 120/min limiter) both work. A ~200-line typed `fetch` wrapper was chosen so
token persistence, 429 backoff, `Location` parsing and `"NaN"` handling are owned here and the
tool is not exposed to schema drift in community packages. The order JSON mirrors schwab-py's
templates verbatim.

Key sources: schwab-py `schwab/auth.py`, `schwab/client/base.py`, `schwab/orders/options.py`,
`docs/auth.rst`; Schwabdev `docs/pages-raw/{api,client,orders,setupguide,troubleshooting}.md`;
kebroad/schwab-market-data-production-go `docs/*.md` (generated from Schwab's OpenAPI);
major/schwab-go `trader/{accounts,orders}.go`; slimandslam/schwab-client-js `src/{orderhelp,access}.ts`;
Jorg-AI-JorgAI/schwab-trader-api-field-notes; jkoelker/schwab-mcp PR #179.
