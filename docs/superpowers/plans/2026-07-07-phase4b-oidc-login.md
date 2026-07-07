# Phase 4b: OIDC 汎用ログイン Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 任意の OIDC IdP に環境変数だけで接続し、初回ログインで member を JIT 作成（既存パスワードユーザーは email で自動リンク）する SSO ログインを追加する。

**Architecture:** `openid-client` v6（認定ライブラリ）に Authorization Code + PKCE・ID トークン検証を委譲。プロトコル層（`createOidcAuth`）と DB 層（`resolveOidcUser`）を分離し、後者は実 DB（Testcontainers）で、前者はテスト内モック IdP（jose 実署名）で検証する。セッションは既存の DB セッションをそのまま使う。

**Tech Stack:** Hono / Drizzle / PostgreSQL / openid-client ^6.8 / jose（テスト署名用 devDependency）/ React 19 / Keycloak（compose profile、手動検証用）

**Spec:** `docs/superpowers/specs/2026-07-07-phase4b-oidc-login-design.md`（真とする。矛盾があればスペックが優先）

## Global Constraints

- OIDC は `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` の **3 変数が揃ったときのみ有効**。一部のみ設定は起動時エラー。`PASSWORD_AUTH_ENABLED=false` かつ OIDC 無効も起動時エラー
- `/api/auth/oidc/login`・`/callback` は**ブラウザナビゲーション**: エラーは JSON でなく必ず `${config.appUrl}/login?error=<code>` へ 302。code は `oidc_failed` / `oidc_domain` / `oidc_inactive` / `oidc_email` / `oidc_unavailable` の 5 種のみ
- 自動リンク = `authProvider='oidc'` に更新 + `passwordHash=null`。email 照合は **lower() 両側**、JIT 新規作成は email を小文字化して保存
- IdP の `sub` は保存しない（V1 判断）。ロールは常に `member`
- トークン・claims 生値・email をログに出さない（logger.warn には err オブジェクトのみ）
- エラーは `AppError`。ユーザー入力・IdP 障害で 500 を返さない
- 新 ErrorCode: `OIDC_EMAIL` / `OIDC_DOMAIN` / `OIDC_INACTIVE` / `OIDC_UNAVAILABLE`（shared の ERROR_CODES に追加）
- サーバーテストは Testcontainers 実 PostgreSQL。**openid-client をモックしない**（モック IdP は HTTP レベル）
- コミットは英語 Conventional Commits。TDD（RED 確認 → 実装 → GREEN）

---

### Task 1: OIDC 設定（config.ts 拡張 + fail-fast 検証）

**Files:**
- Modify: `apps/server/src/config.ts`
- Test: `apps/server/src/config.test.ts`（既存があれば追記、なければ新規。実 DB 不要の純粋ユニット）

**Interfaces:**
- Produces: `Config['oidc']?: { issuer: string; clientId: string; clientSecret: string; allowedEmailDomains: string[] }`（`undefined` = OIDC 無効）。後続タスクはこの型のみに依存

- [ ] **Step 1: 失敗するテストを書く**

```ts
describe('loadConfig oidc', () => {
  const base = { DATABASE_URL: 'postgres://x' };
  it('3 変数が揃ったら oidc が有効になる', () => {
    const c = loadConfig({ ...base, OIDC_ISSUER: 'https://idp.example.com', OIDC_CLIENT_ID: 'kh', OIDC_CLIENT_SECRET: 's' });
    expect(c.oidc).toEqual({ issuer: 'https://idp.example.com', clientId: 'kh', clientSecret: 's', allowedEmailDomains: [] });
  });
  it('未設定なら oidc は undefined', () => {
    expect(loadConfig(base).oidc).toBeUndefined();
  });
  it('一部のみ設定は起動時エラー', () => {
    expect(() => loadConfig({ ...base, OIDC_ISSUER: 'https://idp.example.com' })).toThrow(/OIDC_/);
  });
  it('ドメイン制限はカンマ区切り・小文字化・空要素除去でパースされる', () => {
    const c = loadConfig({ ...base, OIDC_ISSUER: 'https://i', OIDC_CLIENT_ID: 'a', OIDC_CLIENT_SECRET: 'b', OIDC_ALLOWED_EMAIL_DOMAINS: 'Example.com, corp.co.jp,' });
    expect(c.oidc?.allowedEmailDomains).toEqual(['example.com', 'corp.co.jp']);
  });
  it('PASSWORD_AUTH_ENABLED=false かつ OIDC 無効は起動時エラー', () => {
    expect(() => loadConfig({ ...base, PASSWORD_AUTH_ENABLED: 'false' })).toThrow(/ログイン手段/);
  });
});
```

