import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import nodemailer, { Transporter } from 'nodemailer';
import { SpreadCandidate } from './put-spread-scanner';
import { SpreadStatus } from './position-monitor';
import { StrategyConfig } from './strategy-config';
import { Regime } from './regime';

/**
 * Sends "sell this" and "close this" prompts by email and/or SMS.
 *
 * Email: Gmail app password (EMAIL_USER / EMAIL_PASSWORD, same names as the
 *        OptionsEmailer project) or any SMTP server (SMTP_HOST/PORT/USER/PASS).
 * SMS:   Twilio (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM / ALERT_SMS_TO)
 *        or a free carrier email-to-SMS gateway (ALERT_SMS_GATEWAY=5551234567@vtext.com).
 *
 * Alerts are de-duplicated through a small JSON state file so the same spread
 * is not re-sent every 15 minutes; see alertCooldownHours in the config.
 */
export interface NotifierConfig {
  emailFrom?: string;
  emailTo?: string;
  smtp?: { host: string; port: number; secure: boolean; user: string; pass: string };
  gmail?: { user: string; pass: string };
  twilio?: { sid: string; token: string; from: string; to: string };
  smsGateway?: string;
  statePath: string;
}

export function loadNotifierConfig(): NotifierConfig {
  const env = process.env;
  const cfg: NotifierConfig = {
    emailTo: env.ALERT_EMAIL_TO || env.RECIPIENT_EMAIL || env.EMAIL_USER,
    emailFrom: env.ALERT_EMAIL_FROM || env.EMAIL_USER || env.SMTP_USER,
    statePath: env.SPREAD_ALERT_STATE_PATH || path.resolve(process.cwd(), '.spread-alerts.json'),
  };
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
    cfg.smtp = {
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT || 587),
      secure: env.SMTP_SECURE === 'true',
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    };
  } else if (env.EMAIL_USER && env.EMAIL_PASSWORD) {
    cfg.gmail = { user: env.EMAIL_USER, pass: env.EMAIL_PASSWORD };
  }
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM && env.ALERT_SMS_TO) {
    cfg.twilio = { sid: env.TWILIO_ACCOUNT_SID, token: env.TWILIO_AUTH_TOKEN, from: env.TWILIO_FROM, to: env.ALERT_SMS_TO };
  }
  if (env.ALERT_SMS_GATEWAY) cfg.smsGateway = env.ALERT_SMS_GATEWAY;
  return cfg;
}

export interface Alert {
  key: string; // dedupe key
  subject: string;
  text: string; // plain text / SMS body
  html?: string;
}

type AlertState = Record<string, { lastSent: number; count: number }>;

export class Notifier {
  private transporter: Transporter | null = null;
  private state: AlertState;

  constructor(private readonly cfg: NotifierConfig = loadNotifierConfig()) {
    this.state = this.loadState();
    if (cfg.smtp) {
      this.transporter = nodemailer.createTransport({
        host: cfg.smtp.host,
        port: cfg.smtp.port,
        secure: cfg.smtp.secure,
        auth: { user: cfg.smtp.user, pass: cfg.smtp.pass },
      });
    } else if (cfg.gmail) {
      this.transporter = nodemailer.createTransport({ service: 'gmail', auth: cfg.gmail });
    }
  }

  get channels(): string[] {
    const out: string[] = [];
    if (this.transporter && this.cfg.emailTo) out.push(`email→${this.cfg.emailTo}`);
    if (this.cfg.twilio) out.push(`sms→${this.cfg.twilio.to}`);
    if (this.transporter && this.cfg.smsGateway) out.push(`sms-gateway→${this.cfg.smsGateway}`);
    return out;
  }

  /** Sends unless the same key was sent within cooldownHours. Returns true if sent. */
  async send(alert: Alert, cooldownHours: number): Promise<boolean> {
    const prev = this.state[alert.key];
    if (prev && Date.now() - prev.lastSent < cooldownHours * 3_600_000) {
      return false;
    }
    if (this.channels.length === 0) {
      console.log(`📣 (no notification channels configured) ${alert.subject}\n${alert.text}`);
      return false;
    }
    const results = await Promise.allSettled([this.sendEmail(alert), this.sendSms(alert)]);
    const ok = results.some((r) => r.status === 'fulfilled' && r.value);
    results.forEach((r) => {
      if (r.status === 'rejected') console.error('❌ Notification failed:', (r.reason as Error).message);
    });
    if (ok) {
      this.state[alert.key] = { lastSent: Date.now(), count: (prev?.count ?? 0) + 1 };
      this.saveState();
    }
    return ok;
  }

