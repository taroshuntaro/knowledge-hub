import { eq, sql } from 'drizzle-orm';
import * as oidc from 'openid-client';
import { users } from '../db/schema';
import type { Config } from '../config';
import { AppError } from '../errors';
import type { Db } from '../types';

export type OidcClaims = { email?: string; emailVerified?: boolean; name?: string };

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === '23505';
}

async function upsertByEmail(db: Db, email: string, displayName: string) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1)
      .for('update');
    if (existing) {
      if (!existing.isActive) throw new AppError('OIDC_INACTIVE', 'このアカウントは無効化されています', 403);
      if (existing.authProvider === 'password') {
        // 自動リンク: 以降パスワードログイン・リセットは既存の provider チェックで拒否される（SSO 専用化）
        const [linked] = await tx
          .update(users)
          .set({ authProvider: 'oidc', passwordHash: null })
          .where(eq(users.id, existing.id))
          .returning();
        return linked;
      }
      return existing;
    }
    const [created] = await tx
      .insert(users)
      .values({ email, displayName, role: 'member', authProvider: 'oidc', passwordHash: null })
      .returning();
    return created;
  });
}

export async function resolveOidcUser(
  db: Db,
  claims: OidcClaims,
  allowedEmailDomains: string[],
): Promise<typeof users.$inferSelect> {
  const email = claims.email?.trim().toLowerCase();
  if (!email || claims.emailVerified === false) {
    throw new AppError('OIDC_EMAIL', 'メールアドレスを確認できませんでした', 403);
  }
  if (allowedEmailDomains.length > 0) {
    const domain = email.split('@')[1] ?? '';
    if (!allowedEmailDomains.includes(domain)) {
      throw new AppError('OIDC_DOMAIN', 'このメールドメインは許可されていません', 403);
    }
  }
  const displayName = claims.name?.trim() || email.split('@')[0];
  try {
    return await upsertByEmail(db, email, displayName);
  } catch (err) {
    // 並行初回ログインの一意制約違反: トランザクションごと再試行（2 回目は必ず既存行に当たる）
    if (isUniqueViolation(err)) return upsertByEmail(db, email, displayName);
    throw err;
  }
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