- [ ] **Step 2: RED を確認** — Run: `cd apps/server && npx vitest run src/config.test.ts` → FAIL（`oidc` プロパティ不存在）

- [ ] **Step 3: 実装**

envSchema に追加:

```ts
OIDC_ISSUER: z.string().url().optional(),
OIDC_CLIENT_ID: z.string().min(1).optional(),
OIDC_CLIENT_SECRET: z.string().min(1).optional(),
OIDC_ALLOWED_EMAIL_DOMAINS: z.string().optional(),
```

`Config` 型に `oidc?: { issuer: string; clientId: string; clientSecret: string; allowedEmailDomains: string[] };` を追加し、`loadConfig` の return 前に:

```ts
const oidcVars = [e.OIDC_ISSUER, e.OIDC_CLIENT_ID, e.OIDC_CLIENT_SECRET];
const oidcSet = oidcVars.filter((v) => v !== undefined && v !== '').length;
if (oidcSet > 0 && oidcSet < 3) {
  throw new Error('OIDC_ISSUER / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET はすべて設定するか、すべて未設定にしてください');
}
const oidc =
  oidcSet === 3
    ? {
        issuer: e.OIDC_ISSUER!,
        clientId: e.OIDC_CLIENT_ID!,
        clientSecret: e.OIDC_CLIENT_SECRET!,
        allowedEmailDomains: (e.OIDC_ALLOWED_EMAIL_DOMAINS ?? '')
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s.length > 0),
      }
    : undefined;
if (e.PASSWORD_AUTH_ENABLED === 'false' && !oidc) {
  throw new Error('PASSWORD_AUTH_ENABLED=false には OIDC 設定が必要です（ログイン手段がなくなります）');
}
```

return オブジェクトに `oidc,` を追加。