  async verify(): Promise<void> {
    if (this.transporter) {
      await this.transporter.verify();
      console.log('✅ Email transport verified');
    }
    console.log('Channels:', this.channels.length ? this.channels.join(', ') : 'none');
  }

  private async sendEmail(alert: Alert): Promise<boolean> {
    if (!this.transporter || !this.cfg.emailTo) return false;
    const info = await this.transporter.sendMail({
      from: this.cfg.emailFrom,
      to: this.cfg.emailTo,
      subject: alert.subject,
      text: alert.text,
      html: alert.html ?? `<pre style="font-family:ui-monospace,Menlo,monospace;font-size:13px">${escapeHtml(alert.text)}</pre>`,
    });
    console.log(`📧 Email sent (${info.messageId}): ${alert.subject}`);
    return true;
  }

  private async sendSms(alert: Alert): Promise<boolean> {
    const body = smsBody(alert);
    let sent = false;
    if (this.cfg.twilio) {
      const { sid, token, from, to } = this.cfg.twilio;
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
      });
      if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
      console.log(`📱 SMS sent via Twilio: ${alert.subject}`);
      sent = true;
    }
    if (this.transporter && this.cfg.smsGateway) {
      await this.transporter.sendMail({ from: this.cfg.emailFrom, to: this.cfg.smsGateway, subject: '', text: body });
      console.log(`📱 SMS sent via carrier gateway: ${alert.subject}`);
      sent = true;
    }
    return sent;
  }

  private loadState(): AlertState {
    try {
      return fs.existsSync(this.cfg.statePath) ? JSON.parse(fs.readFileSync(this.cfg.statePath, 'utf8')) : {};
    } catch {
      return {};
    }
  }

  private saveState(): void {
    // prune entries older than 14 days
    const cutoff = Date.now() - 14 * 86_400_000;
    for (const [k, v] of Object.entries(this.state)) if (v.lastSent < cutoff) delete this.state[k];
    fs.writeFileSync(this.cfg.statePath, JSON.stringify(this.state, null, 2));
  }
}

