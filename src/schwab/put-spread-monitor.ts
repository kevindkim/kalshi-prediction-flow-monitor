#!/usr/bin/env ts-node
import 'dotenv/config';
import readline from 'readline';
import { SchwabAuth } from './schwab-auth';
import { SchwabClient } from './schwab-client';
import { loadStrategyConfig, StrategyConfig } from './strategy-config';
import { createEarningsLookup } from './earnings-calendar';
import { bestPerExpiration, isGoodPremium, PutSpreadScanner, SpreadCandidate } from './put-spread-scanner';
import { PositionMonitor, SpreadStatus } from './position-monitor';
import { buildBullPutCloseOrder, buildBullPutOpenOrder, SpreadLegs } from './spread-orders';
import { buildCloseAlert, buildOpportunityAlert, Notifier } from './notifier';
import { formatOptionSymbol } from './option-symbol';
import { contractsForRisk, round2, targetCloseDebit } from './spread-math';
import { PlacedOrder } from './schwab-types';
import { fetchRegime } from './regime';
import { pairPutSpreads } from './position-monitor';

/**
 * Bull put spread CLI.
 *
 *   npm run spreads -- auth                      log in to Schwab (once a week)
 *   npm run spreads -- auth status
 *   npm run spreads -- scan [--notify]           rank spreads across the watchlist
 *   npm run spreads -- monitor [--notify] [--auto-target]
 *   npm run spreads -- open SPY 2025-11-21 640 630 --qty 1 --credit 1.70 [--confirm]
 *   npm run spreads -- close SPY_2025-11-21_640/630 --pct 0.5 [--confirm]
 *   npm run spreads -- run [--notify] [--auto-target]   loop during market hours
 *   npm run spreads -- test-notify
 */

interface Args {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const [command = 'help', ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { command, positional, flags };
}

function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    })
  );
}

function fmtTable(rows: string[][]): string {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
  return rows.map((r) => r.map((c, i) => (c ?? '').padEnd(widths[i])).join('  ')).join('\n');
}

function printCandidates(candidates: SpreadCandidate[], cfg: StrategyConfig, limit = 15): void {
  if (candidates.length === 0) {
    console.log('No spreads passed the filters.');
    return;
  }
  const rows = [['Score', 'Good?', 'Ticker', 'Exp', 'DTE', 'Short/Long', 'Credit', 'Width', 'ROR', 'Δ', 'POP', 'IV/HV', 'Trend', 'Earn']];
  for (const c of candidates.slice(0, limit)) {
    rows.push([
      String(c.score),
      isGoodPremium(c, cfg) ? '★' : '',
      c.underlying,
      c.expiration,
      String(c.dte),
      `${c.shortStrike}/${c.longStrike}`,
      c.midCredit.toFixed(2),
      String(c.width),
      `${Math.round(c.returnOnRisk * 100)}%`,
      c.shortDelta.toFixed(2),
      `${Math.round(c.probOtm * 100)}%`,
      c.ivToHv === null ? '-' : `${c.ivToHv}x`,
      c.trendOk ? 'ok' : 'weak',
      c.earningsInWindow ? '⚠️' : c.nextEarnings ?? '?',
    ]);
  }
  console.log(fmtTable(rows));
}

function printStatuses(statuses: SpreadStatus[]): void {
  if (statuses.length === 0) {
    console.log('No open put spreads found in the account.');
    return;
  }
  const rows = [['Spread', 'Qty', 'DTE', 'Credit', 'Now', 'Captured', 'P/L', 'Target', 'Stop', 'GTC?', 'Action']];
  for (const s of statuses) {
    rows.push([
      s.id,
      String(s.quantity),
      String(s.dte),
      s.openCredit.toFixed(2),
      s.currentMidDebit.toFixed(2),
      `${Math.round(s.profitCaptured * 100)}%`,
      `$${s.unrealizedPnl}`,
      s.targetCloseDebit.toFixed(2),
      s.stopDebit.toFixed(2),
      s.hasWorkingCloseOrder ? 'yes' : 'no',
      s.action,
    ]);
  }
  console.log(fmtTable(rows));
  for (const s of statuses) if (s.action !== 'HOLD') console.log(`\n${s.id}: ${s.message}`);
}