- [ ] **Step 4: GREEN を確認** — Run: `npx vitest run src/config.test.ts` → PASS。`pnpm -r typecheck` もクリーン

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/config.ts apps/server/src/config.test.ts
git commit -m "feat(server): add oidc config with fail-fast validation"
```

---

### Task 2: JIT プロビジョニング / 自動リンク（resolveOidcUser）+ shared 型

**Files:**
- Modify: `packages/shared/src/errors.ts`（ERROR_CODES に `'OIDC_EMAIL', 'OIDC_DOMAIN', 'OIDC_INACTIVE', 'OIDC_UNAVAILABLE'` を追加）
- Modify: `packages/shared/src/types.ts`（`SessionUser` に `authProvider: 'oidc' | 'password';` を追加）
- Modify: `apps/server/src/services/session-service.ts`（`toSessionUser` に `authProvider: user.authProvider,` を追加）
- Create: `apps/server/src/services/oidc-service.ts`（このタスクでは DB 層のみ。プロトコル層は Task 3 で同ファイルに追記）
- Test: `apps/server/src/services/oidc-service.test.ts`（実 DB）

**Interfaces:**
- Produces: `export type OidcClaims = { email?: string; emailVerified?: boolean; name?: string };`
- Produces: `export async function resolveOidcUser(db: Db, claims: OidcClaims, allowedEmailDomains: string[]): Promise<typeof users.$inferSelect>` — 失敗は `AppError('OIDC_EMAIL'|'OIDC_DOMAIN'|'OIDC_INACTIVE', <日本語>, 403)`
- 注意: `SessionUser.authProvider` 追加により web の型が広がる（additive）。web 側の利用は Task 5

- [ ] **Step 1: 失敗するテストを書く**（既存テストの `createTestApp`/`resetDb`/ユーザー seed ヘルパーの流儀を踏襲）

```ts
describe('resolveOidcUser', () => {
  it('新規 email は member / oidc / passwordHash null で JIT 作成される', async () => {
    const u = await resolveOidcUser(db, { email: 'New.User@Example.com', emailVerified: true, name: 'New User' }, []);
    expect(u).toMatchObject({ email: 'new.user@example.com', displayName: 'New User', role: 'member', authProvider: 'oidc', passwordHash: null });
  });
  it('name claim がなければ email ローカル部が displayName になる', async () => {
    const u = await resolveOidcUser(db, { email: 'taro@example.com' }, []);
    expect(u.displayName).toBe('taro');
  });
  it('既存パスワードユーザーは自動リンクされ SSO 専用化される', async () => {
    const existing = /* 既存 seed ヘルパーで authProvider='password'・passwordHash あり のユーザー作成 */;
    const u = await resolveOidcUser(db, { email: existing.email }, []);
    expect(u.id).toBe(existing.id);
    expect(u.authProvider).toBe('oidc');
    expect(u.passwordHash).toBeNull();
    // リンク後はパスワードログイン不可（既存 loginWithPassword の provider チェック）
    expect(await loginWithPassword(db, existing.email, 'correct-horse-battery')).toBeNull();
  });
  it('oidc 既存ユーザーはそのままログインできる', async () => { /* 2 回 resolve → 同一 id、users は 1 行 */ });
  it('無効化ユーザーは OIDC_INACTIVE で拒否される', async () => {
    /* isActive=false の seed → expect(resolveOidcUser(...)).rejects.toMatchObject({ code: 'OIDC_INACTIVE' }) */
  });
  it('email claim なしは OIDC_EMAIL で拒否される', async () => { /* {} → rejects code OIDC_EMAIL */ });
  it('email_verified=false は OIDC_EMAIL で拒否される', async () => { /* rejects */ });
  it('email_verified 未提供(undefined)は許容される', async () => { /* resolves */ });
  it('ドメイン制限に合わないと OIDC_DOMAIN で拒否される（既存ユーザーでも）', async () => {
    /* allowedEmailDomains=['corp.example.com'] で other.com → rejects。既存ユーザー email でも rejects */
  });
  it('並行 JIT は 1 ユーザーに収束する（一意制約フォールバック）', async () => {
    const results = await Promise.allSettled([
      resolveOidcUser(db, { email: 'race@example.com' }, []),
      resolveOidcUser(db, { email: 'race@example.com' }, []),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const ids = results.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id);
    expect(new Set(ids).size).toBe(1);
  });
});
```

- [ ] **Step 2: RED を確認** — Run: `npx vitest run src/services/oidc-service.test.ts` → FAIL（module 不存在）

- [ ] **Step 3: 実装**

```ts
// apps/server/src/services/oidc-service.ts
import { eq, sql } from 'drizzle-orm';
import { users } from '../db/schema';
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
```

shared の 2 ファイルと `toSessionUser` は Interfaces のとおり 1 行ずつ追加。

- [ ] **Step 4: GREEN + 全体確認** — Run: `npx vitest run src/services/oidc-service.test.ts` → PASS。`pnpm -r typecheck` クリーン（SessionUser 追加が web を壊さないこと）。`pnpm --filter @knowledge-hub/shared test` PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): add oidc user resolution with jit and auto-link"
```

---

### Task 3: プロトコル層 + ルート + テスト内モック IdP

**Files:**
- Modify: `apps/server/package.json`（`pnpm --filter @knowledge-hub/server add openid-client` と `pnpm --filter @knowledge-hub/server add -D jose`）
- Modify: `apps/server/src/services/oidc-service.ts`（プロトコル層を追記）
- Create: `apps/server/src/routes/auth-oidc.ts`
- Create: `apps/server/src/test/mock-idp.ts`
- Modify: `apps/server/src/types.ts`（AppEnv Variables に `oidcAuth: OidcAuth | null`）
- Modify: `apps/server/src/app.ts`（deps に `oidcAuth` 追加・`c.set`・`.route('/api/auth/oidc', authOidcRoutes)`）
- Modify: `apps/server/src/index.ts`（`config.oidc` があれば `createOidcAuth(config.oidc, { allowInsecure: config.nodeEnv !== 'production' })` を生成して渡す。なければ `null`）
- Modify: `apps/server/src/test/helpers.ts`（`createTestApp(opts?: { config?: Partial<Config>; oidcAuth?: OidcAuth | null })` — 既存呼び出しは無変更で動くこと。buildApp へ `oidcAuth: opts?.oidcAuth ?? null` を渡す）
- Test: `apps/server/src/routes/auth-oidc.test.ts`

**Interfaces:**
- Consumes: Task 1 の `Config['oidc']`、Task 2 の `resolveOidcUser` / `OidcClaims`、新 ErrorCode
- Produces: `export type OidcTxn = { state: string; nonce: string; codeVerifier: string };`
- Produces: `export type OidcAuth = { authorizationUrl(redirectUri: string): Promise<{ url: string; txn: OidcTxn }>; exchangeCode(redirectUri: string, callbackParams: URLSearchParams, txn: OidcTxn): Promise<OidcClaims> };`
- Produces: `export function createOidcAuth(settings: NonNullable<Config['oidc']>, opts: { allowInsecure: boolean }): OidcAuth`
- Produces（テスト用）: `export async function startMockIdp(clientId: string): Promise<MockIdp>` — `{ issuer: string; queueClaims(claims: Record<string, unknown>): void; authorize(authorizationUrl: string): Promise<string>; close(): Promise<void> }`

- [ ] **Step 1: 依存を追加**

Run: `pnpm --filter @knowledge-hub/server add openid-client && pnpm --filter @knowledge-hub/server add -D jose`
Expected: openid-client ^6.8、jose ^6 が入る

- [ ] **Step 2: 失敗するテストを書く**

```ts
// apps/server/src/routes/auth-oidc.test.ts の骨子
let idp: MockIdp;
let ctx: TestAppCtx;
beforeAll(async () => {
  idp = await startMockIdp('kh-test');
  ctx = await createTestApp({
    config: { oidc: { issuer: idp.issuer, clientId: 'kh-test', clientSecret: 'test-secret', allowedEmailDomains: [] } },
    oidcAuth: createOidcAuth(
      { issuer: idp.issuer, clientId: 'kh-test', clientSecret: 'test-secret', allowedEmailDomains: [] },
      { allowInsecure: true },
    ),
  });
});
afterAll(async () => { await idp.close(); /* 既存の ctx 後始末 */ });

async function ssoLogin(claims: Record<string, unknown>) {
  const loginRes = await ctx.app.request('/api/auth/oidc/login');
  expect(loginRes.status).toBe(302);
  const cookie = loginRes.headers.get('set-cookie')!;
  idp.queueClaims(claims);
  const cbUrl = await idp.authorize(loginRes.headers.get('location')!);
  return ctx.app.request(`/api/auth/oidc/callback${new URL(cbUrl).search}`, { headers: { cookie } });
}

it('フルフロー: JIT 作成 → セッション Cookie → APP_URL へ 302', async () => {
  const res = await ssoLogin({ email: 'sso@example.com', email_verified: true, name: 'SSO Taro' });
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe(/* testConfig().appUrl */);
  expect(res.headers.get('set-cookie')).toContain('sid=');
  /* db で users 1 行（member/oidc）を assert */
});
it('ドメイン不許可は /login?error=oidc_domain へ 302 しセッションを作らない', async () => { /* allowedEmailDomains つき別 ctx */ });
it('無効化ユーザーは oidc_inactive、email_verified=false は oidc_email', async () => { /* */ });
it('state 改ざんは oidc_failed でセッションなし', async () => { /* callback の state query を書き換え */ });
it('oidc_txn Cookie なしは oidc_failed', async () => { /* headers なしで callback */ });
it('IdP 到達不能なら login が oidc_unavailable へ 302（500 にしない）', async () => {
  const dead = createOidcAuth({ issuer: 'http://127.0.0.1:1', clientId: 'x', clientSecret: 'y', allowedEmailDomains: [] }, { allowInsecure: true });
  /* dead を持つ ctx → GET /api/auth/oidc/login → 302 /login?error=oidc_unavailable */
});
it('OIDC 未設定なら login は 404', async () => { /* oidcAuth: null の ctx */ });
```

- [ ] **Step 3: RED を確認** — Run: `npx vitest run src/routes/auth-oidc.test.ts` → FAIL（module 不存在）

- [ ] **Step 4: モック IdP を実装**

```ts
// apps/server/src/test/mock-idp.ts — テスト専用。ディスカバリ/JWKS/authorize/token を実 HTTP で提供し、
// jose で実署名した ID トークンを返す（openid-client の署名検証まで本物のパスを通すため）。
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

export type MockIdp = {
  issuer: string;
  queueClaims(claims: Record<string, unknown>): void;
  authorize(authorizationUrl: string): Promise<string>; // 302 Location（callback URL）を返す
  close(): Promise<void>;
};

export async function startMockIdp(clientId: string): Promise<MockIdp> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, { nonce: string | null; claims: Record<string, unknown> }>();
  let queued: Record<string, unknown> = {};
  let issuer = ''; // listen 後に確定

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url!, issuer);
      const json = (body: unknown) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(body));
      };
      if (url.pathname === '/.well-known/openid-configuration') {
        return json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
        });
      }
      if (url.pathname === '/jwks') return json({ keys: [jwk] });
      if (url.pathname === '/authorize') {
        const code = randomUUID();
        codes.set(code, { nonce: url.searchParams.get('nonce'), claims: queued });
        const redirect = new URL(url.searchParams.get('redirect_uri')!);
        redirect.searchParams.set('code', code);
        redirect.searchParams.set('state', url.searchParams.get('state')!);
        res.statusCode = 302;
        res.setHeader('location', redirect.href);
        return res.end();
      }
      if (url.pathname === '/token' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const params = new URLSearchParams(Buffer.concat(chunks).toString());
        const entry = codes.get(params.get('code') ?? '');
        codes.delete(params.get('code') ?? '');
        if (!entry) {
          res.statusCode = 400;
          return json({ error: 'invalid_grant' });
        }
        const idToken = await new SignJWT({ ...entry.claims, ...(entry.nonce ? { nonce: entry.nonce } : {}) })
          .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
          .setIssuer(issuer)
          .setAudience(clientId)
          .setSubject('mock-sub')
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(privateKey);
        return json({ access_token: 'mock-access-token', token_type: 'bearer', id_token: idToken });
      }
      res.statusCode = 404;
      res.end();
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || !address) throw new Error('mock idp failed to listen');
  issuer = `http://127.0.0.1:${address.port}`;

  return {
    issuer,
    queueClaims(claims) { queued = claims; },
    async authorize(authorizationUrl) {
      const res = await fetch(authorizationUrl, { redirect: 'manual' });
      const location = res.headers.get('location');
      if (res.status !== 302 || !location) throw new Error(`mock authorize failed: ${res.status}`);
      return location;
    },
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
```

- [ ] **Step 5: プロトコル層とルートを実装**

oidc-service.ts に追記:

```ts
import * as oidc from 'openid-client';
import type { Config } from '../config';

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
```

```ts
// apps/server/src/routes/auth-oidc.ts
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { ErrorCode } from '@knowledge-hub/shared';
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
    if (typeof parsed.state !== 'string' || typeof parsed.nonce !== 'string' || typeof parsed.codeVerifier !== 'string') return null;
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
```

types.ts / app.ts / index.ts / helpers.ts は Files 欄のとおり配線（app.ts は deps 型と `c.set('oidcAuth', deps.oidcAuth)` と `.route('/api/auth/oidc', authOidcRoutes)`）。

- [ ] **Step 6: GREEN を確認** — Run: `npx vitest run src/routes/auth-oidc.test.ts` → PASS。その後サーバー全スイート `npx vitest run` → PASS、`pnpm -r typecheck` クリーン

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(server): add oidc login flow with pkce and mock idp tests"
```

---

### Task 4: `GET /api/auth/methods` + SSO ユーザーのパスワード変更拒否

**Files:**
- Modify: `apps/server/src/routes/auth.ts`（`.get('/methods', ...)` を requireAuth なしで追加）
- Modify: `apps/server/src/services/user-service.ts`（`changePassword` 冒頭に oidc 拒否）
- Test: `apps/server/src/routes/auth.test.ts`・`apps/server/src/services/user-service.test.ts`（既存に追記。ファイル名が異なる場合は既存の該当テストファイルに追記）

**Interfaces:**
- Consumes: Task 3 の `c.get('oidcAuth')`
- Produces: `GET /api/auth/methods` → `{ password: boolean, oidc: boolean }`（認証不要）。Task 5 の web が消費

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('GET /api/auth/methods は認証なしで有効な認証手段を返す', async () => {
  const res = await ctx.app.request('/api/auth/methods');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ password: true, oidc: false }); // デフォルト testConfig
});
it('oidcAuth があると oidc: true になる', async () => { /* createTestApp({ oidcAuth: ダミー実装 }) */ });
it('パスワード認証無効 + OIDC 有効なら { password: false, oidc: true }', async () => {
  /* createTestApp({ config: { passwordAuthEnabled: false }, oidcAuth: ダミー実装 }) */
  /* 注: password:false かつ oidc:false の 4 通り目は config の fail-fast により構築不能（テスト不要） */
});
it('changePassword は oidc ユーザーを 403 で拒否する', async () => {
  /* authProvider='oidc' の seed → expect(changePassword(db, id, 'x', 'y'.repeat(12))).rejects.toMatchObject({ code: 'FORBIDDEN' }) */
});
it('GET /api/auth/me は authProvider を含む', async () => { /* ログイン済みリクエスト → body.authProvider === 'password' */ });
```

- [ ] **Step 2: RED を確認** — Run: 該当テストファイルを `npx vitest run` → FAIL（404 / FORBIDDEN にならない）

- [ ] **Step 3: 実装**

auth.ts（`.post('/login', ...)` の前に追加）:

```ts
.get('/methods', (c) =>
  c.json({ password: c.get('config').passwordAuthEnabled, oidc: c.get('oidcAuth') !== null }),
)
```

user-service.ts の `changePassword` 冒頭（findFirst 直後）:

```ts
if (user?.authProvider === 'oidc') {
  throw new AppError('FORBIDDEN', 'SSO アカウントはパスワードを変更できません', 403);
}
```

- [ ] **Step 4: GREEN を確認** — 該当テスト PASS + サーバー全スイート PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): add auth methods endpoint and reject password change for sso users"
```

