# Known Quant Strategies Behind Systematic Put-Spread Selling — Research Synthesis

Compiled 2026-10-05 by four parallel research passes: (1) the academic variance-risk-premium and
put-writing literature plus Cboe index evidence, (2) practitioner and quant backtests of put credit
spreads, (3) quantitative risk management for short-premium books, and (4) signal research for
choosing names and timing entries. The four briefs follow in full as Parts 1–4; this section is the
synthesis and the mapping onto this repository's code. Companion documents:
`put-spread-strategy-research.md` (the retail rule set) and `schwab-api-reference.md`.

> Every brief flags items it could not confirm against a primary source because many publisher
> domains were blocked from the research sandbox. Treat **[unverified]** / **[snippet]** figures as
> directional until checked against the linked page.

## The strategy, in quant terms

Selling a bull put spread is a short **variance risk premium (VRP)** position wrapped in a
long-equity-beta position, with the long wing acting as margin insurance:

- **The premium is real, persistent and modest.** Index implied vol has exceeded realised vol by
  ~3–4 points on average since 1990, positive ~85–88% of months (Bondarenko; AQR). It inverts by
  15–25 points in crashes (Oct 2008, Feb 2018, Mar 2020). The Cboe PUT index, which is passive
  monthly ATM put selling, returned 9.5% vs the S&P's 9.8% with two-thirds the volatility (Sharpe
  0.65 vs 0.49) and a −33% vs −51% max drawdown over 1986–2018. **Budget a net Sharpe of 0.5–0.7,
  not the 1.0+ gross option returns suggest.**
- **The premium is front-loaded in time.** The variance-forward premium is ~3.7 points at one month
  and insignificant at three (Dew-Becker et al.), so 30–45 DTE is where the compensation lives.
  Weekly selling (WPUT) collected far more gross premium (37% vs 22%/yr) and still earned less net,
  because of gamma and costs. The 22–90 DTE band had the best realised return on capital in an
  18-million-spread SPY study.
- **Most of the risk is equity beta, not vol.** Israelov & Nielsen decompose option-writing into
  equity beta (most risk and return), a short-vol sliver (Sharpe ≈ 1 but <10% of risk) and an
  uncompensated dynamic-delta exposure. Ten bull put spreads across correlated names are a
  leveraged long-equity book with capped upside: implied correlation goes to ~1 in selloffs, so
  the ten positions become one bet.
- **Defined risk is justified by margin, not by expected return.** The long wing is itself an
  overpriced put (PPUT 6.6% vs PUT 9.5%); it lowers EV per contract. Its academic justification is
  Santa-Clara & Saretto: margin calls force undefined-risk sellers out exactly when losing, turning
  the best strategies' Sharpe negative. Spreads convert an unbounded, margin-call-prone tail into a
  bounded one. Buy the wing close to the short strike to give up the least premium per unit of
  capped loss.

## Where the evidence agrees

| Rule | Evidence | Code |
|---|---|---|
| Enter 30–45 DTE | VRP concentrated in the front month; spintwig/tasty 45-DTE sweet spot; 22–90 DTE realised-ROC band | `SPREAD_MIN_DTE=30`, `SPREAD_MAX_DTE=50`, target 45 |
| Close at 50% of credit, never past 21 DTE | tasty 90% vs 82% win; Theta Desk: managed 4.4% vs 2.4% annualised on capital; after 50% the remaining reward/risk ratio halves; loss relative to premium for a −3% move is 81% at 45 DTE, 134% at 21, 299% at 7 | `SPREAD_PROFIT_TARGET_PCT=0.50`, `SPREAD_MANAGE_DTE=21`, prompts at 50–65% |
| Sell when IV ≫ realised, not when IV is "high" | Goyal–Saretto (strongest cross-sectional result); AQR "Still Not Cheap"; Hu–Jacobs (relative, not absolute vol); Bollerslev–Tauchen–Zhou (wide VRP is also bullish) | IV/HV20 is the primary richness signal (`SPREAD_MIN_IV_HV_RATIO`); 35-point premium weight in the score |
| Term structure as regime | Contango ~80% of the time; backwardation = spike in progress; Spintwig's vol-mispricing filter raised Sharpe 0.57 → 0.98 and halved drawdown | `regime.ts` pauses new entries when VIX/VIX3M ≥ 1.0 |
| Size inversely with volatility | Moreira–Muir; Harvey et al. (smaller left tail because losses cluster when vol is high); Wysocki hybrid Kelly/VIX | multiplier = min(1, 18 / VIX), hard stop above VIX 35 |
| 1–2% max loss per trade, ≤ 10% aggregate | Kelly math: a $5/$1.65 spread at an honest 72% POP is quarter-Kelly ≈ 5%, divided by ~5 effective independent bets ≈ 1%; Option Alpha's 50%-allocation DIA test lost 71% on a profitable signal | `SPREAD_RISK_PER_TRADE_PCT=0.01`, `SPREAD_MAX_AGGREGATE_RISK_PCT=0.10` |
| No earnings inside the window | Dubinsky–Johannes (priced jump); META averaged 13% actual vs 7% implied over 12 quarters | `SPREAD_EARNINGS_BLACKOUT=true` |
| Realistic fills | FlashAlpha: mid-fill → limit-fill cut CAGR 30–60%; fills 4–7¢ worse than mid | EV computed net of `SPREAD_EXPECTED_SLIPPAGE=0.05`; alerts show mid and natural |
| Reject one-sided quotes | Aug 5 2024: VIX 65 from illiquid pre-market prints; bots stopping on those marks sold the low | bid = 0 or ask = 0 contracts are dropped |

## Where the evidence disagrees (kept configurable)

- **Short delta.** Academic (Israelov–Tummala): best return per unit of *stress* loss is near-the-money
  to moderately OTM (30–50Δ), because deep-OTM puts carry the fattest tails. Practitioner (ApexVol,
  tasty): expectancy peaks around 16Δ for spreads; the 12–25Δ band is a plateau (Theta Desk). This
  repo lists 0.16–0.30Δ, scores the 0.16–0.25 plateau highest, and penalises 0.30 by half.
- **Stop loss.** At 30–45 DTE a 2× credit stop on a $5/$1.65 spread is $3.30 of a $3.35 max loss,
  so it mostly adds whipsaw; FlashAlpha found a 200% stop *worse than no stop* at 30 DTE but a 100%
  stop essential at 7 DTE; Option Alpha found a 25% stop cut max loss sixfold. Width plus the 21 DTE
  exit is the defensible default for 45 DTE. `SPREAD_STOP_LOSS_MULTIPLE` stays at 2.0 as a prompt,
  not an automatic order; the monitor also flags a tested short strike (probability of touch ≈ 2×
  delta, so expect to be tested twice as often as you lose).
- **IV rank.** tasty: P/L per trade roughly doubles at high IVR, win rate unchanged. SJ Options: low-IVR
  SPX spreads outperformed because the average loser grew more than the winner. Treat IVR/IVP as a
  sizing dial, not a gate; this repo has no 52-week IV history from Schwab and uses IV/HV instead.
- **Trend filter.** Helps SPY, hurt GLD (Option Alpha); below the 200-DMA the S&P's daily move
  doubles. This repo makes it a hard gate for single stocks and a half-size factor for index ETFs
  (`SPREAD_INDEX_SYMBOLS`).
- **Skew.** Steep single-stock smirk predicts −10.9%/yr underperformance (Xing–Zhang–Zhao); index
  skew is hedging demand (Bollen–Whaley); the SKEW index's predictive sign flips by decade. Not
  implemented as a gate.

## What the literature says will go wrong

1. **Inversions and long underwater periods.** PUT's longest drawdown was 29 months. The premium
   is widest right after a crash (dealers flip to buying puts), so the plan is to keep selling
   smaller through spikes, not to stop after losses.
2. **Correlation to one.** Size to the simultaneous max loss of every spread (the −29% PUT drawdown
   in 23 trading days in March 2020, or a 20% one-day gap), not to the win rate.
3. **Leverage on top of the spread.** Volmageddon turned a −5% index-strategy week into −80% to
   −96% product losses. Portfolio margin lets you size past Reg T max loss; don't.
4. **Garbage marks.** Stale or one-sided quotes produced the Aug 2024 VIX print; any automation
   needs quote validation and a kill switch (Knight Capital: $440m in 45 minutes).
5. **Costs.** Goyal–Saretto's 22.7%/month gross edge shrinks to low single digits net; two legs
   rolled monthly on single names are where the edge leaks. Favour penny-wide names and few
   adjustments.

## Not yet implemented (would need data this repo does not keep)

- A per-name IV30 history to compute IV-rank, IV-percentile and the IV−RV z-score (Part 4 §4.2).
  The daily scan could start logging ATM IV to build it.
- Yang–Zhang realised vol from OHLC (more efficient than close-to-close; Part 4 §4.1).
- Beta-weighted net delta cap across open spreads (Parts 1 and 3).
- Drawdown breaker from an equity high-water mark (Part 3 §3.3); the repo does not yet track P&L history.
- A "flipped back to contango within 3 days" entry bonus (Part 4 §4.4).

---
## Part 1 — What the academic and index-provider evidence says

> Sourcing note: primary PDFs on cdn.cboe.com, SSRN, AQR, Columbia and UCLA were egress-blocked for the researcher, so figures were taken from search extracts plus open mirrors (RePEc, Duke, NBER, Cboe IR). **[UNVERIFIED]** marks anything not confirmed against a source.

### 1.1 The variance risk premium (VRP)

