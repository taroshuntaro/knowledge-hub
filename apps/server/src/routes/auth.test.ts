import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { OidcAuth } from '../services/oidc-service';
import { createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { loginLimiter } from './auth';

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

  it('招待受諾エンドポイントでユーザー登録できる', async () => {
    const { createInvitation } = await import('../services/invitation-service');
    const { testConfig } = await import('../test/helpers');
    ctx.mailer.sent.length = 0;
    await createInvitation(ctx.db, ctx.mailer, testConfig(), 'new@example.com');
    const token = ctx.mailer.sent[0].text.match(/\/invite\/([A-Za-z0-9_-]+)/)![1];
    const res = await ctx.app.request(`/api/auth/invitations/${token}/accept`, json({
      displayName: '新人',
      password: 'long-enough-password',
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).email).toBe('new@example.com');
    expect(res.headers.get('set-cookie')).toContain('sid=');
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
});
