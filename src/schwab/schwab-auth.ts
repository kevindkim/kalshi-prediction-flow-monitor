import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { URL, URLSearchParams } from 'url';

// Schwab Trader API OAuth 2.0 (three-legged).
//   - Access token lives 30 minutes
//   - Refresh token lives 7 days, after which you must log in again in a browser
//   - Token endpoint expects HTTP Basic auth of base64(appKey:appSecret)
//
// Tokens are persisted to SCHWAB_TOKEN_PATH (default ./schwab-tokens.json) so
// the monitor can run unattended for a week between manual logins.

const AUTH_BASE = 'https://api.schwabapi.com/v1/oauth';
const ACCESS_TOKEN_SAFETY_MARGIN_SEC = 60;

export interface StoredTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  scope?: string;
  expires_in: number;
  access_expires_at: number; // unix seconds
  refresh_expires_at: number; // unix seconds (created + 7 days)
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

export interface SchwabAuthConfig {
  appKey: string;
  appSecret: string;
  callbackUrl: string;
  tokenPath: string;
}

export function loadAuthConfig(): SchwabAuthConfig {
  const appKey = process.env.SCHWAB_APP_KEY;
  const appSecret = process.env.SCHWAB_APP_SECRET;
  if (!appKey || !appSecret) {
    throw new Error('Missing SCHWAB_APP_KEY / SCHWAB_APP_SECRET in environment');
  }
  return {
    appKey,
    appSecret,
    callbackUrl: process.env.SCHWAB_CALLBACK_URL || 'https://127.0.0.1:8182/callback',
    tokenPath: process.env.SCHWAB_TOKEN_PATH || path.resolve(process.cwd(), 'schwab-tokens.json'),
  };
}

export class SchwabAuth {
  private tokens: StoredTokens | null = null;
  private refreshing: Promise<string> | null = null;

  constructor(private readonly config: SchwabAuthConfig = loadAuthConfig()) {}

  /** Build the URL the user opens in a browser to grant access. */
  buildAuthorizeUrl(state: string = crypto.randomBytes(8).toString('hex')): string {
    const params = new URLSearchParams({
      client_id: this.config.appKey,
      redirect_uri: this.config.callbackUrl,
      response_type: 'code',
      state,
    });
    return `${AUTH_BASE}/authorize?${params.toString()}`;
  }