- **Carr & Wu (2009, RFS)** synthesise variance-swap rates from option portfolios and define the VRP as realised variance minus the swap rate. It is negative for all five US indexes and most of 35 single stocks; sellers earn a roughly constant *proportional* premium ([RePEc](https://ideas.repec.org/a/oup/rfinst/v22y2009i3p1311-1341.html)). A later replication puts the Sharpe of short SPX variance swaps at ~0.58 (2006–2020) ([CBS thesis](https://research.cbs.dk/files/92148091/1622265_Thesis_14_.pdf), secondary).
- **Bakshi & Kapadia (2003, RFS)**: delta-hedged SPX option portfolios lose money on average, consistent with a negative volatility risk premium that is "much lower for individual equities" — which is why IV and RV sit closer together in single-name options ([JoD extension](https://people.umass.edu/~nkapadia/docs/Bakshi_Kapadia_JoD_Fall_2003.pdf)).
- **Bollerslev, Tauchen & Zhou (2009, RFS)**: implied-minus-realised variance explains >15% of quarterly excess-return variation, dominating P/E and the default spread. **High VRP → high subsequent returns**: a wide VRP is both a richer premium and a bullish signal for the underlying ([Duke PDF](https://public.econ.duke.edu/~boller/Published_Papers/rfs_09.pdf)).
- **Magnitude.** VIX averaged 19.3% vs 15.1% realised over 1990–2018, a 4.2-point gap (Bondarenko 2019, [Cboe PDF](https://cdn.cboe.com/resources/education/research_publications/PutWriteCBOE19_v14_by_Prof_Oleg_Bondarenko_as_of_June_14.pdf)). AQR: positive 88% of the time, averaging 3.4%/yr 1986–2014 ([AQR](https://www.aqr.com/-/media/AQR/Documents/Whitepapers/Understanding-the-Volatility-Risk-Premium.pdf)). A practitioner series finds +3.0 pts and positive ~85% of months 1990–2025 ([Alphanume](https://www.alphanume.com/blog/vix-vs-realized-volatility)).
- **Term structure.** Dew-Becker, Giglio, Le & Rodriguez (2017, JFE): the variance-forward premium is 3.7 annualised points at 1 month and an insignificant 0.3 at 3 months — "only news about short-run realised variance is priced" ([NBER w21182](https://www.nber.org/system/files/working_papers/w21182/w21182.pdf)). **The premium lives in the front month.**
- **When it inverts.** RV > IV clusters in crashes: Oct 2008 (−25.1 pts), Feb 2018 (−15.2), Mar 2020 (−20.3) ([Alphanume](https://www.alphanume.com/blog/vix-vs-realized-volatility)). Chen, Joslin & Ni (2019, RFS): dealers flipped from sellers to buyers of deep-OTM SPX puts after Lehman, driving richness up ([RePEc](https://ideas.repec.org/a/oup/rfinst/v32y2019i1p228-265..html)).

### 1.2 Why puts are "expensive"

- **Bondarenko (2014, QJF; WP 2003)**: Aug 1987–Dec 2000 SPX puts earned −39%/month (ATM) and −95%/month (deep OTM); "no model within the studied class" rationalises it even allowing for a peso problem ([SSRN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=375784)).
- **Coval & Shumway (2001, JF)**: zero-beta ATM straddles lose ~3%/week; put expected returns are below the risk-free rate and increase with strike ([Wiley](https://onlinelibrary.wiley.com/doi/abs/10.1111/0022-1082.00352)).
- **Santa-Clara & Saretto (2009, JFM)**: short option strategies (naked puts, straddles, crash-neutral variants) earn "very high Sharpe ratios," but "margin calls force investors out of a trade precisely when it is losing money, turning the Sharpe ratio of some of the best strategies negative" ([UCLA PDF](https://www.anderson.ucla.edu/documents/areas/fac/finance/santa_clara_option.pdf)). **This is the academic case for defined risk.**
- **Broadie, Chernov & Johannes (2009, RFS)**: 1987–2005 average put returns ≈ −30%/mo ATM, ≈ −57%/mo OTM; but naked put returns are *statistically indistinguishable* from Black-Scholes/Heston because of extreme sampling error. Rational crash compensation, not free money ([Columbia PDF](https://business.columbia.edu/sites/default/files-efs/pubfiles/3964/broadie_chernov_johannes.pdf)).

### 1.3 Index-provider evidence (Cboe PUT, WPUT, CNDR, BXM, PPUT)

- **Wilshire (2019), Jun 1986–Dec 2018**: PUT 9.54%/yr vs S&P 500 9.80%; vol 9.95% vs ~14.9%; Sharpe 0.65 vs 0.49; max drawdown −32.7% vs −50.9%. PPUT (long 5% OTM put) 6.64%/yr, Sharpe 0.33. WPUT 4.51%/yr, Sharpe 0.40 (2006+) ([Wilshire/Cboe PDF](https://cdn.cboe.com/resources/spx/wilshire-options-based-benchmark-indexes-2019.pdf)).
- **Bondarenko (2019)**, 2006–2018: MDD WPUT −24.2%, PUT −32.7%, S&P −50.9%; longest drawdown 22/29/52 months; gross premium 22.1%/yr for PUT vs 37.1%/yr for WPUT. **WPUT collected more gross premium but earned a lower net return and Sharpe** — more frequent rolls mean more gamma/crash exposure and costs ([Hedgeweek](https://www.hedgeweek.com/new-cboe-study-examines-weekly-and-monthly-sp-500-putwrite-indexes/)).
- **Black & Szado (2016)**, 1986–2015: BXMD 10.66%, PUT 10.13%; lowest SD CNDR 7.23% ([Cboe IR](https://ir.cboe.com/news/news-details/2016/Study-Analyzes-Performance-of-CBOE-SP-500-SPX-Options-Selling-Indexes-02-23-2016/default.aspx)). CNDR sells ~20-delta put and call and buys ~5-delta wings monthly — the closest Cboe benchmark to a *defined-risk* short put.
- **Stress episodes.** In months when the S&P had large negative returns, average PUT monthly return was −2.93% vs −5.38% ([Cboe/Ennis Knupp](https://cdn.cboe.com/resources/education/research_publications/PUTIndexEnnisKnupp.pdf)). **Feb 2018**: PUT −4.76% for the week vs S&P −5.10%, "performed largely as expected," while XIV fell 96% and LJM lost ~80% ([Cboe](https://cdn.cboe.com/resources/education/research_publications/after-the-volpocalypse-market-observation.pdf)). **Mar 2020**: PUT −28.92% Feb 19–Mar 23 vs S&P −33.79% — only ~5 points of cushion in a fast crash ([GIA](https://www.gia.com/wp-content/uploads/2022/03/Active-Index-PutWrite-Composite-Commentary-Q1-2020.pdf)).

### 1.4 AQR research

- **Israelov & Nielsen, "Covered Calls Uncovered" (FAJ 2015)**: option writing decomposes into equity beta (most risk and return), short volatility (Sharpe ≈ 1.0 but <10% of risk) and an uncompensated "equity reversal" (dynamic delta) exposure worth ~25% of risk; hedging the delta improved Sharpe and cut downside beta ([AQR PDF](https://images.aqr.com/-/media/AQR/Documents/Insights/Journal-Article/Covered-Calls-Uncovered.pdf)).
- **"Still Not Cheap" (JPM 2015)**: it is the VRP (IV minus RV), not the IV level, that decides whether options are rich; low VIX ≠ cheap puts ([AQR PDF](https://www.aqr.com/-/media/AQR/Documents/Journal-Articles/JPM-Still-Not-Cheap.pdf?sc_lang=en)).
- **Israelov & Tummala, "Which Index Options Should You Sell?" (2017)**, SPX 1996–2015, delta-hedged: short puts beat short calls; shorter maturities beat longer; raw returns highest for short-dated moderately-OTM puts; but *per unit of stress-test loss* (20% one-day drop) the best strikes are front-month, **near-the-money and moderately below the index**. Deep OTM looks good on volatility but poor on stress risk ([AQR](https://www.aqr.com/Insights/Research/Working-Paper/Which-Index-Options-Should-You-Sell)).

### 1.5 Defined-risk (put spread) vs undefined (naked put)

No peer-reviewed paper on "do put spreads earn the VRP" was found. The evidence is indirect:
- The long wing is itself a short-VRP position: PPUT earned 6.64% vs PUT 9.54% with *higher* vol (Wilshire); OTM puts are rich even in calm markets ("Still Not Cheap"). Buying the wing pays away part of the premium and buys protection on exactly the strikes Bondarenko/BCJ find *most* overpriced.
- Santa-Clara & Saretto's crash-neutral strategies still had high Sharpe ratios and dramatically lower margin — the mechanism by which undefined-risk sellers are destroyed.
- CNDR (defined-risk 20Δ/5Δ) had the lowest SD of all Cboe selling indexes (7.23%).
- Practitioner backtest (non-academic): bull put spreads worst month −6% / drawdown 8% vs naked puts −28% / 29% ([OptionSamurai](https://optionsamurai.com/blog/bull-put-spreads-backtest/)).
- **Net:** spreads lower expected return per contract but convert the left tail from unbounded and margin-call-prone to bounded; return on *margin capital* can rise. Skew means the wing is cheapest relative to its payoff when bought close to the short strike.

### 1.6 Cross-section: which stocks to sell on

- **Goyal & Saretto (2009, JFE)**: sort on 12-month HV minus 1-month ATM IV; long-short decile straddles return 22.7%/month before costs, still significant after costs and margin. **Sell options where IV ≫ HV** ([ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0304405X09001251)).
- **Cao & Han (2013, JFE)**: delta-hedged option returns fall monotonically with idiosyncratic vol; dealers charge more on hard-to-hedge names. **Avoid the highest-idiosyncratic-vol names: their options are rich for a reason** ([Rotman PDF](https://www-2.rotman.utoronto.ca/facbios/file/Han_JFE_published.pdf)).
- **Xing, Zhang & Zhao (2010, JFQA)**: stocks with the steepest smirk underperform the flattest by 10.9%/yr risk-adjusted, persisting ≥6 months ([Cambridge](https://resolve.cambridge.org/core/journals/journal-of-financial-and-quantitative-analysis/article/what-does-the-individual-option-volatility-smirk-tell-us-about-future-equity-returns/ECFD16BA9ACBDC8D577D1BD866FBEA72)).
- Single-name VRP is smaller than index VRP (Bakshi–Kapadia; Carr–Wu), so a 10-stock program mostly earns idiosyncratic-vol premium plus stock beta, not the index crash premium.

### 1.7 Known failure modes

- **Peso problem / rare disasters**: Rietz (1988), Barro (2006). Backus, Chernov & Martin (2011, JF) find options imply *smaller* disaster probabilities than macro data — puts may not be overpriced relative to true disaster risk ([LSE PDF](https://personal.lse.ac.uk/martiniw/BCM-jf.pdf)).
- **Hedge-fund returns ≈ put writing**: Jurek & Stafford (2015, JF): hedge fund indexes are "not reliably distinguishable" from mechanical S&P put-writing ([Wiley](https://onlinelibrary.wiley.com/doi/abs/10.1111/jofi.12269)).
- **Crash correlation / feedback**: Augustin, Cheng & Van den Bergen (2021, FAJ): rebalancing feedback created ~90% investor losses on Feb 5 2018 ([CFA](https://rpc.cfainstitute.org/research/financial-analysts-journal/2021/volmageddon-failure-short-volatility-products)).
- **Margin/loss spirals**: Brunnermeier & Pedersen (2009, RFS): rising margins and losses reinforce; liquidity vanishes exactly when sellers must cover ([NYU PDF](https://pages.stern.nyu.edu/~lpederse/papers/Mkt_Fun_Liquidity.pdf)).
- **"Nickels in front of a steamroller"**: Duarte, Longstaff & Yu's phrase for negatively skewed carry ([UCLA](https://www.anderson.ucla.edu/documents/areas/fac/finance/769.pdf)).

### 1.8 What the literature implies for a retail bull-put-spread program

1. **Tenor: short (≤1 month), but not weekly.** The VRP is concentrated in the front month (3.7 vs 0.3 pts at 3 months), yet WPUT collected 37% gross vs PUT's 22% and still earned less. Monthly / 2–6 week expiries are the evidence-backed sweet spot.
2. **Short strike: near-the-money to moderately OTM, not deep OTM.** Best return per unit of 1987-style stress loss is front-month, near/moderately below spot (Israelov–Tummala); deep OTM puts carry the fattest left tail and worst margin behaviour for sellers.
3. **Long wing: buy it close, treat it as margin management.** The wing is a negative-EV put; its justification is Santa-Clara/Saretto's finding that margin calls, not average returns, kill undefined-risk sellers. Narrow spreads give up the least premium per unit of capped loss.
4. **Expect ~4 vol points of index VRP, less on single names.** Budget net Sharpe in the 0.5–0.7 range for an index program (PUT 0.65, variance swaps ~0.58), not the 1.0+ that gross option returns suggest.
5. **Sell when IV ≫ realised, not when IV is "high" or "low" in level.** A high VRP is also a bullish signal for the underlying (Bollerslev–Tauchen–Zhou).
6. **Stock screen for ~10 names:** rank by 1m IV minus HV; avoid the highest-idiosyncratic-vol names (Cao–Han); avoid names with an unusually steep put smirk vs their history (Xing–Zhang–Zhao).
7. **Know what you own: mostly equity beta.** Ten bull put spreads on correlated stocks are a leveraged long-equity book with a cap on upside.
8. **Hedge or cap net delta.** The dynamic delta was ~25% of risk and uncompensated (Israelov–Nielsen); for retail that means a fixed net-delta budget.
9. **Size to the stress loss, not to margin or the win rate.** Use a 20% one-day gap or PUT's −29% in 23 trading days as the sizing scenario; the max loss on every spread must be survivable simultaneously.
10. **Do not add leverage on top of the spread.** Volmageddon and LJM converted a −5% index-strategy week into −80% to −96% product losses.
11. **Expect inversions and long underwater periods.** The premium went negative ~12–20% of months and inverted by 15–25 vol points in Oct 2008, Feb 2018, Mar 2020; PUT's longest drawdown lasted 29 months. Keep selling (smaller) through spikes rather than stopping after losses, because post-crash IV is where the premium is widest.
12. **Transaction costs matter more for spreads and single names.** Two legs, rolled monthly, on names wider than SPX; Goyal–Saretto's 22.7% gross shrinks to low single digits net. Favour liquid, penny-wide names and avoid frequent adjustments.

**Unverified:** Coval–Shumway per-moneyness returns; Santa-Clara/Saretto specific Sharpe and margin-call frequencies; exact BCJ moneyness mapping; PUT calendar returns for 2008/2018/2020; CNDR and PUTY long-run stats; the exact AQR source of "88% / 3.4%".
## Part 2 — Practitioner and quant backtests of put credit spreads

> Method note: the researcher could not fetch primary pages directly (spintwig, optionalpha, flashalpha, quantpedia, orats, earlyretirementnow, cboe, arxiv); numbers come from search snippets and secondary summaries (7 Circles, dev.to mirror, CXO Advisory). **[snippet-only]**, **[conflicting]** and **[unverified]** are marked. Re-check against the page before relying on a figure.

### 2.1 spintwig (SPY/SPX short puts and put verticals)

**Tested grid.** Deltas 5/10/16/30/50; DTE 0, 7, 30, 45, 60 (45 is the flagship); exits: 25% max profit or 21 DTE, 50% or 21 DTE, 75% or expiration, hold to expiration; some add a 5× stop; cash-secured vs leveraged (100% margin utilisation) variants; 2007–2024 ([all backtests](https://spintwig.com/all-backtests/), [methodology](https://spintwig.com/methodology/)).

**Headline conclusions** ([7 Circles summary](https://the7circles.uk/options-9-ern-backtests-by-spintwig/), [efficiency](https://the7circles.uk/options-11-spintwig-efficiency/)):
- "Hold to expiry has probably the best Sharpe ratios overall, but 75% and 50% take-profits (and the 5× stop) are close."
- "Closing at 21 DTE is (slightly) more profitable than hanging on."
- "Taking profits is better than using stop losses."
- Exiting at 50% lowers total return vs holding (fewer dollars per cycle) but win rates are high for both.
- Win rate on held-to-expiry short puts is higher than delta implies "across the board" (IV overstates realised vol).

**SPY Wheel 45 DTE, 2007–2024** ([page](https://spintwig.com/spy-wheel-45-dte-options-backtest)) **[snippet-only, conflicting]**: one extract gives hold-to-expiry CAGR 5.5–7.3% by delta, vol 7.4% (5Δ) to 16.1% (50Δ) vs SPY 15.8%, MDD −16% (5Δ) to −51% (16Δ); 5Δ Sharpe 1.00 vs SPY 0.63. Another extract gives the 5Δ put leg at CAGR −0.11% and leveraged MDDs of −62% to −315%. Do not use either without reading the page.

**SPX short put 45 DTE, s1 signal, 2007–2024** ([page](https://spintwig.com/short-spx-put-45-dte-s1-signal-options-backtest)): 50-delta, hold, leveraged. Daily entry Sharpe 0.57, MDD −65%, DD duration 1,092 days. Entering only when the proprietary "s1" flag says options are overpriced: Sharpe 0.98, MDD −32%, DD duration 194 days ([s1](https://spintwig.com/s1/)). Not reproducible, but shows how much a vol-mispricing filter adds. The 7-DTE vertical put got *deeper* drawdowns when filtered to overpriced days (−40% → −48%) **[snippet-only]**.

### 2.2 Option Alpha

**"8 SPY Put Credit Spread Backtest Results"** ([page](https://optionalpha.com/blog/spy-put-credit-spread-backtest)) **[snippet-only]**: 0.30Δ short / 0.10Δ long, 30 DTE, one position at a time, 5% and 10% allocation, 5 years.
- Hold to expiry, no target/stop: 93% win rate, no consecutive losses, but "occasional losses were large" — max loss $12,000 at 10% allocation.
- 50% PT, 25% SL, close at 15 DTE: max loss cut to $2,000, volatility "dramatically" lower.
- SL raised to 50%: more downside, no gain in average profit.

**Trend filters** ([trend trading](https://optionalpha.com/podcast/trend-trading)): entering only above the 200-day SMA improved win rate on SPY and avoided losers below it; on GLD the filter "actually hurt performance overall." **Mixed.**

**"Trendy Short Put Spread" bot** ([page](https://optionalpha.com/podcast/trendy-short-put-spread-bot)): SPY, 0.15Δ/0.05Δ, 50% PT, only if VIX < 40 and price > 200 SMA: +52.1% on $1,000, 93.8% win, profit factor 1.93 **[snippet-only]**.

**DIA put credit spread, IVR filter** ([page](https://optionalpha.com/podcast/credit-spread-backtest)): 40Δ short, 5 strikes wide, ~50 DTE, IVR ≥ 50, 50% PT, no stop, **50% allocation**: lost 71% despite avg credit $150 and 14% return per spread — an early drawdown never recovered. **The lesson is sizing, not signal.**

**Stop-loss episode** ([page](https://optionalpha.com/podcast/stop-loss-strategies-for-options)): 10-day short strangle returned 6,349% with no stop vs 4,420% with a 300% stop — stops hurt long-DTE trades but are essential at short DTE.

### 2.3 Independent quant backtests

**FlashAlpha, 96 SPY PCS strategies, 7 years, 1-minute chains, 16,024 trades** ([article](https://flashalpha.com/articles/spy-put-credit-spread-active-backtest-mm-fills-vrp-signal-drawdown-breaker), [bug log](https://dev.to/tomasz_dobrowolski_35d32c/i-backtested-96-spy-put-credit-spread-strategies-heres-the-bug-log-1li3)): grid = delta × DTE × profit target × stop; market-maker-style limit fills (20–25% fill rate, 4–7¢ worse than mid), VRP gate, half-Kelly, 30% drawdown breaker.
- 10Δ / 7 DTE / 50% PT: no stop → −100%; 100%-of-credit stop → +5,439% total / 66% CAGR.
- **Stop = 200% of credit was worse than no stop** in that cell: by the time a spread is down 200% it is deep ITM and gamma dominates.
- Pooling multiple DTEs underperformed single-DTE; the best signal "in 16k trades was a one-line flag that beat a 3-layer composite."
- Verdict: "the edge is real but much smaller than YouTube claims, almost entirely conditional on tight stop losses, and concentrated in a narrow band of the (delta, DTE, PT) grid."
- Companion on look-ahead bias ([dev.to](https://dev.to/tomasz_dobrowolski_35d32c/look-ahead-bias-in-volatility-backtests-why-most-vrp-percentiles-silently-cheat-and-how-to-fix-4jg0)): gating on "VRP percentile > 80" with full-sample percentiles inflates Sharpe 15–30% vs walk-forward.

**"18 million SPY put spreads, 2018–2026"** ([Medium](https://medium.com/@diseasex/i-priced-18-million-spy-put-spreads-across-8-years-every-bucket-was-ev-every-year-made-money-6b1384e8b02c)): every expiry, short delta 0.05–0.40, widths 1–20. Under flat-vol Black-Scholes every bucket has negative theoretical EV (avg −$0.48) yet realised P&L averaged +$0.58 (the skew premium), realised win rate 92.9%, max-loss rate 5.6%. Absolute P&L rises with DTE but annualised ROC does not; **"22–90 DTE is the comfortable zone."**

**ApexVol 60-cycle SPY PCS, monthly 2020–2024, 30 DTE, $5 wide** ([page](https://apexvol.com/strategies/credit-spread/backtest)) **[snippet-only]**: 10Δ 85% win, −$33/cycle; **16Δ 75% win, +$10/cycle (+$585 total, −15% MDD)**, avg credit $125, avg win +$63, avg loss −$150; 20Δ +$7; 30Δ −$6. **Expectancy peaks at 16Δ.**

**Options Cafe live journal** ([page](https://options.cafe/blog/spy-put-credit-spreads-strategy/)): SPY, 30–45 DTE, 0.15–0.20Δ short, $5 wide, risk 1–2% per spread. 2022–Apr 2026: 156 trades, 91%+ win, +$15,226. Their VIX Rank ≥ 70 gate cut trades 165 → 91, lifted profit factor 1.64 → 2.52, cut DD 12.9% → 8.7% ([page](https://options.cafe/blog/momentum-rsi-strategy-backtest-results/)).

**ORATS** ([VIX spike rule](https://orats.com/blog/sell-put-spread-when-vix-spikes-exit-based-on-max-profit), [180M strategies](https://www.nasdaq.com/articles/backtesting-180-million-options-strategies-insights-orats-latest-research)): published rule set: SPY 2-week put spread 30Δ/15Δ, enter when VIX is up ≥ 10% over the prior week, exit at 80% of max profit or when loss = max profit, roll when spot reaches the short strike — performance **[unverified]**. In low-VIX regimes the best SPY short put spreads "almost always" had a low spread/stock yield ratio (far OTM, small credit). ORATS fills assume 56–75% of bid-ask slippage.

### 2.4 tastylive / tastytrade research (text summaries, secondary)

- **"Trade small, trade often" strangle study**: 16Δ, 45 DTE, 5 underlyings, 314 occurrences: manage at 50% → $7,209 total, 90% win; hold → $12,297, 82% win (vs 68% theoretical). Largest single loss $721 (high IV) vs $2,655 (low IV) ([summary](https://www.wenxuecity.com/blog/201507/60718/13280.html)).
- **SPY 45 DTE strangles, IVR > 50**: 30Δ 81% win / $65 avg; 16Δ 90% / $36; 5Δ 97% / $10. "IVR does not impact win rate noticeably, but P/L per trade is significantly higher when IVR is higher" ([Volatility Box](https://volatilitybox.com/research/iv-rank-vs-iv-percentile/)).
- **Defined vs undefined risk** (SharpeTwo replication): 30Δ SPY strangle since 2007 ≈ 5.3%/yr vs 30Δ iron condor with 20Δ wings ≈ 0.15%/yr; wings cost 28% of credit but give up 42% of vega ([SharpeTwo](https://sharpetwo.com/blog/iron-condor-vs-short-strangle/)). Buying-power framing: put vertical $4,500 BP / 10% ROC vs naked put $6,300 / 4.8% ([datadrivenoptions](https://datadrivenoptions.com/strategies-for-option-trading/favorite-strategies/credit-put-spread/)).

### 2.5 VIX-regime and signal filters

- **Term structure.** VIX/VIX3M < 1 ~80% of the time; a QuantConnect community rule "short vol if VIX/VXV < 0.95" reported Sharpe 1.8–2 **[community, unverified]** ([QuantConnect](https://www.quantconnect.com/forum/discussion/2657/a-simple-vix-strategy/)). Quantpedia's VIX futures term-structure strategy: 19.7% p.a. in-sample 2007–2011 but slightly negative out-of-sample ([Quantpedia](https://quantpedia.com/strategies/exploiting-term-structure-of-vix-futures)).
- **Dual VIX signal (Zarattini, Aziz, Mele 2025)**: expected VRP = VIX − annualised 10-day realised SPY vol, plus VIX vs VIX3M slope, position scaled by VIX level. 2016–2026 Sharpe 0.73 vs SPY 0.58; all 25 parameter combos beat the benchmark; paper 2008–2025 16.3% CAGR, Sharpe ≈ 1.0 ([QuantConnect](https://www.quantconnect.com/research/21143/harvesting-the-volatility-risk-premium-with-a-dual-vix-signal/), [SSRN](https://ssrn.com/abstract=5316487)).
- **Sell after a vol spike.** IV spikes of 5+ points were followed by +5.12% 20-day SPY returns, ~5× baseline ([iVolatility](https://www.ivolatility.com/news/3131)). Counter-risk: in backwardation large moves are more likely.
- **200-DMA.** Below the 200-DMA the S&P's average daily move is 2.09% vs 1.05% above ([Quantified Strategies](https://www.quantifiedstrategies.com/200-day-moving-average/)); Option Alpha's filter helped SPY but hurt GLD. **Use as a sizing/regime input rather than a hard gate for indices.**
- **SKEW.** Predictive sign flips by decade; not recommended as a gate ([ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S1062940820302370)).

### 2.6 Quantpedia and the Cboe benchmark

- **Volatility Risk Premium Effect** ([Quantpedia](https://quantpedia.com/strategies/volatility-risk-premium-effect)): monthly sell a 1-month ATM S&P straddle, buy 15% OTM puts as tail insurance. Indicative 26% p.a. (1986–1995 source), vol 19%, MDD −24%, Sharpe 1.16; "absolutely not a hedge" in bear markets; naked put sellers incurred losses up to −800%.
- Benchmark: Cboe PUT 1986–2018 CAGR 9.54% vs S&P 9.80%, Sharpe 0.65 vs 0.49; 2006–2018 MDD −32.7% (PUT), −24.2% (WPUT), −50.9% (S&P) ([Bondarenko](https://cdn.cboe.com/resources/education/research_publications/PutWriteCBOE19_v14_by_Prof_Oleg_Bondarenko_as_of_June_14.pdf)).

### 2.7 Position sizing in the backtests

- **Spintwig**: leveraged wheel MDDs of −62% to −315% vs cash-secured −16% to −51% — drawdown scales faster than linearly with leverage **[snippet-only]**.
- **Early Retirement Now (SPX puts, live)**: ≤ 0.05Δ, 2–3 DTE; leverage cut from 3–3.5× to 2–2.5× after Feb 2018; made money in March 2020 selling 20% OTM ([ERN](https://earlyretirementnow.com/2020/06/10/passive-income-through-option-writing-part-4/)).
- **Wysocki (2025), "Sizing the Risk: Kelly, VIX, and Hybrid"**: hybrid Kelly/VIX sizing gave the best drawdown control for index put-writing ([arXiv](https://arxiv.org/abs/2508.16598)).
- **FlashAlpha**: half-Kelly + 30% drawdown breaker. **Option Alpha**: 50% allocation produced −71%. **Options Cafe**: 1–2% at risk per spread. Half-Kelly keeps ~75% of growth; quarter-Kelly if < 150 trades ([backtrex](https://backtrex.com/en/blog/position-sizing-kelly-criterion-trading)).

### 2.8 Tested rule sets and results

| Strategy | Source | DTE | Delta / width | Management | Filter | CAGR | Sharpe | Max DD | Win rate |
|---|---|---|---|---|---|---|---|---|---|
| SPY cash-secured put (wheel), hold | spintwig 2007–24 [conflicting] | 45 | 5Δ | hold | none | 7.3% | 1.00 | −16% | n/a |
| SPX short put, leveraged, daily entry | spintwig 2007–24 | 45 | 50Δ | hold | none | n/a | 0.57 | −65% | n/a |
| SPX short put, leveraged, s1 days | spintwig 2007–24 | 45 | 50Δ | hold | s1 "overpriced" | +12% PnL vs above | 0.98 | −32% | n/a |
| SPY PCS test 1 | Option Alpha 5y | 30 | 0.30/0.10Δ | hold | none | n/a | n/a | $12k max loss @10% | 93% |
| SPY PCS test 2 | Option Alpha 5y | 30 | 0.30/0.10Δ | 50% PT, 25% SL, 15 DTE | none | n/a | n/a | $2k max loss | n/a |
| Trendy PCS bot | Option Alpha | n/a | 0.15/0.05Δ | 50% PT | VIX<40 & >200SMA | +52% total | n/a | n/a | 93.8% |
| SPY PCS best cell | FlashAlpha 7y | 7 | 10Δ | 50% PT, 100% SL | VRP flag, ½-Kelly, 30% breaker | 66% | n/a | n/a | n/a |
| Same cell, no stop | FlashAlpha | 7 | 10Δ | 50% PT | — | −100% | — | −100% | — |
| SPY PCS monthly | ApexVol 2020–24 | 30 | 16Δ, $5 | 50% PT | none | +$585/60 cycles | n/a | −15% | 75% |
| SPY PCS (live) | Options Cafe 2022–26 | 30–45 | 0.15–0.20Δ, $5 | 1–2% risk | discretionary | n/a | n/a | n/a | 91% |
| SPY 1-SD strangle | tastylive 314 occ. | 45 | 16Δ | 50% PT | none / high IV | n/a | n/a | worst −$2,655 | 90% (82% hold) |
| Cboe PUT index | Bondarenko 1986–2018 | 30 | ATM | hold | none | 9.54% | 0.65 | −32.7% | n/a |
| Cboe WPUT | Bondarenko 2006–18 | 7 | ATM | hold | none | 4.51% | n/a | −24.2% | n/a |
| ATM straddle + 15% OTM put | Quantpedia VRP | 30 | ATM | hold | none | 26% (1986–95) | 1.16 | −24% | n/a |
| Dual-VIX short vol | QuantConnect/Zarattini 2016–26 | n/a | n/a | daily | VRP>0 & contango | 16.3% (paper) | 0.73 (1.0 paper) | n/a | n/a |

### 2.9 Rules worth coding

1. **Structure/DTE:** 30–45 DTE; the 22–90 DTE band is where realised ROC is best; avoid pooling several DTEs in one book.
2. **Short strike:** 16Δ expectancy peak for spreads (ApexVol; tasty 1-SD); 30Δ+ only with tight stops.
3. **Width:** $5 on SPY-class names, long leg ≈ 0.05–0.10Δ; credit ≥ ~1/3 of width **[heuristic]**.
4. **Profit target:** 50% of credit (tasty, Option Alpha, ApexVol); never let a winner run past 21 DTE.
5. **Stop loss:** for ≤ 14 DTE a 100%-of-credit stop is mandatory (FlashAlpha); **do not use a 200% stop** (worse than none). For 45 DTE defined-risk spreads rely on the width plus a 21 DTE exit, or a 25%-of-credit stop.
6. **VRP gate:** IV30 − RV20 > 0 (IV/RV ≥ 1.10) using walk-forward history.
7. **Term-structure gate:** trade only in contango (VIX/VIX3M < 1.0); consider re-entering 1–3 days after a VIX spike of ≥ 5 pts, with reduced size.
8. **IV rank:** do not require IVR > 50 (win rates barely change) but scale size with it; hard-skip only when VIX > 40.
9. **Trend:** price > 200-DMA as a sizing multiplier (full above, half below) rather than a binary gate.
10. **Sizing:** 1–2% of equity per spread; half-Kelly cap from trailing 150+ trade stats; portfolio-level 30% drawdown breaker. Never allocate 50% to one spread.
11. **Single names:** no public backtest covers them; skip entries spanning earnings, cut size ~50% vs SPY/QQQ/IWM, prefer spreads over naked puts **[extrapolation]**.
12. **Execution model:** assume fills 4–7¢ worse than mid; mid-fill backtests overstate the edge.
## Part 3 — Quantitative risk management for short put-spread programs

> Verification note: the research sandbox could not fetch most primary sources directly (SSRN, Wiley, NBER, AQR, Cboe, SEC, spintwig, flashalpha, optionalpha). Claims come from search excerpts of those pages and from the researcher's own calculations ("own calc"). **[snippet]** = seen only in a search excerpt; **[unverified]** = number not confirmed against the primary. Treat backtest figures as indicative.

### 3.1 Position sizing math for negatively skewed payoffs

**Kelly for a binary bet.** With win probability p, q = 1−p and win/loss ratio b: f* = (p·b − q)/b, expected log-growth g = p·ln(1+f·b) + q·ln(1−f). Betting more than 2f* yields negative growth. Thorp shows that at full Kelly the probability of ever drawing down to fraction x of starting wealth is x (a 50% drawdown is a coin flip); for fractional Kelly f = c·f* it is roughly x^(2/c − 1) ([Thorp 2007](https://web.williams.edu/Mathematics/sjmiller/public_html/341/handouts/Thorpe_KellyCriterion2007.pdf)). Practitioners universally recommend half or quarter Kelly because full Kelly is very sensitive to an overestimated win rate ([pfolio.io](https://www.pfolio.io/academy/kelly-criterion)).

**Worked example (own calc): $5-wide bull put spread, $1.65 credit, 80% POP.**
- Max loss = $3.35/share; b = 1.65/3.35 = 0.4925. Breakeven p = 1/(1+b) = 0.67 — an "80% POP" trade has only ~13 points of cushion before it is a losing bet.
- Full Kelly at p = 0.80: f* = **39.4% of equity at risk per trade**; half Kelly 19.7%, quarter Kelly 9.8%.
- Sensitivity: p = 0.85 → f* = 54.5%; p = 0.75 → 24.2%; p = 0.70 → 9.1%; p = 0.67 → 0. A 5-point error in p moves the "optimal" size by ~15 points of equity.
- Estimation-error catastrophe: size at full Kelly for p = 0.80 but true p = 0.72 → g = −0.0125 per trade (negative growth). Half Kelly still grows down to p ≈ 0.72.
- Drawdown odds (Thorp): full Kelly P(ever hit 50% of start) = 50%; half Kelly 12.5%; quarter Kelly 0.8%.
- **Why practitioners use 1–2% max loss per trade, not 10–40%:** (i) the 80% POP is a model delta and realised POP is lower in selloffs; (ii) 10 single-name spreads are ~one bet in a crash (§3.4), so the per-trade fraction must be divided by the number of correlated positions; (iii) gap risk makes the loss distribution non-binary. $50k at 1% → 1 contract; $100k at 2% → 5 contracts.
- **Risk of ruin.** Kaufman: RoR = [(1−E)/(1+E)]^u, E = win% − loss%, u = max-loss units before ruin ([bettersystemtrader](https://bettersystemtrader.com/riskofruin/)). p = 0.75, u = 10 → RoR ≈ 1.7e-5; u = 5 → 4e-3. These assume independent trades — invalid in a crash cluster, so they understate ruin for short vol.

### 3.2 Volatility targeting / regime-based sizing

- Moreira & Muir (JF 2017): scaling exposure by c / previous month's realised variance raises Sharpe and produces large alphas because changes in volatility are not offset by proportional changes in expected returns ([Wiley](https://onlinelibrary.wiley.com/doi/abs/10.1111/jofi.12513), [NBER w22208](https://www.nber.org/papers/w22208)).
- Harvey et al. (JPM 2018): vol targeting raises Sharpe mainly for risk assets — US equity ~0.40 → 0.48–0.51 **[snippet]** — and "reduces the likelihood of extreme returns… left-tail events tend to be less severe as they typically occur when volatility is elevated and target-volatility portfolios have smaller notional exposure" ([SSRN 3175538](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3175538), [Quantpedia](https://quantpedia.com/the-impact-of-volatility-targeting-on-equities-bonds-commodities-and-currencies/)).
- Application: exposure_t = min(cap, σ_target / σ̂_t) with σ̂ = 20–60-day realised vol or VIX. Cboe's S&P 500 Volatility-Managed BuyWrite (BXMVM) is built on this ([methodology](https://cdn.cboe.com/api/global/us_indices/governance/BXMVM_Methodology.pdf) **[unverified parameters]**). An arXiv paper compares Kelly, VIX-scaled and hybrid sizing for put writing ([arXiv 2508.16598](https://arxiv.org/pdf/2508.16598)) **[unverified contents]**.
- Practitioner VIX buckets **[snippet]**: VIX < 15 cut size 20–30% and widen to 20–25 delta (thin premium); 15–25 normal; 25–30 normal/aggressive; > 30 cut size ~30% ([quantwheel](https://quantwheel.com/learn/position-sizing), [The Multiplier](https://themultiplier.substack.com/p/selling-options-high-vix-risk-management)). The tension: high VIX = richer VRP but exactly when vol-targeting says shrink notional; quants resolve it by keeping **dollar vol** constant — more credit per contract, fewer contracts.

### 3.3 Drawdown controls / circuit breakers

- FlashAlpha's 96-strategy SPY put-credit-spread grid (2019–2026, limit-fill model, half-Kelly) used a **30% equity drawdown breaker** halting the run: "if your strategy needs 30% drawdown to work, you don't have a strategy, you have a martingale" ([flashalpha](https://flashalpha.com/articles/spy-put-credit-spread-active-backtest-mm-fills-vrp-signal-drawdown-breaker)) **[snippet]**.
- Trend filter: Option Alpha's "Trendy Short Put Spread" bot found entering only above the 200-day MA improved win rate and avoided losers in downtrends ([Option Alpha](https://optionalpha.com/podcast/trendy-short-put-spread-bot)) **[snippet]**. Quantpedia's VRP page warns of potential losses up to −800% without such filters ([Quantpedia](https://quantpedia.com/strategies/volatility-risk-premium-effect)).
- Consecutive-loss / equity-curve filters: weak, conditional evidence — they help only when returns are serially correlated ([KJ Trading](https://kjtradingsystems.com/equity-curve-trading.html), [Build Alpha](https://www.buildalpha.com/equity-curve-trading/)). Short-vol P&L *is* serially correlated in crises, the one setting where a pause rule is defensible — pair it with a vol-based re-entry (VIX below its 20-day mean, or term structure back in contango) rather than a calendar timer.

### 3.4 Correlation and crash behaviour

- Cboe implied-correlation indices (COR1M/COR3M) spiked in 2008–09 and March 2020; "the market was behaving as one large, undifferentiated entity" ([Cboe whitepaper](https://cdn.cboe.com/resources/indices/documents/Cboe_USO_ImpliedCorrelation_0421_v2.0.2.pdf)). Ten 16-delta put spreads on ten names is one levered SPX put spread with idiosyncratic noise added.
- Beta-weighting: β-weighted delta = Δ × S × β / S_SPY ([tastytrade](https://support.tastytrade.com/support/s/solutions/articles/43000522492)). Cap it, and also compute "portfolio max loss if every spread goes to full width".
- **Feb 5 2018:** VIX +116% in a day; XIV −96%, SVXY −91%; XIV terminated ([sixfigureinvesting](https://www.sixfigureinvesting.com/2019/02/what-caused-the-february-5th-2018-volatility-spike-xiv-termination/)). LJM Preservation & Growth ($812m) fell ~80% in 48 hours ([SteadyOptions](https://steadyoptions.com/articles/the-spectacular-fall-of-ljm-preservation-and-growth-r336/)).
- **Dec 2018:** S&P −9% for the month, −14% Q4, VIX > 35 intraday Dec 24. A slow grind, not a gap: 45-DTE spreads opened in Nov/Dec hit stops repeatedly; no-stop variants were whipsawed less.
- **March 2020:** Mar 16 S&P −12%, VIX 82.69 record close ([Cboe](https://www.cboe.com/insights/posts/vix-index-attribution-of-notable-tail-events/)). Cboe PUT index −28.9% peak-to-trough vs S&P −33.8% ([GIA](https://www.gia.com/wp-content/uploads/2022/03/Active-Index-PutWrite-Composite-Commentary-Q1-2020.pdf)) **[snippet]**.
- **Aug 5 2024:** VIX printed 65+ pre-market (from ~23), the largest intraday % spike on record, then closed ~39; VIX futures stayed < 35 — a 30-point basis caused by illiquid pre-market SPX quotes ([SEC DERA](https://www.sec.gov/about/divisions-offices/division-economic-risk-analysis/staff-papers-analyses/demystify-surge-vix)). Inverse-VIX index −28.2%, SVOL −10.2% Jul 31–Aug 5 ([Simplify](https://www.simplify.us/etfs-use-case/navigating-historic-vix-spike-svol)). **Lesson for automation: greeks and marks from pre-market quotes were garbage; a bot acting on them would have stopped out at the worst prints.**

### 3.5 Managing losers quantitatively

- **Stops vs no stops (SPY 2019–2026, limit fills) [snippet]:** 10-delta / 7 DTE / 50% PT: stop at 100% of credit → +5,439%, 30% MDD; *same config with no stop → −100%* from one tail event. But at 45-delta / 30 DTE / 50% PT: no stop +30.6%, stop 100% +28.0%, stop 200% *worse than no stop* ([flashalpha](https://flashalpha.com/articles/spy-put-credit-spread-active-backtest-mm-fills-vrp-signal-drawdown-breaker)). Takeaway: stops are essential at short DTE/low delta and near-neutral or harmful at 30–45 DTE where the width already caps loss; a 2× credit stop on a $5/$1.65 spread is $3.30 of a $3.35 max loss, so it mostly adds whipsaw.
- Spintwig SPX/SPY series (2007–2024): 45-DTE short puts with 50%-profit/21-DTE management had MDD −25% vs SPY −51% ([spintwig](https://spintwig.com/short-spx-vertical-put-45-dte-s1-signal-options-backtest/)) **[snippet]**.
- **Probability of touch ≈ 2×delta**, so a 16-delta short strike has ~32% touch probability vs ~16% ITM-at-expiry; tastylive's realised study finds puts managed at 21 DTE touch only ~0.8× delta on average ([ThetaEdge](https://thetaedge.ai/blog/calculate-probability-of-touch)) **[snippet]**. A stop at the short strike fires roughly twice as often as the trade would have lost at expiry.
- **21 DTE / gamma (own calc, Black-Scholes, σ = 25%, 16-delta short put).** Γ/θ is nearly constant across DTE (~1.2), so "gamma/theta" is the wrong lens; what explodes is loss *relative to premium* for a fixed move: a −3% move costs 81% of premium at 45 DTE, 134% at 21 DTE, 299% at 7 DTE, 1,496% at 1 DTE; a −5% move: 158% / 279% / 685% / 3,253%. Past ~21 days you are short a near-ATM-sized tail for a fraction of the premium.
- **50% profit target:** after 50% of credit is earned, remaining reward is $0.83 against $3.35 risk (b falls 0.49 → 0.25), so the trade must have p > 0.80 just to break even; closing recycles capital into fresh 0.49-ratio trades. Option Alpha's SPY bot: 7.3% CAGR / 29% MDD at 10% allocation vs 4.8% / 12.1% at fixed $1,000 ([Option Alpha](https://optionalpha.com/blog/spy-put-credit-spread-backtest)) **[snippet]** — sizing dominated the exit rule.
- Rolling vs closing: no independent backtest located; treat a roll as "close + new trade" and apply entry rules to the new leg. **[unverified]**

### 3.6 Defined-risk considerations

- Reg T requirement = width − credit ([FINRA](https://www.finra.org/rules-guidance/key-topics/margin-accounts)). Portfolio margin stress-tests the book (±15% for broad indices), needs $125k, and can set spread BP *below* width − credit — the trap is sizing past Reg T max loss while the stress shock expands in a crash ([tastytrade PM](https://tastytrade.com/learn/accounts/account-resources/what-is-portfolio-margin-how-it-works/)).
- Assignment: OCC auto-exercises ≥ $0.01 ITM; a short put assigned while the long expires OTM leaves you long 100 shares/contract over the weekend ([Schwab](https://www.schwab.com/learn/story/money-due-handling-credit-spread-assignment)). Early put assignment is rational when extrinsic < interest on strike cash — deep ITM, high rates, near expiry ([protraderdashboard](https://protraderdashboard.com/blog/early-assignment-risk/)).
- Why "defined" ≠ realised: closing in a gap means paying the ask on the short and hitting the bid on the long — wings can carry $0.30–1.00 markets in a selloff; assignment plus after-hours moves; stops filled at pre-market-garbage marks. Model realised max loss as width − credit + 2× worst-case half-spread.

### 3.7 Tail-hedge overlays

- AQR, Israelov "Pathetic Protection" (JAI 2019): rolling 5%-OTM monthly S&P puts earned the same 2.5% excess CAGR as a 36.5/63.5 S&P/cash mix ([AQR](https://images.aqr.com/-/media/AQR/Documents/Journal-Articles/Pathetic-Protection-JAI-Wint19.pdf)). "Still Not Cheap" (JPM 2015): even at low IV, puts are expensive vs subsequent realised ([AQR](https://www.aqr.com/-/media/AQR/Documents/Journal-Articles/JPM-Still-Not-Cheap.pdf?sc_lang=en)). AQR argue trend/vol-scaling beats bought puts ([AQR trend vs puts](https://images.aqr.com/-/media/AQR/Documents/Insights/White-Papers/AQR-Tail-Risk-Hedging-Contrasting-Put-and-Trend-Strategies.pdf)).
- Universa: March 2020 +3,612% on "required invested capital" (~$40m of a ~$4bn mandate) — "legit but with an asterisk" ([Advisor Perspectives](https://www.advisorperspectives.com/articles/2020/05/06/an-aqr-warning-and-a-3-612-return-fire-up-the-black-swan-debate)) **[snippet]**.
- For a retail short-premium book the cheapest hedge consistent with the evidence is **holding less** (vol-scaling), then far-OTM SPX/SPY puts or VIX calls sized to cover aggregate width − credit at a −15% index shock.

### 3.8 Operational risk

- Fill model: mid-fill → realistic limit fills cut CAGR 30–60% across FlashAlpha's grid and flipped some cells negative **[snippet]**; traders report fills 50–100% worse than mid in illiquid names ([SteadyOptions](https://steadyoptions.com/articles/option-trading-and-slippage-the-bid-%EF%BB%BFask%EF%BB%BF-%EF%BB%BF%EF%BB%BFspread%EF%BB%BF%EF%BB%BF-explained-r753/)).
- Stale data: the Aug 5 2024 VIX print came from illiquid pre-market quotes; greeks from stale/one-sided quotes should fail validation (bid = 0, spread > X% of mid, quote age > N s).
- Token expiry: Schwab access tokens live 30 min, refresh tokens 7 days non-extendable ([field notes](https://github.com/Jorg-AI-JorgAI/schwab-trader-api-field-notes)).
- Kill switch precedent: Knight Capital, Aug 1 2012, $440m lost in 45 minutes ([Global Treasurer](https://www.theglobaltreasurer.com/2012/08/03/knight-capital-suffers-us440m-trading-loss-from-software-glitch/)).

### 3.9 Risk rules worth coding (defaults for a retail Reg T account)

"Judgment" = the researcher's synthesis, not a published parameter.

1. **Per-trade max loss ≤ 1% of equity.** Quarter-Kelly on an honest p ≈ 0.72 for the $5/$1.65 structure is ~5%; divided by ~5 effective independent bets → ~1%. [Thorp; own calc]
2. **Aggregate max loss (all spreads to full width) ≤ 10% of equity.** [judgment from §3.4]
3. **Beta-weighted SPY delta cap:** net exposure ≤ 50% of a long-SPY portfolio. [tastytrade; judgment]
4. **Vol-scaled contract count:** contracts = base × min(1, 18 / VIX) when VIX > 18; block new entries when VIX > 35 or VIX term structure is in backwardation. [Moreira–Muir; Harvey et al.; buckets unverified]
5. **Drawdown breaker:** pause new entries at −8% from equity high-water mark; cut the book 50% at −12%; full halt at −20%. Re-enter only after VIX < its 20-day mean for 3 sessions. [FlashAlpha 30% hard halt; thresholds are judgment]
6. **Consecutive-loss pause:** after 3 consecutive full-stop losses, halt new entries 5 trading days or until rule 5's re-entry. Weak evidence; ops sanity check.
7. **Stop rule:** at 30–45 DTE, stop when spread mark ≥ 2× credit **or** underlying closes below the short strike; skip a 3× stop. Use closing marks or 15-min persistence, never a single pre-market print. [FlashAlpha; SEC DERA; own calc]
8. **DTE exit:** close or roll at 21 DTE regardless of P&L. [own gamma calc; tastylive]
9. **Profit target:** close at 50% of credit. [EV logic; Option Alpha/spintwig snippets]
10. **Entry quality:** skip if spread bid–ask > 10% of width; require underlying above its 200-day MA. [Option Alpha; slippage sources]
11. **Fill model & slippage budget:** submit at mid, walk 1¢ every 20–30 s toward natural; stop the strategy if 20-trade rolling slippage > 25% of average credit. [FlashAlpha]
12. **Assignment guard:** on expiration day close any spread with the short strike within 1% of spot by 3:30 pm ET; close any ITM spread with short-leg extrinsic < $0.05; never hold an ITM short put over a weekend. [OCC; Schwab/IBKR]
13. **Data validation kill switch:** reject quotes with bid = 0, spread > 30% of mid, or stale timestamps; if > 20% of a chain fails, freeze order submission. [SEC DERA Aug 5 2024]
14. **Credential heartbeat:** alert at T−24 h of refresh-token expiry; if the bot cannot authenticate during RTH, alert and optionally rest GTC closes at 2× credit as a dead-man's switch. [Schwab field notes; Knight Capital]
15. **Monitoring cadence:** mark the book every 5–15 min during RTH, at 9:35 and 3:45 pm ET; log every rule evaluation.

**Unverified / confirm before relying on:** exact FlashAlpha and spintwig tables; BXMVM parameters; tastylive 0.8× touch multiplier; the "15–20% 21-DTE improvement"; Universa CAGR claim; VIX bucket thresholds (rules 4–5 are synthesis, not published defaults).
## Part 4 — Quant signals for choosing names and timing entries

> Items marked **[unverified]** could not be confirmed against a primary source (several domains — cboe.com, optionalpha.com, spintwig.com, sjoptions.com, volatilitybox.com, alphaarchitect.com — were egress-blocked for direct fetch, so those findings come from search-engine summaries and secondary citations).

### 4.1 IV minus realized vol (the per-name volatility risk premium)

**Evidence.** Goyal & Saretto (2009, *JFE* 94:310–326) sort stocks on the gap between 12-month historical realized vol (HV) and 1-month ATM implied vol (IV). Options where IV is high relative to HV earn low subsequent returns (good for sellers); the long-short decile straddle portfolio earned ~21.9%/month gross, shrinking to roughly 4–7.5%/month at quoted spreads — so the effect is real but transaction-cost-sensitive. They attribute it to mean reversion of volatility and overreaction. Sources: [ResearchGate](https://www.researchgate.net/publication/222532340_Cross-section_of_option_returns_and_volatility), [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0304405X09001251). AQR's "Still Not Cheap" reports the S&P 500 VRP averaged +3.4 vol points and was positive 88% of the time (1990–2014), persisting across VIX regimes ([AQR PDF](https://www.aqr.com/-/media/AQR/Documents/Journal-Articles/JPM-Still-Not-Cheap.pdf?sc_lang=en); [Understanding the VRP](https://www.aqr.com/Insights/Research/White-Papers/Understanding-the-Volatility-Risk-Premium)). Hu & Jacobs (2020, *JFQA*) add a caveat: cross-sectionally, put returns *increase* with the underlying's vol level, i.e. shorting puts on the highest-absolute-vol names is less rewarding than the raw premium suggests — prefer *relative* (IV vs own RV) over absolute IV ([Cambridge PDF](https://www.cambridge.org/core/services/aop-cambridge-core/content/view/EE41728DD4BDD83E333298737A28E02F/S0022109019000310a.pdf/volatility-and-expected-option-returns.pdf)).

**How to compute.**
- IV30: interpolate the two expirations bracketing 30 calendar days, ATM (or 50-delta) put/call average. Use the same construction every day so your own series is consistent.
- RV: close-to-close log-return stdev × √252 over 20 or 30 trading days. Range estimators are far more efficient with daily OHLC: Parkinson ~2.5–5x, Garman-Klass ~7.4x, Yang-Zhang up to ~14x the efficiency of close-to-close; only Yang-Zhang handles overnight gaps without downward bias — relevant for AAPL/NVDA/META earnings gaps ([portfoliooptimizer.io](https://portfoliooptimizer.io/blog/range-based-volatility-estimators-overview-and-examples-of-usage/), [arXiv 2312.01426](https://arxiv.org/pdf/2312.01426)). Practical: compute both close-to-close RV20 and Yang-Zhang RV20; use the max as a conservative "realized" denominator.
- Ratio and spread: IV30/RV20 and IV30 − RV20. Common practitioner thresholds are IV/RV ≥ 1.1–1.3 for "rich" **[unverified as a published threshold; folk standard]**. Because single-stock ratios run structurally higher than index ratios, standardise: z = (IV−RV today − mean over trailing 1y) / stdev over trailing 1y, per name. Rank on z, not the raw ratio.

### 4.2 IV rank and IV percentile

**Definitions.** IVR = (IV − 52w low)/(52w high − 52w low) × 100. IVP = % of trading days in the last 252 with IV below today's. IVR uses two data points and is distorted by one spike (a 120% earnings spike 8 months ago can make today's elevated IV read as IVR 25 while IVP reads ~90); IVP is more robust ([Volatility Box](https://volatilitybox.com/research/iv-rank-vs-iv-percentile/), [Barchart](https://www.barchart.com/education/iv_rank_vs_iv_percentile), [FlashAlpha](https://flashalpha.com/articles/iv-rank-vs-iv-percentile-difference-which-matters)).

**Pro evidence.** tastytrade research (SPY 1-SD strangles, 45 DTE, since 2005, managed at 21 DTE) reports P/L rising with IVR; IVR>50 SPY strangles cited at ~73% win rate, profit factor ~1.45 ([Volatility Box summary](https://volatilitybox.com/research/iv-rank-vs-iv-percentile/), [Sosnoff deck](https://s3.amazonaws.com/tastytradepublicmedia/website/cms/tastytrade_TomSosnoff_India2020.pdf/original/tastytrade_TomSosnoff_India2020.pdf)) **[numbers unverified against the original study]**.

**Counter-evidence.** SJ Options backtested SPX put credit spreads 2005–2015, 30 DTE: entries with IVR < 50 *outperformed* IVR > 50. High IVR raised the average winner slightly but increased the average loser "tremendously"; low IVR cut the average loser by 27% while reducing the average winner by only 1.2% ([SJ Options](https://www.sjoptions.com/high-iv-rank-vs-low-iv-rank-credit-spreads/)). Reconciliation: high IVR on an index is mostly a *stress* signal (realised vol is also high), whereas Goyal–Saretto's edge is IV *relative to realised*. Treat IVR/IVP as a mild positive and IV-vs-RV as the primary premium signal.

**Short history workaround.** Build your own series: each day store the interpolated ATM IV30 per name. Until you have 252 days, compute IVR/IVP over whatever window exists and flag it as provisional; proxy with a 1-year history of RV20 and today's IV-vs-RV z-score; for SPY/QQQ/IWM use VIX, VXN, RVX as long-history stand-ins. **[Proxy approach is a recommendation, not a published method.]**

### 4.3 Skew signals

**Measurement.** Put skew = IV(25-delta put) − IV(ATM), or 25d put − 25d call. SPX 30-day 25d put skew historically runs ~5–8 vol points above ATM ([Volatility Box](https://volatilitybox.com/research/iv-skew-explained/)). The CBOE SKEW index applies the Bakshi–Kapadia–Madan model-free skewness to the SPX OTM strip: SKEW = 100 − 10·S; ~100 ≈ lognormal, >130 ≈ elevated tail-risk pricing ([CBOE whitepaper](https://cdn.cboe.com/resources/indices/documents/SKEWwhitepaperjan2011.pdf)).

**Evidence.** Xing, Zhang & Zhao (2010, *JFQA* 45:641–662) define smirk as OTM put IV minus ATM call IV and find stocks with the steepest smirks underperform the flattest by economically large margins, persisting ~6 months; they attribute it to informed traders buying OTM puts ([ResearchGate](https://www.researchgate.net/publication/46543470_What_Does_Individual_Option_Volatility_Smirk_Tell_Us_About_Future_Equity_Returns)). Bollen & Whaley (2004, *JF*) show index put IV is driven by net buying pressure for puts (hedging demand), while single-stock IV is driven by call demand ([Wiley](https://onlinelibrary.wiley.com/doi/10.1111/j.1540-6261.2004.00647.x)).

**Implication for bull put spreads.** Very steep skew bids up the *long* further-OTM leg more than the short leg, so it can *compress* the vertical's credit; a flat-to-moderate skew that is *elevated vs its own history* is ideal. For single stocks, steep skew vs own history is a bearish warning per Xing–Zhang–Zhao. For indices, skew is mostly hedging demand (Bollen–Whaley) and a weaker directional signal — score index skew as premium richness, single-stock skew as a caution. **[The split treatment is a synthesis.]**

### 4.4 Term-structure regime

**Signal.** VIX/VIX3M. Contango (<1.0) is the normal state ~80% of the time; backwardation (>1.0) marks acute stress ([Macroption](https://www.macroption.com/vix3m/), [Macrosynergy](https://macrosynergy.com/research/vix-term-structure-as-a-trading-signal/), [Options Cafe](https://options.cafe/blog/vix-term-structure-contango-backwardation/)). Per name, use front-month vs 3rd-month ATM IV.

**Evidence.** Quantpedia's "Exploiting Term Structure of VIX Futures" (Simon & Campasano) sells front VIX futures when the daily roll exceeds +0.10 and finds the strategy profitable and robust to costs ([Quantpedia](https://quantpedia.com/strategies/exploiting-term-structure-of-vix-futures)). The transition *out* of backwardation has historically been a strong re-entry signal for premium sellers ([Options Cafe](https://options.cafe/blog/vix-term-structure-contango-backwardation/)). Spintwig's "s1" overpriced/underpriced signal raised Sharpe on 45-DTE SPX short puts from 0.57 to 0.98 and cut max drawdown from −65% to −32% vs daily entry, 2007–2024, with 48% fewer trades ([Spintwig s1](https://spintwig.com/s1/), [45-DTE backtest](https://spintwig.com/short-spx-put-45-dte-s1-signal-options-backtest)). Volatility clustering and mean reversion are standard GARCH facts ([NYU V-Lab](https://vlab.stern.nyu.edu/docs/volatility/GARCH)).

**Scanner use.** Backwardation = hard reduce (no new single-stock spreads; index spreads only at reduced size or skipped). The first 1–3 days after the curve flips back to contango with VIX still elevated is historically the richest entry window.

### 4.5 Trend / momentum filters

**Evidence.** Option Alpha backtested 45-DTE, 30/15-delta short put spreads on SPY, GLD, TLT (50% profit target, exit at 1 DTE, no stop) with and without an above-200-SMA filter: the filter dramatically reduced drawdowns and volatility with fewer trades ([Option Alpha](https://optionalpha.com/podcast/trend-trading), [Trendy Short Put Spread bot](https://optionalpha.com/podcast/trendy-short-put-spread-bot)). Alpha Architect finds 200–300+ day signals filter noise and that trend following's main contribution is drawdown avoidance ([Trend-Following Filters](https://alphaarchitect.com/trend-following-filters-part-1-2/), [Avoiding the Big Drawdown](https://alphaarchitect.com/avoiding-the-big-drawdown-with-trend-following-investment-strategies/)). 12-1 momentum (t−12 to t−1 months) is the standard cross-sectional definition ([Jegadeesh–Titman review](https://link.springer.com/article/10.1007/s11408-022-00417-8)).

**Falling knife vs pullback.** No rigorous public study isolates "sell puts after an N% pullback above the 200-SMA" vs "sell into a breakdown" **[unverified]**. Nearest evidence: Spintwig's s1 results (entries cluster after pullbacks when vol is overpriced) and momentum strategies losing −0.73%/month in spike months vs +0.54% otherwise ([IBKR Quant](https://www.interactivebrokers.com/campus/ibkr-quant-news/why-momentum-investing-has-been-struggling-and-what-volatility-has-to-do-with-it/)). Practical rule: price > 200-SMA and 50-SMA slope ≥ 0 as gate; a 3–10% pullback from the 20-day high while above the 200-SMA as a *bonus*; price < 200-SMA = reject for single names.

### 4.6 Event filters

**Earnings.** Dubinsky & Johannes show IV rises into earnings and collapses after (Intel July 1997: 71% → 43% overnight) and model the announcement as a priced jump ([Columbia PDF](https://business.columbia.edu/sites/default/files-efs/pubfiles/6051/DJ_2006.pdf)). Option Alpha reports the expected move overstates the actual move ~70% of the time (AAPL: 5.62% implied vs 4.20% avg actual) ([Option Alpha](https://optionalpha.com/lessons/iv-expected-vs-actual-move)). ORATS puts the long-run actual/implied ratio near 85% but notes recent seasons at ~104%, with META averaging 13.2% actual vs 6.8% implied over 12 quarters ([ORATS META](https://orats.com/blog/will-meta-surprise-again-orats-data-shows-traders-are-bracing-for-volatility), [ORATS NVDA](https://orats.com/blog/nvidia-earnings-options-market-expectations-vs-reality)). For a 45-DTE put spread, holding through earnings converts a vol-premium trade into a binary jump bet — hard reject if earnings fall inside the holding window. Strip earnings from IV before computing IV-vs-RV ([ORATS method](https://orats.com/blog/how-orats-removes-earnings-effect-from-implied-volatility)).

**Ex-dividend.** Irrelevant to put pricing; early assignment on short puts is driven by deep ITM + high rates, not dividends ([ApexVol](https://apexvol.com/learn/early-assignment-risk)). A position-management flag, not an entry filter.

**FOMC/CPI.** Same-week expirations carry 50–100% IV bumps; straddles price ~1.0–1.2% FOMC-day moves vs ~0.7–0.9% realised ([iPresage](https://www.ipresage.com/events/fomc)). For 45-DTE spreads these are modest positives (extra premium) rather than gates.

**Triple witching.** Avoid *expiring* on a witching day; otherwise ignore ([Option Alpha](https://optionalpha.com/learn/triple-witching)).

### 4.7 Liquidity and microstructure

- Spread % of mid = (ask − bid)/mid. Normal: 0.5–2% ATM on liquid names, 3–8% OTM; reject above ~10% for either leg ([Quantwheel](https://quantwheel.com/learn/options-bid-ask-spread)). Also compute the *spread's* combined bid-ask as % of net credit — this is what actually erodes the Goyal–Saretto edge.
- OI ≥ 500–1,000 per leg and daily volume ≥ a few hundred ([RadarPulse](https://radarpulse.io/options-liquidity-explained/)). All ten watchlist names clear this at 30–45 DTE monthlies.
- All ten are Penny Interval Program classes ([SEC/Cboe filing](https://www.sec.gov/files/rules/sro/cboe/2020/34-89075-ex5.pdf)).
- SPX/XSP vs SPY: Section 1256 60/40 tax, cash settlement, European exercise ([Option Alpha](https://optionalpha.com/learn/spx-vs-spy-how-to-trade-the-s-p-500)). For taxable accounts, route the SPY signal to SPX/XSP.
- Pick the monthly nearest 45 DTE (deepest OI).

### 4.8 Cross-sectional ranking

ROC = credit/(width − credit); POP ≈ 1 − short delta; EV per unit margin ≈ POP × credit − (1 − POP) × avg loss; divide by DTE for EV/day. Beta-weight deltas to SPY to measure aggregate exposure ([tastytrade](https://support.tastytrade.com/support/s/solutions/articles/43000522492)); beta-weighted delta understates loss in a −3% gap for short premium ([Options Jive](https://optionsjive.com/blog/beta-weighted-delta/)). ORATS ranks trades by Smooth edge / Distribution edge / Forecast edge ([ORATS](https://blog.orats.com/how-to-find-the-best-options-trade-using-theoretical-values)); Market Chameleon's Bull Put screener exposes Theo Edge ([Market Chameleon](https://marketchameleon.com/Screeners/BullPutSpreads)). The Cboe PUT index's long-run record (9.5% CAGR at 10% vol vs S&P 9.8% at 15%, max DD −32.7% vs −50.9%) is the benchmark for passive put selling before any filters ([Bondarenko 2019](https://cdn.cboe.com/resources/education/research_publications/PutWriteCBOE19_v14_by_Prof_Oleg_Bondarenko_as_of_June_14.pdf)).

### 4.9 A scoring model grounded in the evidence

**Hard gates (reject before scoring)**
1. Earnings date inside [today, expiration] for single names.
2. Price < 200-SMA for single names; for SPY/QQQ/IWM, price < 200-SMA *and* VIX/VIX3M > 1.0.
3. VIX/VIX3M > 1.0 on any new single-stock spread.
4. Either leg bid-ask > 10% of mid, or OI < 500, or combined spread cost > 25% of net credit.
5. Net credit < 25% of width at 30/15 delta **[threshold unverified; heuristic]**.
6. Expiration on a triple-witching Friday unless it is the standard monthly anyway (soft).

**Soft factors (0–100 composite)**

| Component | Weight | Metric | Why |
|---|---|---|---|
| Vol risk premium | 30 | z-score of (IV30 − RV20) vs own 1y history; bonus if IV30/RV20 ≥ 1.2 | Goyal–Saretto; Hu–Jacobs argue relative not absolute vol |
| Term-structure regime | 15 | VIX/VIX3M ≤ 0.85 → 15, 0.85–0.95 → 10, 0.95–1.0 → 5; +5 if flipped to contango within 3 days | Quantpedia roll-yield; Spintwig s1 |
| IV percentile (not rank) | 10 | IVP mapped linearly; capped when RV is also spiking | tastytrade pro, SJ Options con — net mild positive |
| Trend quality | 15 | Above 200-SMA (gate) + 50-SMA slope > 0 + 12-1 momentum rank + 3–10% pullback bonus | Option Alpha / Alpha Architect drawdown evidence |
| Skew | 10 | Index names: 25d−ATM skew z-score, higher = richer. Single names: inverted, steep skew subtracts | Bollen–Whaley; Xing–Zhang–Zhao |
| Trade economics | 15 | EV/day per $ margin, ranked across candidates | Option Alpha / ORATS / Market Chameleon |
| Portfolio fit | 5 | Penalty for correlation with open positions and marginal beta-weighted delta | tastytrade beta-weighting |

Score ≥ 70: full size; 50–69: half size; < 50: skip. The VRP z-score and term-structure terms move day to day; trend and liquidity change slowly.

**Caveats.** Weights are a judgment synthesis, not a fitted model; the IVR/IVP evidence is genuinely mixed; the falling-knife question lacks a clean public study.
