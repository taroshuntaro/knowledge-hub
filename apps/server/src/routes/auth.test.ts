import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { OidcAuth } from '../services/oidc-service';
import { issueRegistrationCode } from '../services/registration-code-service';
import { createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { claimLimiter, loginLimiter } from './auth';

const dummyOidcAuth: OidcAuth = {
  authorizationUrl: async () => ({ url: 'http://idp.example.com/authorize', txn: { state: 's', nonce: 'n', codeVerifier: 'c' } }),
  exchangeCode: async () => ({ email: 'sso@example.com', emailVerified: true }),
};

function json(body: unknown): RequestInit {
  return {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  };
}

describe('auth routes', () => {
  const ctx = createTestApp();

  beforeEach(async () => {
    await resetDb(ctx.db);
    loginLimiter.reset();
    claimLimiter.reset();
  });

  afterAll(() => ctx.pool.end());

  it('login 成功で SessionUser と Set-Cookie を返す', async () => {
    await createTestUser(ctx.db, { email: 'a@example.com', displayName: '太郎' });
    const res = await ctx.app.request(
      '/api/auth/login',
      json({ email: 'a@example.com', password: TEST_PASSWORD }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.displayName).toBe('太郎');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('sid=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('誤った資格情報は 401 INVALID_CREDENTIALS', async () => {
    await createTestUser(ctx.db, { email: 'a@example.com' });
    const res = await ctx.app.request(
      '/api/auth/login',
      json({ email: 'a@example.com', password: 'wrong-password' }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('INVALID_CREDENTIALS');
  });

  it('11 回目のログイン試行は 429', async () => {
    for (let i = 0; i < 10; i++) {
      await ctx.app.request(
        '/api/auth/login',
        json({ email: 'rl@example.com', password: 'wrong-password' }),
      );
    }
    const res = await ctx.app.request(
      '/api/auth/login',
      json({ email: 'rl@example.com', password: 'wrong-password' }),
    );
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe('RATE_LIMITED');
  });

  it('me は Cookie 付きで SessionUser を返し、無しは 401', async () => {
    await createTestUser(ctx.db, { email: 'a@example.com' });
    const login = await ctx.app.request(
      '/api/auth/login',
      json({ email: 'a@example.com', password: TEST_PASSWORD }),
    );
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const me = await ctx.app.request('/api/auth/me', { headers: { cookie } });
    expect(me.status).toBe(200);
    expect((await me.json()).email).toBe('a@example.com');
    expect((await ctx.app.request('/api/auth/me')).status).toBe(401);
  });

  it('logout 後は me が 401', async () => {
    await createTestUser(ctx.db, { email: 'a@example.com' });
    const login = await ctx.app.request(
      '/api/auth/login',
      json({ email: 'a@example.com', password: TEST_PASSWORD }),
    );
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    await ctx.app.request('/api/auth/logout', { method: 'POST', headers: { cookie } });
    expect(
      (await ctx.app.request('/api/auth/me', { headers: { cookie } })).status,
    ).toBe(401);
  });

  it('別オリジンからの POST は 403', async () => {
    const res = await ctx.app.request('/api/auth/login', {
      ...json({ email: 'a@example.com', password: 'x' }),
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example.com',
      },
    });
    expect(res.status).toBe(403);
  });

  it('GET /api/auth/methods は認証なしで有効な認証手段を返す', async () => {
    const res = await ctx.app.request('/api/auth/methods');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ password: true, oidc: false }); // デフォルト testConfig
  });

  it('oidcAuth があると oidc: true になる', async () => {
    const withOidc = createTestApp({ oidcAuth: dummyOidcAuth });
    const res = await withOidc.app.request('/api/auth/methods');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ password: true, oidc: true });
    await withOidc.pool.end();
  });

  it('パスワード認証無効 + OIDC 有効なら { password: false, oidc: true }', async () => {
    const withOidc = createTestApp({
      config: { passwordAuthEnabled: false },
      oidcAuth: dummyOidcAuth,
    });
    const res = await withOidc.app.request('/api/auth/methods');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ password: false, oidc: true });
    await withOidc.pool.end();
  });

  it('パスワード認証無効なら password-reset/request は 403 PASSWORD_AUTH_DISABLED', async () => {
    const withoutPassword = createTestApp({ config: { passwordAuthEnabled: false } });
    const res = await withoutPassword.app.request(
      '/api/auth/password-reset/request',
      json({ email: 'a@example.com' }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('PASSWORD_AUTH_DISABLED');
    await withoutPassword.pool.end();
  });

  it('GET /api/auth/me は authProvider を含む', async () => {
    await createTestUser(ctx.db, { email: 'a@example.com' });
    const login = await ctx.app.request(
      '/api/auth/login',
      json({ email: 'a@example.com', password: TEST_PASSWORD }),
    );
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const me = await ctx.app.request('/api/auth/me', { headers: { cookie } });
    expect((await me.json()).authProvider).toBe('password');
  });

  it('claim は登録コード + pending 行で成功しセッション Cookie を返す', async () => {
    const { code } = await issueRegistrationCode(ctx.db, 30);
    await createTestUser(ctx.db, {
      email: 'new@example.com',
      displayName: '新井',
      authProvider: 'pending',
      passwordHash: null,
    });
    const res = await ctx.app.request(
      '/api/auth/claim',
      json({ email: 'new@example.com', code, password: 'p'.repeat(12) }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ email: 'new@example.com', authProvider: 'password' });
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('sid=');
  });

  it('claim 失敗は CLAIM_INVALID 400', async () => {
    const res = await ctx.app.request(
      '/api/auth/claim',
      json({ email: 'nobody@example.com', code: 'AAAA-AAAA-AAAA-AAAA', password: 'p'.repeat(12) }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('CLAIM_INVALID');
  });

  it('11 回目の claim 試行は 429', async () => {
    for (let i = 0; i < 10; i++) {
      await ctx.app.request(
        '/api/auth/claim',
        json({ email: 'rl@example.com', code: 'AAAA-AAAA-AAAA-AAAA', password: 'p'.repeat(12) }),
      );
    }
    const res = await ctx.app.request(
      '/api/auth/claim',
      json({ email: 'rl@example.com', code: 'AAAA-AAAA-AAAA-AAAA', password: 'p'.repeat(12) }),
    );
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe('RATE_LIMITED');
  });

  it('パスワード認証無効なら claim は 403 PASSWORD_AUTH_DISABLED', async () => {
    const withoutPassword = createTestApp({ config: { passwordAuthEnabled: false } });
    const res = await withoutPassword.app.request(
      '/api/auth/claim',
      json({ email: 'a@example.com', code: 'AAAA-AAAA-AAAA-AAAA', password: 'p'.repeat(12) }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('PASSWORD_AUTH_DISABLED');
    await withoutPassword.pool.end();
  });
});