---

### Task 5: Web — SSO ボタン・エラー表示・パスワード UI の出し分け

**Files:**
- Modify: `apps/web/src/pages/LoginPage.tsx`
- Modify: `apps/web/src/pages/SettingsPage.tsx`（パスワード変更カードを `me.authProvider === 'oidc'` で非表示）
- Test: `apps/web/src/pages/LoginPage.test.tsx`・`apps/web/src/pages/SettingsPage.test.tsx`（既存に追記。既存のモック方式を踏襲）

**Interfaces:**
- Consumes: `GET /api/auth/methods`（hono RPC: `api.api.auth.methods.$get()`）、`SessionUser.authProvider`（Task 2）

- [ ] **Step 1: 失敗するテストを書く**（既存テストのモック方式を必ず先に読む）

```tsx
it('oidc 有効なら「SSO でログイン」リンクが /api/auth/oidc/login を指す', async () => {
  /* methods → { password: true, oidc: true } をモック → getByRole('link', { name: 'SSO でログイン' }) の href を assert */
});
it('password: false ならメール/パスワードフォームを描画しない', async () => { /* queryByLabelText('メールアドレス') が null */ });
it('?error=oidc_domain でドメイン不許可メッセージを表示する', async () => {
  /* /login?error=oidc_domain で描画 → 「このメールドメインは許可されていません」 */
});
it('SettingsPage は oidc ユーザーにパスワード変更カードを出さない', async () => { /* me.authProvider='oidc' モック */ });
```

