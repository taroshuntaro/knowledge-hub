import type { ErrorCode } from '@knowledge-hub/shared';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Config } from '../config';
import { AppError } from '../errors';
import { logger } from '../logger';
import { setSessionCookie } from '../middleware/session';
import { resolveOidcUser, type OidcTxn } from '../services/oidc-service';
import { createSession } from '../services/session-service';
import type { AppEnv } from '../types';

const TXN_COOKIE = 'oidc_txn';
const ERROR_QUERY: Partial<Record<ErrorCode, string>> = {
  OIDC_EMAIL: 'oidc_email',
  OIDC_DOMAIN: 'oidc_domain',
  OIDC_INACTIVE: 'oidc_inactive',
  OIDC_UNAVAILABLE: 'oidc_unavailable',
};

function redirectUri(config: Config): string {
  return `${config.appUrl}/api/auth/oidc/callback`;
}
function loginError(config: Config, code: string): string {
  return `${config.appUrl}/login?error=${code}`;
}
function parseTxn(raw: string | undefined): OidcTxn | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString()) as Partial<OidcTxn>;
    if (typeof parsed.state !== 'string' || typeof parsed.nonce !== 'string' || typeof parsed.codeVerifier !== 'string')
      return null;
    return { state: parsed.state, nonce: parsed.nonce, codeVerifier: parsed.codeVerifier };
  } catch {
    return null;
  }
}

export const authOidcRoutes = new Hono<AppEnv>()
  .get('/login', async (c) => {
    const config = c.get('config');
    const oidcAuth = c.get('oidcAuth');
    if (!oidcAuth) throw new AppError('NOT_FOUND', 'SSO は設定されていません', 404);
    try {
      const { url, txn } = await oidcAuth.authorizationUrl(redirectUri(config));
      setCookie(c, TXN_COOKIE, Buffer.from(JSON.stringify(txn)).toString('base64url'), {
        httpOnly: true,
        sameSite: 'Lax',
        path: '/api/auth/oidc',
        secure: config.nodeEnv === 'production',
        maxAge: 600,
      });
      return c.redirect(url, 302);
    } catch (err) {
      // ブラウザナビゲーションなので JSON を返さずエラーページへ（§9）
      logger.warn({ err }, 'oidc login redirect failed');
      const code = err instanceof AppError ? (ERROR_QUERY[err.code] ?? 'oidc_failed') : 'oidc_failed';
      return c.redirect(loginError(config, code), 302);
    }
  })
  .get('/callback', async (c) => {
    const config = c.get('config');
    const oidcAuth = c.get('oidcAuth');
    // txn Cookie は成否に関わらず一度きりで削除（リプレイ防止）
    const raw = getCookie(c, TXN_COOKIE);
    deleteCookie(c, TXN_COOKIE, { path: '/api/auth/oidc' });
    if (!oidcAuth) return c.redirect(loginError(config, 'oidc_failed'), 302);
    const txn = parseTxn(raw);
    if (!txn) return c.redirect(loginError(config, 'oidc_failed'), 302);
    try {
      const claims = await oidcAuth.exchangeCode(redirectUri(config), new URL(c.req.url).searchParams, txn);
      const user = await resolveOidcUser(c.get('db'), claims, config.oidc?.allowedEmailDomains ?? []);
      const sid = await createSession(c.get('db'), user.id);
      setSessionCookie(c, sid, config);
      return c.redirect(config.appUrl, 302);
    } catch (err) {
      // 交換系例外のメッセージに機微情報が含まれうるため、詳細は warn ログのみ（§9）
      logger.warn({ err }, 'oidc callback failed');
      const code = err instanceof AppError ? (ERROR_QUERY[err.code] ?? 'oidc_failed') : 'oidc_failed';
      return c.redirect(loginError(config, code), 302);
    }
  });