  /**
   * Accepts either the raw `code` or the full redirected callback URL
   * (https://127.0.0.1:8182/callback?code=...&session=...) and exchanges it.
   */
  async exchangeCode(codeOrUrl: string): Promise<StoredTokens> {
    let code = codeOrUrl.trim();
    if (code.startsWith('http')) {
      const parsed = new URL(code);
      const c = parsed.searchParams.get('code');
      if (!c) throw new Error('Callback URL did not contain a code parameter');
      code = c;
    }
    // Schwab's code ends in "@" which browsers URL-encode as %40
    code = decodeURIComponent(code);

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.callbackUrl,
    });
    const tokens = await this.postToken(body);
    this.saveTokens(tokens);
    console.log('✅ Schwab tokens saved to', this.config.tokenPath);
    return tokens;
  }

  /** Returns a valid access token, refreshing if it is within a minute of expiry. */
  async getAccessToken(): Promise<string> {
    const tokens = this.loadTokens();
    if (!tokens) {
      throw new Error(
        `No Schwab tokens at ${this.config.tokenPath}. Run: npm run spreads -- auth`
      );
    }
    const now = Math.floor(Date.now() / 1000);
    if (tokens.access_expires_at - ACCESS_TOKEN_SAFETY_MARGIN_SEC > now) {
      return tokens.access_token;
    }
    if (tokens.refresh_expires_at <= now) {
      throw new Error(
        'Schwab refresh token expired (7-day limit). Run: npm run spreads -- auth'
      );
    }
    if (!this.refreshing) {
      this.refreshing = this.refresh(tokens.refresh_token).finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  /** Human-readable token status for the CLI. */
  status(): { hasTokens: boolean; accessMinutesLeft: number; refreshDaysLeft: number } {
    const tokens = this.loadTokens();
    if (!tokens) return { hasTokens: false, accessMinutesLeft: 0, refreshDaysLeft: 0 };
    const now = Math.floor(Date.now() / 1000);
    return {
      hasTokens: true,
      accessMinutesLeft: Math.max(0, Math.round((tokens.access_expires_at - now) / 60)),
      refreshDaysLeft: Math.max(0, Number(((tokens.refresh_expires_at - now) / 86400).toFixed(1))),
    };
  }

  /**
   * Interactive login: prints the authorize URL, then either listens on the
   * callback port (if the callback URL is a 127.0.0.1 URL and certs are
   * provided) or asks the user to paste the redirected URL.
   */
  async interactiveLogin(readLine: (prompt: string) => Promise<string>): Promise<void> {
    const url = this.buildAuthorizeUrl();
    console.log('\n🔐 Open this URL, log in to Schwab, and approve the app:\n');
    console.log(url);
    console.log(
      '\nAfter approving, the browser lands on your callback URL (it may show a "can\'t connect" page, that is fine).'
    );
    const pasted = await readLine('\nPaste the full redirected URL here: ');
    await this.exchangeCode(pasted);
  }

  private async refresh(refreshToken: string): Promise<string> {
    console.log('🔄 Refreshing Schwab access token...');
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const tokens = await this.postToken(body, this.loadTokens()?.refresh_expires_at);
    this.saveTokens(tokens);
    return tokens.access_token;
  }

  private async postToken(body: URLSearchParams, keepRefreshExpiry?: number): Promise<StoredTokens> {
    const basic = Buffer.from(`${this.config.appKey}:${this.config.appSecret}`).toString('base64');
    const res = await fetch(`${AUTH_BASE}/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Schwab token request failed: ${res.status} ${res.statusText}\n${text}`);
    }
    const data = JSON.parse(text) as TokenResponse;
    const now = Math.floor(Date.now() / 1000);
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type,
      scope: data.scope,
      expires_in: data.expires_in,
      access_expires_at: now + data.expires_in,
      // Schwab does not return refresh expiry; it is 7 days from the original login.
      // A refresh returns the same refresh token, so keep the original expiry.
      refresh_expires_at: keepRefreshExpiry ?? now + 7 * 86400,
    };
  }

  private loadTokens(): StoredTokens | null {
    if (this.tokens) return this.tokens;
    if (!fs.existsSync(this.config.tokenPath)) return null;
    try {
      this.tokens = JSON.parse(fs.readFileSync(this.config.tokenPath, 'utf8')) as StoredTokens;
      return this.tokens;
    } catch (error) {
      console.error('⚠️ Could not read token file:', error);
      return null;
    }
  }

  private saveTokens(tokens: StoredTokens): void {
    this.tokens = tokens;
    fs.writeFileSync(this.config.tokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  }
}

/**
 * Optional helper: start a one-shot local callback listener so the code is
 * captured automatically. Schwab requires an https callback, so this needs a
 * cert/key pair (e.g. from mkcert) at SCHWAB_TLS_CERT / SCHWAB_TLS_KEY. If the
 * files are missing we fall back to plain http, which only works if the
 * registered callback URL is http (Schwab generally rejects that).
 */
export function waitForCallbackCode(callbackUrl: string, timeoutMs = 5 * 60 * 1000): Promise<string> {
  const parsed = new URL(callbackUrl);
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  const certPath = process.env.SCHWAB_TLS_CERT;
  const keyPath = process.env.SCHWAB_TLS_KEY;

  return new Promise((resolve, reject) => {
    const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
      const reqUrl = new URL(req.url || '/', callbackUrl);
      if (reqUrl.pathname !== parsed.pathname) {
        res.writeHead(404).end();
        return;
      }
      const code = reqUrl.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(code ? 'Schwab authorization received. You can close this tab.' : 'No code received.');
      server.close();
      clearTimeout(timer);
      code ? resolve(code) : reject(new Error('Callback did not include a code'));
    };

    const server =
      parsed.protocol === 'https:' && certPath && keyPath && fs.existsSync(certPath) && fs.existsSync(keyPath)
        ? https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, handler)
        : http.createServer(handler);

    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Timed out waiting for Schwab callback'));
    }, timeoutMs);

    server.listen(port, '127.0.0.1', () => {
      console.log(`👂 Listening for Schwab callback on ${callbackUrl}`);
    });
    server.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