- [ ] **Step 2: RED を確認** — Run: `cd apps/web && npx vitest run src/pages/LoginPage.test.tsx src/pages/SettingsPage.test.tsx` → FAIL

- [ ] **Step 3: 実装**

LoginPage: `useQuery({ queryKey: ['auth-methods'], queryFn: ... })` で methods を取得（取得完了までフォーム描画を保留、失敗時は `{ password: true, oidc: false }` にフォールバック）。`useSearchParams()` で `error` を読み、次のマップで表示（既存の `role="alert"` 枠を再利用。手動ログイン失敗の `setError` と共存させるため、query 由来メッセージは初期 state に流し込む）:

```ts
const OIDC_ERRORS: Record<string, string> = {
  oidc_failed: 'SSO ログインに失敗しました。もう一度お試しください',
  oidc_domain: 'このメールドメインは許可されていません',
  oidc_inactive: 'このアカウントは無効化されています',
  oidc_email: 'メールアドレスを確認できませんでした',
  oidc_unavailable: 'SSO プロバイダに接続できません。しばらくしてから再試行してください',
};
```

SSO ボタンは SPA 遷移ではなくフルページ遷移（IdP へ 302 されるため）:

```tsx
{methods.oidc && (
  <Button asChild variant="outline">
    <a href="/api/auth/oidc/login">SSO でログイン</a>
  </Button>
)}
```