/** Net fill credit from executions: short leg price − long leg price (per spread). */
export function fillCreditFromOrder(order: PlacedOrder): number | null {
  const legs = order.orderLegCollection ?? [];
  const activities = order.orderActivityCollection ?? [];
  if (activities.length === 0) return null;
  let shortTotal = 0;
  let longTotal = 0;
  let qty = 0;
  for (const act of activities) {
    for (const ex of act.executionLegs ?? []) {
      const leg = legs[ex.legId - 1] ?? legs.find((_, i) => i + 1 === ex.legId);
      if (!leg) continue;
      if (leg.instruction === 'SELL_TO_OPEN') {
        shortTotal += ex.price * ex.quantity;
        qty += ex.quantity;
      } else if (leg.instruction === 'BUY_TO_OPEN') {
        longTotal += ex.price * ex.quantity;
      }
    }
  }
  if (qty === 0) return null;
  return round2((shortTotal - longTotal) / qty);
}

function parseSpreadId(id: string): { underlying: string; expiration: string; shortStrike: number; longStrike: number } {
  const m = id.match(/^([A-Z.$^]+)_(\d{4}-\d{2}-\d{2})_([\d.]+)\/([\d.]+)$/i);
  if (!m) throw new Error(`Spread id "${id}" should look like SPY_2025-11-21_640/630`);
  return { underlying: m[1].toUpperCase(), expiration: m[2], shortStrike: Number(m[3]), longStrike: Number(m[4]) };
}

async function marketIsOpen(client: SchwabClient): Promise<boolean> {
  try {
    const hours = await client.getOptionMarketHours();
    const eqo = hours.option?.EQO ?? Object.values(hours.option ?? {})[0];
    if (!eqo) return fallbackMarketOpen();
    if (!eqo.isOpen) return false;
    const session = eqo.sessionHours?.regularMarket?.[0];
    if (!session) return fallbackMarketOpen();
    const now = Date.now();
    return now >= new Date(session.start).getTime() && now <= new Date(session.end).getTime();
  } catch {
    return fallbackMarketOpen();
  }
}

