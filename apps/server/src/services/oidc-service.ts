import { eq, sql } from 'drizzle-orm';
import * as oidc from 'openid-client';
import { users } from '../db/schema';
import type { Config } from '../config';
import { AppError } from '../errors';
import type { Db } from '../types';
import { normalizeEmail } from './email';

export type OidcClaims = { email?: string; emailVerified?: boolean; name?: string };

async function upsertByEmail(db: Db, email: string, emailVerified: boolean) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1)
      .for('update');
    // JIT 廃止: 事前作成された行がなければログインさせない（事前許可制）
    if (!existing) {
      throw new AppError(
        'OIDC_NOT_PROVISIONED',
        'このメールアドレスは登録されていません。管理者にお問い合わせください',
        403,
      );
    }
    if (!existing.isActive) throw new AppError('OIDC_INACTIVE', 'このアカウントは無効化されています', 403);
    if (existing.authProvider === 'pending') {
      // 事前作成された行を初回 SSO ログインでクレーム: displayName は事前作成時のまま維持する
      const [claimed] = await tx
        .update(users)
        .set({ authProvider: 'oidc', passwordHash: null })
        .where(eq(users.id, existing.id))
        .returning();
      return claimed;
    }
    if (existing.authProvider === 'password') {
      // 既存パスワードアカウントへの自動リンクは email 検証済みのときのみ許可する。
      // 未検証（claim 省略/false）の email で他人のパスワードアカウントを乗っ取る
      // （passwordHash を null 化して SSO 専用化する）攻撃を防ぐ。
      if (!emailVerified) {
        throw new AppError(
          'OIDC_LINK_UNVERIFIED',
          'このメールアドレスはパスワード認証で登録済みです。SSO と連携するには IdP 側でメールアドレスの検証が必要です',
          403,
        );
      }
      // 自動リンク: 以降パスワードログイン・リセットは既存の provider チェックで拒否される（SSO 専用化）
      const [linked] = await tx
        .update(users)
        .set({ authProvider: 'oidc', passwordHash: null })
        .where(eq(users.id, existing.id))
        .returning();
      return linked;
    }
    return existing;
  });
}

export async function resolveOidcUser(
  db: Db,
  claims: OidcClaims,
  allowedEmailDomains: string[],
): Promise<typeof users.$inferSelect> {
  const email = claims.email ? normalizeEmail(claims.email) : undefined;
  if (!email || claims.emailVerified === false) {
    throw new AppError('OIDC_EMAIL', 'メールアドレスを確認できませんでした', 403);
  }
  if (allowedEmailDomains.length > 0) {
    const domain = email.split('@')[1] ?? '';
    if (!allowedEmailDomains.includes(domain)) {
      throw new AppError('OIDC_DOMAIN', 'このメールドメインは許可されていません', 403);
    }
  }
  const emailVerified = claims.emailVerified === true;
  return upsertByEmail(db, email, emailVerified);
}

export type OidcTxn = { state: string; nonce: string; codeVerifier: string };
export type OidcAuth = {
  authorizationUrl(redirectUri: string): Promise<{ url: string; txn: OidcTxn }>;
  exchangeCode(redirectUri: string, callbackParams: URLSearchParams, txn: OidcTxn): Promise<OidcClaims>;
};

export function createOidcAuth(
  settings: NonNullable<Config['oidc']>,
  opts: { allowInsecure: boolean },
): OidcAuth {
  // ディスカバリは初回ログイン時に遅延実行しメモ化。失敗時はメモ化せず次回再試行（IdP 停止が起動を妨げない）
  let cached: oidc.Configuration | null = null;
  async function discover(): Promise<oidc.Configuration> {
    if (cached) return cached;
    try {
      const discovered = await oidc.discovery(
        new URL(settings.issuer),
        settings.clientId,
        settings.clientSecret,
        undefined,
        opts.allowInsecure ? { execute: [oidc.allowInsecureRequests] } : undefined,
      );
      cached = discovered;
      return discovered;
    } catch {
      throw new AppError('OIDC_UNAVAILABLE', 'SSO プロバイダに接続できません。しばらくしてから再試行してください', 503);
    }
  }
  return {
    async authorizationUrl(redirectUri) {
      const cfg = await discover();
      const codeVerifier = oidc.randomPKCECodeVerifier();
      const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();
      const url = oidc.buildAuthorizationUrl(cfg, {
        redirect_uri: redirectUri,
        scope: 'openid email profile',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });
      return { url: url.href, txn: { state, nonce, codeVerifier } };
    },
    async exchangeCode(redirectUri, callbackParams, txn) {
      const cfg = await discover();
      const currentUrl = new URL(redirectUri);
      currentUrl.search = callbackParams.toString();
      const tokens = await oidc.authorizationCodeGrant(cfg, currentUrl, {
        pkceCodeVerifier: txn.codeVerifier,
        expectedState: txn.state,
        expectedNonce: txn.nonce,
      });
      const claims = tokens.claims();
      return {
        email: typeof claims?.email === 'string' ? claims.email : undefined,
        emailVerified: typeof claims?.email_verified === 'boolean' ? claims.email_verified : undefined,
        name: typeof claims?.name === 'string' ? claims.name : undefined,
      };
    },
  };
}