`methods.password && methods.oidc` のときは既存フォームの下に区切り（`<div className="text-center text-xs text-muted-foreground">または</div>`）を挟んで併記。`password: false` のときはフォーム・「パスワードをお忘れですか？」リンクごと出さない。

SettingsPage: パスワード変更カード（`<h3>パスワード変更</h3>` を含むセクション）全体を `me?.authProvider !== 'oidc'` 条件で包む。

- [ ] **Step 4: GREEN を確認** — Run: `npx vitest run src/pages/LoginPage.test.tsx src/pages/SettingsPage.test.tsx` → PASS。web 全スイート + `pnpm --filter @knowledge-hub/web build` クリーン

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): add sso login button and oidc-aware auth ui"
```

---

### Task 6: Keycloak 開発用 IdP（compose profile）+ ドキュメント

**Files:**
- Modify: `docker-compose.yml`（service `keycloak`、`profiles: ["idp"]`）
- Create: `docker/keycloak/realm.json`
- Modify: `.env.example`（OIDC 4 変数をコメントアウト + Keycloak dev 値の説明）
- Modify: `README.md`（「開発の始め方」に SSO 手動検証の任意手順を追記）

**Interfaces:**
- Consumes: Task 1 の env 変数名。redirect URI は `http://localhost:5173/api/auth/oidc/callback`（dev は Vite proxy 経由 = APP_URL 基準。スペック §4 のとおり）