function fallbackMarketOpen(): boolean {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = et.getHours() * 60 + et.getMinutes();
  return minutes >= 9 * 60 + 30 && minutes <= 16 * 60;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdAuth(args: Args): Promise<void> {
  const auth = new SchwabAuth();
  if (args.positional[0] === 'status') {
    const s = auth.status();
    if (!s.hasTokens) {
      console.log('No tokens stored. Run: npm run spreads -- auth');
      return;
    }
    console.log(`Access token: ${s.accessMinutesLeft} min left (auto-refreshes). Refresh token: ${s.refreshDaysLeft} days left.`);
    if (s.refreshDaysLeft < 1) console.log('⚠️ Re-login needed within 24h.');
    return;
  }
  await auth.interactiveLogin(ask);
  const client = new SchwabClient(auth);
  const accounts = await client.getAccountNumbers();
  console.log(`✅ Authenticated. Accounts: ${accounts.map((a) => `…${a.accountNumber.slice(-4)}`).join(', ')}`);
}

async function cmdScan(args: Args, ctx: Ctx): Promise<SpreadCandidate[]> {
  const { client, cfg } = ctx;
  const scanner = new PutSpreadScanner(client, cfg, createEarningsLookup());
  const symbols = args.flags.symbols ? String(args.flags.symbols).toUpperCase().split(',') : cfg.watchlist;
  console.log(`🔎 Scanning ${symbols.length} names for ${cfg.minDte}-${cfg.maxDte} DTE bull put spreads...`);
  const all = await scanner.scanWatchlist(symbols);
  const best = bestPerExpiration(all);
  console.log(`\n${all.length} candidate spreads, ${best.length} best-per-expiration:\n`);
  printCandidates(best, cfg);
  if (args.flags.json) console.log(JSON.stringify(best, null, 2));

  const regime = await fetchRegime(client);
  console.log(`\nRegime ${regime.label}: ${regime.reasons.join('; ')}`);

  const portfolio = await openSpreadSummary(ctx);
  let good = best.filter((c) => isGoodPremium(c, cfg));
  const heldNames = good.filter((c) => (portfolio.perUnderlying[c.underlying] ?? 0) >= cfg.maxPerUnderlying);
  if (heldNames.length > 0) {
    console.log(`Skipping ${heldNames.map((c) => c.underlying).join(', ')}: already at ${cfg.maxPerUnderlying} open spread(s) per name.`);
    good = good.filter((c) => !heldNames.includes(c));
  }
  good = good.slice(0, cfg.maxAlertsPerScan);

  if (good.length > 0) {
    console.log(`\n★ ${good.length} spread${good.length === 1 ? '' : 's'} with particularly good premium (score ≥ ${cfg.goodPremiumMinScore}).`);
    if (!regime.allowNewEntries) {
      console.log('⏸ Regime says PAUSE — listing them but not sending an entry prompt.');
    } else if (portfolio.openCount >= cfg.maxOpenSpreads) {
      console.log(`⏸ ${portfolio.openCount} spreads already open (max ${cfg.maxOpenSpreads}) — not sending an entry prompt.`);
    } else if (args.flags.notify) {
      const sent = await ctx.notifier.send(
        buildOpportunityAlert(good, cfg, portfolio.accountValue, regime),
        cfg.alertCooldownHours
      );
      console.log(sent ? '📣 Opportunity alert sent.' : '📣 Opportunity alert suppressed (cooldown / no channels).');
    }
  }
  return best;
}

interface OpenSpreadSummary {
  accountValue: number | null;
  openCount: number;
  perUnderlying: Record<string, number>;
  riskAtWork: number; // $ max loss across open spreads
}

async function openSpreadSummary(ctx: Ctx): Promise<OpenSpreadSummary> {
  try {
    const hash = await ctx.accountHash();
    const acct = await ctx.client.getAccountWithPositions(hash);
    const spreads = pairPutSpreads(acct.securitiesAccount.positions ?? []);
    const perUnderlying: Record<string, number> = {};
    for (const s of spreads) perUnderlying[s.underlying] = (perUnderlying[s.underlying] ?? 0) + 1;
    return {
      accountValue: acct.securitiesAccount.currentBalances?.liquidationValue ?? null,
      openCount: spreads.length,
      perUnderlying,
      riskAtWork: spreads.reduce((a, s) => a + s.maxLoss, 0),
    };
  } catch (error) {
    console.warn('⚠️ Could not load account summary:', (error as Error).message);
    return { accountValue: null, openCount: 0, perUnderlying: {}, riskAtWork: 0 };
  }
}

async function cmdMonitor(args: Args, ctx: Ctx): Promise<SpreadStatus[]> {
  const { client, cfg } = ctx;
  const hash = await ctx.accountHash();
  const monitor = new PositionMonitor(client, cfg);
  const { statuses } = await monitor.snapshot(hash);
  printStatuses(statuses);

  const actionable = statuses.filter((s) => s.action !== 'HOLD');
  if (actionable.length > 0 && args.flags.notify) {
    const sent = await ctx.notifier.send(buildCloseAlert(actionable, cfg), cfg.alertCooldownHours);
    console.log(sent ? '📣 Close alert sent.' : '📣 Close alert suppressed (cooldown / no channels).');
  }

  if (args.flags['auto-target']) {
    // Make sure every open spread has a resting GTC close at the profit target.
    for (const s of statuses) {
      if (s.hasWorkingCloseOrder || s.action === 'STOP_LOSS') continue;
      const debit = Math.max(cfg.priceTick, s.targetCloseDebit);
      const order = buildBullPutCloseOrder(legsOf(s), debit, 'GOOD_TILL_CANCEL', cfg.priceTick);
      const { orderId } = await client.placeOrder(hash, order);
      console.log(`✅ Placed GTC close for ${s.id} at ${debit.toFixed(2)} (order ${orderId ?? 'id pending'})`);
    }
  }
  return statuses;
}

function legsOf(s: { shortSymbol: string; longSymbol: string; quantity: number }): SpreadLegs {
  return { shortSymbol: s.shortSymbol, longSymbol: s.longSymbol, quantity: s.quantity };
}

async function cmdOpen(args: Args, ctx: Ctx): Promise<void> {
  const { client, cfg } = ctx;
  const [underlyingRaw, expiration, shortRaw, longRaw] = args.positional;
  if (!underlyingRaw || !expiration || !shortRaw || !longRaw) {
    throw new Error('Usage: open SYMBOL YYYY-MM-DD SHORT_STRIKE LONG_STRIKE [--qty N] [--credit X] [--no-target] [--trigger] [--preview] [--confirm]');
  }
  const underlying = underlyingRaw.toUpperCase();
  const shortStrike = Number(shortRaw);
  const longStrike = Number(longRaw);
  if (!(longStrike < shortStrike)) throw new Error('Long strike must be below the short strike for a bull put spread');
  const width = round2(shortStrike - longStrike);
  const shortSymbol = formatOptionSymbol(underlying, expiration, 'PUT', shortStrike);
  const longSymbol = formatOptionSymbol(underlying, expiration, 'PUT', longStrike);

  const quotes = await client.getQuotes([shortSymbol, longSymbol]);
  const sq = quotes[shortSymbol]?.quote;
  const lq = quotes[longSymbol]?.quote;
  if (!sq || !lq) throw new Error(`Schwab returned no quote for ${shortSymbol} / ${longSymbol} — check strikes and expiration`);
  const mid = round2((sq.bidPrice + sq.askPrice) / 2 - (lq.bidPrice + lq.askPrice) / 2);
  const natural = round2(sq.bidPrice - lq.askPrice);
  const credit = args.flags.credit ? Number(args.flags.credit) : mid;
  if (credit <= 0) throw new Error(`Credit must be positive (mid is ${mid.toFixed(2)})`);
  if (credit / width < cfg.minCreditToWidth) {
    console.warn(`⚠️ Credit ${credit.toFixed(2)} is only ${Math.round((credit / width) * 100)}% of the ${width} width (rule: ≥ ${Math.round(cfg.minCreditToWidth * 100)}%).`);
  }

  const hash = await ctx.accountHash();
  const [regime, portfolio] = await Promise.all([fetchRegime(client), openSpreadSummary(ctx)]);
  console.log(`Regime ${regime.label}: ${regime.reasons.join('; ')}`);
  if (!regime.allowNewEntries && !args.flags.force) {
    throw new Error('Regime filter says PAUSE for new entries. Add --force to override.');
  }
  if ((portfolio.perUnderlying[underlying] ?? 0) >= cfg.maxPerUnderlying) {
    console.warn(`⚠️ Already ${portfolio.perUnderlying[underlying]} open spread(s) on ${underlying} (max ${cfg.maxPerUnderlying}).`);
  }
  if (portfolio.openCount >= cfg.maxOpenSpreads) {
    console.warn(`⚠️ ${portfolio.openCount} spreads already open (max ${cfg.maxOpenSpreads}).`);
  }
  let qty = args.flags.qty ? Number(args.flags.qty) : 0;
  if (!qty) {
    const value = portfolio.accountValue;
    const full = value ? contractsForRisk(value, cfg.riskPerTradePct, width, credit) : 1;
    qty = Math.max(1, Math.floor(full * regime.sizeMultiplier));
    console.log(
      `Sizing: ${qty} spread${qty === 1 ? '' : 's'} at ${Math.round(cfg.riskPerTradePct * 100)}% risk${value ? ` of $${Math.round(value)}` : ''}${
        regime.sizeMultiplier < 1 ? ` ×${regime.sizeMultiplier} regime multiplier` : ''
      }`
    );
  }

  const attachTarget = !args.flags['no-target'] && cfg.attachProfitTargetOnOpen;
  const useTrigger = Boolean(args.flags.trigger);
  const legs: SpreadLegs = { shortSymbol, longSymbol, quantity: qty };
  const order = buildBullPutOpenOrder(legs, credit, {
    duration: 'DAY',
    profitTargetPct: attachTarget && useTrigger ? cfg.profitTargetPct : undefined,
    tick: cfg.priceTick,
  });

  console.log(`\n${underlying} ${expiration} ${shortStrike}/${longStrike} put spread ×${qty}`);
  console.log(`Credit ${credit.toFixed(2)} (mid ${mid.toFixed(2)}, natural ${natural.toFixed(2)}) · max profit $${round2(credit * 100 * qty)} · max loss $${round2((width - credit) * 100 * qty)}`);
  console.log(`Profit target: ${attachTarget ? `GTC close at ${targetCloseDebit(credit, cfg.profitTargetPct, cfg.priceTick).toFixed(2)} (${Math.round(cfg.profitTargetPct * 100)}%)${useTrigger ? ' via TRIGGER child' : ' placed after fill'}` : 'none'}`);
  console.log('\nOrder JSON:\n' + JSON.stringify(order, null, 2));

  if (args.flags.preview) {
    console.log('\nSchwab preview:\n' + JSON.stringify(await client.previewOrder(hash, order), null, 2));
  }
  if (!args.flags.confirm) {
    console.log('\nDry run. Add --confirm to send this order.');
    return;
  }

  const { orderId } = await client.placeOrder(hash, order);
  console.log(`✅ Open order sent (order ${orderId ?? 'id not returned'})`);
  if (!attachTarget || useTrigger || !orderId) return;

  const waitMin = Number(process.env.SPREAD_FILL_WAIT_MIN || 10);
  console.log(`⏳ Waiting up to ${waitMin} min for a fill before placing the GTC close...`);
  const filled = await client.waitForFill(hash, orderId, waitMin * 60_000);
  if (filled.status !== 'FILLED') {
    console.log(`Order status is ${filled.status}. Once it fills, run: npm run spreads -- close ${underlying}_${expiration}_${shortStrike}/${longStrike} --pct ${cfg.profitTargetPct} --confirm`);
    return;
  }
  const fillCredit = fillCreditFromOrder(filled) ?? credit;
  const debit = Math.max(cfg.priceTick, targetCloseDebit(fillCredit, cfg.profitTargetPct, cfg.priceTick));
  const closeOrder = buildBullPutCloseOrder(legs, debit, 'GOOD_TILL_CANCEL', cfg.priceTick);
  const close = await client.placeOrder(hash, closeOrder);
  console.log(`✅ Filled at ${fillCredit.toFixed(2)}. GTC close placed at ${debit.toFixed(2)} (order ${close.orderId ?? 'id pending'}).`);
}

async function cmdClose(args: Args, ctx: Ctx): Promise<void> {
  const { client, cfg } = ctx;
  const id = args.positional[0];
  if (!id) throw new Error('Usage: close SPREAD_ID [--pct 0.5 | --debit X] [--day] [--replace] [--confirm]');
  const parsed = parseSpreadId(id);
  const hash = await ctx.accountHash();
  const monitor = new PositionMonitor(client, cfg);
  const { statuses } = await monitor.snapshot(hash);
  const spread = statuses.find(
    (s) => s.underlying === parsed.underlying && s.expiration === parsed.expiration && s.shortStrike === parsed.shortStrike && s.longStrike === parsed.longStrike
  );
  if (!spread) {
    throw new Error(`No open spread ${id} in the account. Open spreads: ${statuses.map((s) => s.id).join(', ') || 'none'}`);
  }

  let debit: number;
  if (args.flags.debit) debit = Number(args.flags.debit);
  else if (args.flags.pct) debit = targetCloseDebit(spread.openCredit, Number(args.flags.pct), cfg.priceTick);
  else debit = spread.targetCloseDebit;
  debit = Math.max(cfg.priceTick, debit);
  const duration = args.flags.day ? 'DAY' : 'GOOD_TILL_CANCEL';
  const order = buildBullPutCloseOrder(legsOf(spread), debit, duration, cfg.priceTick);
  const captured = Math.round(((spread.openCredit - debit) / spread.openCredit) * 100);

  console.log(`\nClose ${spread.id} ×${spread.quantity} for ${debit.toFixed(2)} ${duration} → locks in ${captured}% of the ${spread.openCredit.toFixed(2)} credit (now ${spread.currentMidDebit.toFixed(2)} mid / ${spread.currentNaturalDebit.toFixed(2)} natural)`);
  console.log('\nOrder JSON:\n' + JSON.stringify(order, null, 2));

  if (spread.hasWorkingCloseOrder && !args.flags.replace) {
    console.log('\n⚠️ A closing order is already working for this spread. Add --replace to cancel it and send this one.');
    return;
  }
  if (!args.flags.confirm) {
    console.log('\nDry run. Add --confirm to send this order.');
    return;
  }
  if (spread.hasWorkingCloseOrder && args.flags.replace) {
    const orders = await client.getOrders(hash, 59);
    for (const o of orders) {
      const legs = o.orderLegCollection ?? [];
      const active = ['WORKING', 'QUEUED', 'ACCEPTED', 'PENDING_ACTIVATION'].includes(o.status);
      if (active && legs.some((l) => l.instrument.symbol === spread.shortSymbol && l.instruction === 'BUY_TO_CLOSE')) {
        await client.cancelOrder(hash, String(o.orderId));
        console.log(`🗑 Cancelled working close order ${o.orderId}`);
      }
    }
  }
  const { orderId } = await client.placeOrder(hash, order);
  console.log(`✅ Close order sent (order ${orderId ?? 'id not returned'})`);
}

async function cmdRun(args: Args, ctx: Ctx): Promise<void> {
  const monitorEvery = Number(process.env.SPREAD_MONITOR_INTERVAL_MIN || 15) * 60_000;
  const scanEvery = Number(process.env.SPREAD_SCAN_INTERVAL_MIN || 60) * 60_000;
  let lastScan = 0;
  console.log(`▶ Running: monitor every ${monitorEvery / 60_000} min, scan every ${scanEvery / 60_000} min, market hours only. Channels: ${ctx.notifier.channels.join(', ') || 'none'}`);
  const tick = async () => {
    try {
      if (!(await marketIsOpen(ctx.client))) {
        console.log(`${new Date().toLocaleTimeString()} market closed, sleeping`);
        return;
      }
      console.log(`\n${new Date().toLocaleString()} — checking open spreads`);
      await cmdMonitor(args, ctx);
      if (Date.now() - lastScan >= scanEvery) {
        lastScan = Date.now();
        await cmdScan(args, ctx);
      }
    } catch (error) {
      console.error('❌ Loop error:', (error as Error).message);
    }
  };
  await tick();
  setInterval(tick, monitorEvery);
}

function help(): void {
  console.log(`
Bull put spread monitor (Schwab)

  auth                          Log in to Schwab (refresh token lasts 7 days)
  auth status                   Show token expiry
  scan [--notify] [--symbols SPY,QQQ] [--json]
  monitor [--notify] [--auto-target]
  open SYM YYYY-MM-DD SHORT LONG [--qty N] [--credit X] [--no-target] [--trigger] [--preview] [--force] [--confirm]
  close SPREAD_ID [--pct 0.5 | --debit X] [--day] [--replace] [--confirm]
  run [--notify] [--auto-target]   Loop during market hours
  test-notify                   Send a test email/SMS

Nothing is sent to Schwab without --confirm. See docs/put-spread-strategy-research.md for the rules.
`);
}

interface Ctx {
  client: SchwabClient;
  cfg: StrategyConfig;
  notifier: Notifier;
  accountHash: () => Promise<string>;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'help' || args.command === '--help') return help();
  if (args.command === 'auth') return cmdAuth(args);

  const cfg = loadStrategyConfig();
  const notifier = new Notifier();
  if (args.command === 'test-notify') {
    await notifier.verify();
    const ok = await notifier.send(
      { key: `test:${Date.now()}`, subject: '✅ Put spread monitor test', text: 'Notifications are working.' },
      0
    );
    console.log(ok ? 'Sent.' : 'Nothing sent — configure EMAIL_USER/EMAIL_PASSWORD or Twilio in .env');
    return;
  }

  const client = new SchwabClient();
  let cachedHash: string | null = null;
  const ctx: Ctx = {
    client,
    cfg,
    notifier,
    accountHash: async () => (cachedHash ??= await client.resolveAccountHash()),
  };

  switch (args.command) {
    case 'scan':
      await cmdScan(args, ctx);
      break;
    case 'monitor':
    case 'positions':
      await cmdMonitor(args, ctx);
      break;
    case 'open':
      await cmdOpen(args, ctx);
      break;
    case 'close':
      await cmdClose(args, ctx);
      break;
    case 'run':
      await cmdRun(args, ctx);
      break;
    default:
      help();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('❌', (error as Error).message);
    process.exit(1);
  });
}
