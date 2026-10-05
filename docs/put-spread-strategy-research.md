# Bull Put Credit Spreads as Systematic Income — Research Brief

Compiled 2026-10-05 for the Schwab put-spread monitor in this repo. Every default in
`src/schwab/strategy-config.ts` traces back to a row in the "Rules distilled for code"
table at the bottom. Where sources disagree the parameter is left configurable via `.env`.

> Method note: most tastytrade/tastylive research exists only as video; where the primary
> study was not indexable, a secondary write-up is cited. Treat secondary-only figures as
> directional.

---

## 1. Strike selection

**Short-strike delta.** The consensus retail range for the short put is |delta| 0.16–0.30.
"Most credit spread traders live between 0.16 and 0.30 delta on the short leg," with
0.15–0.25 described as the sweet spot and 0.30+ "outside the sweet spot" because you lose
~30 of 100 trades ([theoptionpremium](https://www.theoptionpremium.com/p/credit-spread-strike-selection-probability-based)).
tastylive's default for verticals is reported as the ~30-delta short strike at ~45 DTE,
closing at 50% ([financialtechwiz](https://www.financialtechwiz.com/post/put-credit-spread/));
their strangle research uses 16 delta ([sjoptions](https://www.sjoptions.com/tastytrade-credit-spreads-do-they-work/)).
A 20-year SPX test of short puts from 30 down to 3 delta found "between the 25 and the 12 it
barely matters... a plateau, not a slope: you're choosing a position size, not an edge"
([Theta Desk](https://thetadesk.substack.com/p/which-delta-should-you-actually-sell)).
The 15–16 delta sits roughly one standard deviation OTM
([datadrivenoptions](https://datadrivenoptions.com/strategies-for-option-trading/favorite-strategies/credit-put-spread/)).

**Spread width.** Width does not change POP (same short strike) but changes risk/reward.
$5-wide collecting $1.50 = 42.9% return on capital; $10-wide collecting $2.20 = 28.2%.
Doubling width roughly doubles max loss but adds only ~30–50% more credit; two $5-wides
generally collect more than one $10-wide
([theoptionpremium width](https://www.theoptionpremium.com/p/credit-spread-width-2-5-10-wide)).
Common widths: $1–$2.50 on sub-$100 names, $5 on ETFs/large caps, $5–$25 on SPX.

**Premium-to-width.** tastytrade's rule of thumb: collect at least 1/3 of the width
(≥ $1.65 on a $5-wide). You risk 2 to make 1, so you need to win > 67% to break even,
which a 16–30 delta short strike nominally supplies
([datadrivenoptions](https://datadrivenoptions.com/strategies-for-option-trading/favorite-strategies/credit-put-spread/),
[financialtechwiz](https://www.financialtechwiz.com/post/put-credit-spread/)).

**Probability math.**
- |delta| ≈ P(expire ITM), so P(short put expires OTM) ≈ 1 − |delta|. A 16-delta short
  expires worthless ~84% of the time, a 30-delta ~70%
  ([Wikipedia Greeks](https://en.wikipedia.org/wiki/Greeks_(finance))).
- A better POP for the spread uses the breakeven: `breakeven = K_short − credit`,
  `POP ≈ 1 − |delta at breakeven|`
  ([protraderdashboard](https://protraderdashboard.com/blog/probability-of-profit/)).
  The shortcut `POP ≈ 1 − credit/width` is the risk-neutral probability implied by the
  spread's own price; useful as a sanity check.
- Probability of touch ≈ 2 × |delta| for OTM options, so a 0.20-delta short will be
  *tested* ~40% of the time even though it only *loses* ~20%
  ([thetaedge](https://thetaedge.ai/blog/calculate-probability-of-touch)).
- Expected value, binary form: `EV = POP × credit − (1 − POP) × (width − credit)`.
  A $1.50 credit on a $5-wide at 70% POP has EV = 0.7×150 − 0.3×350 = $0, i.e. a 30-delta
  short on a $5-wide must collect more than $1.50 to be positive EV before costs
  ([optionspilot](https://optionspilot.app/blog/options-probability-of-profit-expected-value),
  [Wikipedia credit spread](https://en.wikipedia.org/wiki/Credit_spread_(options))).

## 2. Days to expiration

**45 DTE entry.** tastytrade research points to ~45 DTE as near-optimal for short premium,
balancing theta decay against "time to be correct"; 75 and 110 DTE also tested well but
less so ([luckbox](https://luckboxmagazine.com/techniques/the-magic-of-45-optimal-short-options-trade-duration/)).
At ~45 DTE the theta/gamma ratio is ~1.0; a $2 adverse move at 7 DTE produces a delta
change 3–4x what the same move produces at 45 DTE
([theoptionpremium theta](https://www.theoptionpremium.com/p/theta-decay-sweet-spot-30-60-dte)).
Practical range: 30–45 DTE ([daystoexpiry](https://www.daystoexpiry.com/blog/put-credit-spreads)).

**21 DTE management.** The tastylive standard: close or roll at 21 DTE or at 50% max profit,
whichever comes first
([forexfactory summary](https://www.forexfactory.com/thread/1258877-a-tasty-standard-45-dte-spx-iron),
[tastytrade video](https://www.youtube.com/watch?v=sqh0u63Zw6o)). Positions managed at
21 DTE "exhibit less negative tail risk and a lower standard deviation of returns"
([Wikipedia strangle](https://en.wikipedia.org/wiki/Strangle_(options))). The last three
weeks contain disproportionate gamma relative to remaining theta.

## 3. Profit taking

**50% of max profit.** tastylive has "dozens of studies" showing managing at 50% yields very
high win rates ([traderc](https://traderc.com/p50-options-probability-profit/)). A reproduced
tastylive strangle study (SPY, 45 DTE, 16 delta): manage at 50% = 90% win rate vs 82%
hold-to-expiration; total P/L $7,209 managed vs $12,297 held; high-IV entries were best on
P/L, win %, P/L per day and largest loss
([study summary](https://www.wenxuecity.com/blog/201507/60718/13280.html)).

**Independent 20-year SPX test** (16-delta short put, ~5,100 trades per DTE bucket):
hold-to-expiry wins per trade (0.29% vs 0.19% of collateral at 45 DTE), but managing at 50%
returns capital in ~15 days vs ~46 held, so annualized return on deployed capital is 4.4%
managed vs 2.4% held. "Holding wins the trade. Managing wins the year."
([Theta Desk](https://thetadesk.substack.com/p/should-you-close-winners-at-50-i)).

**50% vs 75% vs expiry.** Option Alpha's SPY put-spread backtest (0.30 short / 0.10 long)
found profit targets and stops "dramatically lowered volatility and shrank the max loss"
([Option Alpha](https://optionalpha.com/blog/spy-put-credit-spread-backtest)); a related test
attributed essentially the entire edge to "close at 50%, always": +$585 over five years vs
−$90 holding to expiration ([Option Alpha trend trading](https://optionalpha.com/podcast/trend-trading)).
No source showed 65% or 75% beating 50% on a per-day basis. **This is why the monitor
prompts at 50% and escalates at 65%: anything left past 65% is mostly tail risk.**

## 4. Loss management

Common rules, by prevalence:
1. **Stop at 2x credit** — close when the spread marks at 2× the opening credit (a loss equal
   to the credit received) ([sjoptions](https://www.sjoptions.com/tastytrade-credit-spreads-do-they-work/)).
2. **Time stop at 21 DTE** regardless of P/L.
3. **Short strike tested/breached** → close or roll. Expect this ~2×delta of the time.

Evidence on tight stops is mixed. Option Alpha found no-stop beat a 3x stop on total return
but with roughly 2x the max drawdown
([Option Alpha stop losses](https://optionalpha.com/podcast/stop-loss-strategies-for-options)).
A 2019–2026 SPY put-spread grid found the edge "conditional on a tight stop loss": a
100%-of-credit stop was best, a 200% stop was worse than no stop
([flashalpha](https://flashalpha.com/articles/spy-put-credit-spread-active-backtest-mm-fills-vrp-signal-drawdown-breaker)).
Net: a stop at 1x–2x credit is the defensible default; width is itself a hard stop.

## 5. What makes premium "particularly good"

**IV Rank / IV Percentile.**
- `IVR = (IV_now − IV_52wk_low) / (IV_52wk_high − IV_52wk_low) × 100`;
  `IVP = % of trading days in the past year with IV below IV_now`
  ([tastytrade support](https://support.tastytrade.com/support/s/solutions/articles/43000539059)).
- tastylive's rule: sell premium at IVR > 50; IVR > 30 is "elevated"; < 20 is debit territory
  ([traderc](https://traderc.com/iv-rank-iv-percentile-options/),
  [optionstradingiq](https://optionstradingiq.com/high-iv-vs-low-iv-options/)).
- Counter-evidence: sjoptions found SPX credit spreads with IVR < 50 *outperformed* IVR > 50
  because the high-IVR filter grew the average loser more than the average winner
  ([sjoptions IVR](https://www.sjoptions.com/high-iv-rank-vs-low-iv-rank-credit-spreads/)).
  So treat IVR as a sizing/credit-quality dial, not a binary gate.
- Schwab's API does not return 52-week IV history, so this project uses the
  **IV vs realized vol ratio** below as the premium-richness signal, and accepts an
  external IV rank only if you supply one.

**IV vs realized vol (variance risk premium).** IV persistently exceeds subsequent realized
vol; on SPX at 30-day tenor the gap averages ~2–4 vol points and inverts in crises
([sharpetwo](https://sharpetwo.com/blog/variance-risk-premium/),
[Alpha Architect](https://alphaarchitect.com/the-variance-risk-premium-is-pervasive/)).
Code: `VRP = IV_30d − RV_20d` (RV = annualized stdev of daily log returns); require
VRP > 0, prefer IV/RV ≥ 1.1–1.2.

**Return metrics.**
- `max_profit = credit`; `max_loss = width − credit`; `breakeven = K_short − credit`
- `return on risk = credit / (width − credit)` → the 1/3-width rule gives 50%
  ([theoptionpremium calculator](https://www.theoptionpremium.com/p/credit-spread-calculator-returns-risk-reward))
- `annualized ≈ ROR × 365 / DTE`; use expected hold (~15–24 days when managing at 50%) for
  realism
- `EV = POP × credit − (1 − POP) × (width − credit)` with `POP = 1 − |delta_short|`
- Rank candidates by EV / max_loss and EV per expected day held.

## 6. Entry filters

- **Earnings:** no earnings between entry and expiration; earnings convert a theta trade into
  a binary gap bet ([impliedoptions checklist](https://impliedoptions.com/blog/credit-spread-entries-checklist-for-swing-traders)).
- **Liquidity:** OI > 500–1,000 per leg, daily volume > 100; bid-ask ≤ $0.05–0.10 absolute on
  liquid names, or as % of mid: < 3% liquid, 3–10% fair, > 10% illiquid
  ([radarpulse](https://radarpulse.io/options-liquidity-explained/),
  [quantwheel](https://quantwheel.com/learn/options-bid-ask-spread)).
- **Trend confirmation:** underlying above the 50-day and/or 200-day SMA; for SPY the edge
  "deteriorates" below the 50-day with elevated vol
  ([options.cafe](https://options.cafe/blog/spy-put-credit-spreads-strategy/)).
- **Dividends / early assignment:** the long put has no assignment risk; the short put does.
  Early put assignment is likely only when deep ITM with little extrinsic value
  ([Fidelity](https://www.fidelity.com/learning-center/investment-products/options/options-strategy-guide/bull-put-spread),
  [Schwab](https://www.schwab.com/learn/story/ex-dividend-dates-understanding-dividend-risk)).
  Code flag: short put ITM with extrinsic < ~$0.05, or DTE ≤ 1 → close.

## 7. Position sizing

- Risk per trade (max loss) of 1–2% of account is most common; 5% is the upper bound
  ([impliedoptions](https://impliedoptions.com/blog/options-position-sizing-how-much-capital-to-risk-per-trade),
  [options.cafe](https://options.cafe/blog/spy-put-credit-spreads-strategy/)). Sosnoff's
  reported range: 0.5–5% of buying power per position.
- `contracts = floor(account × risk_pct / ((width − credit) × 100))`.
- Aggregate capital at risk 25–50% of account; cap sector exposure ~20%
  ([optionsamurai](https://optionsamurai.com/blog/options-portfolio-management/)).
- Vol-scaled sizing: VIX < 15 → 100%, 15–20 → 75%, 20–25 → 50%, 25–30 → 25%, > 30 → 0–10%
  ([mathandmarkets](https://mathandmarkets.com/p/the-volatility-series-part-6-practical)).
- Correlation: ten bull put spreads are all long delta and will correlate in a selloff;
  tastytrade's research shows diversifying by correlation lowers return volatility
  ([tastytrade Ryan & Beef](https://www.tastytrade.com/tt/shows/ryan-beef/episodes/diversifying-a-short-option-portfolio-09-26-2017)).

## 8. Order mechanics

- Enter as a single vertical order at a net-credit limit; legging exposes you to a naked short
  put between fills ([TradeStation](https://www.tradestation.com/insights/2026/04/13/bull-put-spread-execution-options-strategy/)).
- Price at the net mid, then step toward the natural in $0.01–0.05 increments; realistic fills
  land 4–7 cents worse than mid, and moving from mid-fills to realistic fills cut backtested
  CAGR 30–60% ([flashalpha](https://flashalpha.com/articles/spy-put-credit-spread-active-backtest-mm-fills-vrp-signal-drawdown-breaker)).
  Build ~$0.05 of slippage into EV.
- Immediately after fill, place a GTC closing order at `debit = credit × (1 − target)`
  ($3.00 credit → $1.50 debit for 50%)
  ([tastytrade support](https://support.tastytrade.com/support/s/solutions/articles/43000435423),
  [optionstradingiq GTC](https://optionstradingiq.com/locking-in-profits-with-gtc-orders/)).
  Schwab supports this natively as a TRIGGER order with a GTC NET_DEBIT child.
- Stops are generally *not* resting orders on spreads (illiquid marks trigger false stops);
  evaluate the stop on the spread's mid at a fixed cadence and send a limit-debit close.

## 9. Tax, margin and assignment

- **Reg T margin** for a short put vertical = `(width × 100) − credit` per spread
  ([tastytrade](https://tastytrade.com/learn/trading-products/options/short-put-vertical-spread/),
  [FINRA 4210](https://www.finra.org/rules-guidance/rulebooks/finra-rules/4210)).
- **Pin risk:** near the short strike at expiration you cannot know whether you'll be
  assigned; never hold through expiration
  ([Wikipedia pin risk](https://en.wikipedia.org/wiki/Pin_risk)).
- **Early assignment** of the short put creates long stock requiring full buying power; close
  the whole spread rather than hold shares
  ([Schwab](https://www.schwab.com/learn/story/money-due-handling-credit-spread-assignment)).
  SPX/XSP are European, cash-settled: no early assignment or pin risk.
- **Tax:** equity/ETF spreads are short-term gains subject to wash sales; SPX/XSP/NDX are
  Section 1256 contracts with 60/40 treatment
  ([staxinvesting](https://staxinvesting.com/blog/section-1256-and-the-6040-tax-treatment-of-index-options)).

---

## Rules distilled for code

| Parameter | Default in this repo | Range in sources | Env var |
|---|---|---|---|
| Short put delta | 0.16–0.30, scored best at 0.20 | plateau 0.12–0.25 | `SPREAD_MIN_SHORT_DELTA` / `SPREAD_MAX_SHORT_DELTA` |
| Spread width | $2.50–$10 | $1–$25 | `SPREAD_MIN_WIDTH` / `SPREAD_MAX_WIDTH` |
| Credit / width to list | 0.20 | — (practical floor on SPY-type names in calm vol) | `SPREAD_MIN_CREDIT_TO_WIDTH` |
| Credit / width to alert | 0.33 (the 1/3 rule) | 0.30–0.35 | `SPREAD_GOOD_CREDIT_TO_WIDTH` |
| Entry DTE | 30–50, target 45 | 30–60 | `SPREAD_MIN_DTE` / `SPREAD_MAX_DTE` / `SPREAD_TARGET_DTE` |
| Time exit | 21 DTE | 14–21 | `SPREAD_MANAGE_DTE` |
| Profit target | GTC close at 50% of credit | 50% (65–75% not better per day) | `SPREAD_PROFIT_TARGET_PCT` |
| Take-profit prompt zone | 50%–65% captured | — | `SPREAD_PROFIT_PROMPT_MIN_PCT` / `..._MAX_PCT` |
| Stop loss | spread mid ≥ 2.0 × credit | 1x–2x | `SPREAD_STOP_LOSS_MULTIPLE` |
| IV vs realized | IV/HV20 ≥ 1.0 to alert | 1.1–1.2 preferred | `SPREAD_MIN_IV_HV_RATIO` |
| Min expected value | $5/spread (≈ slippage) | — | `SPREAD_MIN_EXPECTED_VALUE` |
| Earnings | none before expiration | — | `SPREAD_EARNINGS_BLACKOUT` |
| Trend | price above 50 and 200 SMA | 20/50/200 | `SPREAD_TREND_SMA_PERIODS` |
| Liquidity per leg | OI ≥ 500, volume ≥ 50, bid-ask ≤ 10% of mid or ≤ $0.10 | OI 500–1000, vol 100–500 | `SPREAD_MIN_OPEN_INTEREST`, `SPREAD_MIN_VOLUME`, `SPREAD_MAX_BID_ASK_PCT`, `SPREAD_MAX_BID_ASK_ABS` |
| Risk per trade | 1% of liquidation value (see quant-strategy-research.md for the Kelly derivation) | 1–5% | `SPREAD_RISK_PER_TRADE_PCT` |
| Aggregate risk | 10% of liquidation value across all open spreads | 25–50% in looser guides | `SPREAD_MAX_AGGREGATE_RISK_PCT` |
| Max concurrent | 10 spreads, 1 per underlying | — | `SPREAD_MAX_OPEN`, `SPREAD_MAX_PER_UNDERLYING` |
| Assignment guard | short ITM and DTE ≤ 1 → close | — | built in |

**Where sources disagree (kept configurable):** IV rank gate (30 vs 50; one backtest favors
< 50), stop (1x vs 2x credit vs none), delta (16 vs 30), time exit (21 vs 15 DTE). The least
controversial items, and the ones hard-wired into the alert logic: 45 DTE entry, 50% profit
target with an immediate GTC closing order, 1/3-width minimum credit, 1–2% risk per trade,
and never holding through expiration.