- [ ] **Step 1: compose に Keycloak を追加**

```yaml
  # 開発用 IdP（手動 SSO 検証用）。普段は起動しない: docker compose --profile idp up -d
  keycloak:
    image: quay.io/keycloak/keycloak:26.4
    profiles: ["idp"]
    command: start-dev --import-realm
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: admin        # dev 専用
      KC_BOOTSTRAP_ADMIN_PASSWORD: admin        # dev 専用
    ports:
      - "8080:8080"
    volumes:
      - ./docker/keycloak/realm.json:/opt/keycloak/data/import/realm.json:ro
```

- [ ] **Step 2: realm.json を作成**（dev 専用ダミー資格情報のみ。本番値は一切含めない）

```json
{
  "realm": "knowledge-hub",
  "enabled": true,
  "clients": [
    {
      "clientId": "knowledge-hub",
      "secret": "dev-keycloak-secret",
      "protocol": "openid-connect",
      "publicClient": false,
      "standardFlowEnabled": true,
      "directAccessGrantsEnabled": false,
      "redirectUris": ["http://localhost:5173/api/auth/oidc/callback"]
    }
  ],
  "users": [
    {
      "username": "sso-taro",
      "email": "sso-taro@example.com",
      "emailVerified": true,
      "enabled": true,
      "firstName": "Taro",
      "lastName": "SSO",
      "credentials": [{ "type": "password", "value": "sso-dev-password" }]
    }
  ]
}
```

- [ ] **Step 3: .env.example / README 追記**

.env.example（S3 節の後）:

```bash
# --- OIDC（SSO）。3 変数すべてを設定したときのみ有効（すべてダミーの dev 値） ---
# Keycloak 開発用 IdP を使う場合: docker compose --profile idp up -d
# OIDC_ISSUER=http://localhost:8080/realms/knowledge-hub
# OIDC_CLIENT_ID=knowledge-hub
# OIDC_CLIENT_SECRET=dev-keycloak-secret
# JIT を許可するメールドメイン（カンマ区切り、未設定 = 全許可）
# OIDC_ALLOWED_EMAIL_DOMAINS=example.com
```

README「開発の始め方」の末尾に任意手順として: `docker compose --profile idp up -d` → `.env` の OIDC 3 変数を有効化 → サーバー再起動 → ログイン画面の「SSO でログイン」→ Keycloak（sso-taro / sso-dev-password）。進捗ロードマップは触らない（マージ後にコントローラーが更新）。

- [ ] **Step 4: 検証**

Run: `docker compose --profile idp config -q`
Expected: exit 0（YAML 妥当）。realm.json は `node -e "JSON.parse(require('fs').readFileSync('docker/keycloak/realm.json','utf8'))"` で構文確認

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(dev): add keycloak dev idp compose profile and sso docs"
```

---

## 完了条件

- 全タスク後: 最終 whole-branch レビュー → `pnpm run verify` exit 0
- コントローラーによる手動検証（マージ判断前）: `docker compose --profile idp up -d` + `.env` の OIDC 有効化 → ブラウザで SSO ボタン → Keycloak ログイン → JIT 作成 → フィード到達 → SettingsPage にパスワード変更カードが出ない → 管理画面ユーザー一覧に oidc 表示