/** SMS: first ~300 chars of the text, no markup. */
function smsBody(alert: Alert): string {
  const compact = `${alert.subject}\n${alert.text}`.replace(/\n{2,}/g, '\n');
  return compact.length > 300 ? `${compact.slice(0, 297)}...` : compact;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Message builders
// ---------------------------------------------------------------------------

export function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function buildOpportunityAlert(
  candidates: SpreadCandidate[],
  cfg: StrategyConfig,
  accountValue: number | null,
  regime?: Regime
): Alert {
  const lines: string[] = [];
  lines.push(`${candidates.length} bull put spread${candidates.length === 1 ? '' : 's'} with rich premium right now:`);
  if (regime) lines.push(`Regime ${regime.label}: ${regime.reasons.join('; ')}`);
  lines.push('');
  const multiplier = regime?.sizeMultiplier ?? 1;
  for (const c of candidates) {
    const fullQty = accountValue ? Math.floor((accountValue * cfg.riskPerTradePct) / c.maxLoss) : 1;
    const qty = Math.max(1, Math.floor(fullQty * multiplier));
    lines.push(`▶ ${c.underlying} $${c.underlyingPrice.toFixed(2)} — sell ${c.expiration} ${c.shortStrike}/${c.longStrike} put spread  [score ${c.score}]`);
    lines.push(`   Credit ~${c.midCredit.toFixed(2)} mid (${c.naturalCredit.toFixed(2)} natural) on $${c.width} width → ${Math.round(c.returnOnRisk * 100)}% on risk, ${c.dte} DTE`);
    lines.push(`   Max profit $${c.maxProfit} / max loss $${c.maxLoss} per spread · POP ~${Math.round(c.probOtm * 100)}% · breakeven ${c.breakeven}`);
    for (const r of c.reasons) lines.push(`   • ${r}`);
    lines.push(
      `   Size at ${Math.round(cfg.riskPerTradePct * 100)}% risk: ${qty} spread${qty === 1 ? '' : 's'}${
        multiplier < 1 ? ` (×${multiplier} for the vol regime)` : ''
      }${accountValue ? '' : ' (account value unknown)'}`
    );
    lines.push(`   → npm run spreads -- open ${c.underlying} ${c.expiration} ${c.shortStrike} ${c.longStrike} --qty ${qty} --credit ${c.midCredit.toFixed(2)} --confirm`);
    lines.push('');
  }
  lines.push(`Each open order attaches a GTC close at ${Math.round(cfg.profitTargetPct * 100)}% of the credit${cfg.attachProfitTargetOnOpen ? '' : ' (disabled: SPREAD_ATTACH_PROFIT_TARGET=false)'}.`);
  const top = candidates[0];
  return {
    key: `opp:${dayKey()}:${candidates.map((c) => c.id).join('|')}`,
    subject: `💰 Put spread premium: ${top.underlying} ${top.shortStrike}/${top.longStrike} ${Math.round(top.returnOnRisk * 100)}% ROR${
      candidates.length > 1 ? ` +${candidates.length - 1} more` : ''
    }`,
    text: lines.join('\n'),
  };
}

export function buildCloseAlert(statuses: SpreadStatus[], cfg: StrategyConfig): Alert {
  const lines: string[] = [];
  const icon: Record<SpreadStatus['action'], string> = {
    HOLD: '⏸',
    TAKE_PROFIT: '✅',
    TAKE_PROFIT_URGENT: '🚨✅',
    STOP_LOSS: '🛑',
    MANAGE_DTE: '⏰',
    SHORT_STRIKE_TESTED: '⚠️',
    ASSIGNMENT_RISK: '🚨',
  };
  for (const s of statuses) {
    lines.push(`${icon[s.action]} ${s.underlying} ${s.expiration} ${s.shortStrike}/${s.longStrike} ×${s.quantity} — ${s.action.replace(/_/g, ' ')}`);
    lines.push(`   ${s.message}`);
    lines.push(
      `   Opened for ${s.openCredit.toFixed(2)}, closes now for ~${s.currentMidDebit.toFixed(2)} mid (${s.currentNaturalDebit.toFixed(2)} natural) → P/L $${s.unrealizedPnl} of $${s.maxProfit} max`
    );
    if (s.hasWorkingCloseOrder) {
      lines.push(`   A closing order is already working at Schwab.`);
    } else if (s.action === 'TAKE_PROFIT' || s.action === 'TAKE_PROFIT_URGENT') {
      const pct = s.action === 'TAKE_PROFIT_URGENT' ? cfg.profitPromptMaxPct : cfg.profitTargetPct;
      lines.push(`   → npm run spreads -- close ${s.id} --debit ${s.currentMidDebit.toFixed(2)} --confirm   (take ${Math.round(s.profitCaptured * 100)}% now)`);
      lines.push(`   → npm run spreads -- close ${s.id} --pct ${pct} --confirm   (GTC at ${Math.round(pct * 100)}% of credit)`);
    } else if (s.action !== 'HOLD') {
      lines.push(`   → npm run spreads -- close ${s.id} --debit ${s.currentNaturalDebit.toFixed(2)} --confirm`);
    }
    lines.push('');
  }
  const first = statuses[0];
  const bucket = Math.floor(first.profitCaptured * 20) / 20; // re-alert when captured % moves 5pts
  return {
    key: `close:${dayKey()}:${statuses.map((s) => `${s.id}@${s.action}`).join('|')}:${bucket}`,
    subject: `${icon[first.action]} ${first.underlying} ${first.shortStrike}/${first.longStrike}: ${Math.round(first.profitCaptured * 100)}% captured — ${first.action.replace(/_/g, ' ')}${
      statuses.length > 1 ? ` (+${statuses.length - 1})` : ''
    }`,
    text: lines.join('\n'),
  };
}
