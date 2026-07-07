import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOidcAuth } from '../services/oidc-service';
import { createTestUser } from '../test/factories';
import { createTestApp, resetDb, testConfig } from '../test/helpers';
import { startMockIdp, type MockIdp } from '../test/mock-idp';

describe('OIDC login flow', () => {
  let idp: MockIdp;
  let ctx: ReturnType<typeof createTestApp>;

  beforeAll(async () => {
    idp = await startMockIdp('kh-test');
    ctx = createTestApp({
      config: { oidc: { issuer: idp.issuer, clientId: 'kh-test', clientSecret: 'test-secret', allowedEmailDomains: [] } },
      oidcAuth: createOidcAuth(
        { issuer: idp.issuer, clientId: 'kh-test', clientSecret: 'test-secret', allowedEmailDomains: [] },
        { allowInsecure: true },
      ),
    });
  });

  afterAll(async () => {
    await idp.close();
    await ctx.pool.end();
  });

  async function ssoLogin(claims: Record<string, unknown>) {
    const loginRes = await ctx.app.request('/api/auth/oidc/login');
    expect(loginRes.status).toBe(302);
    const cookie = loginRes.headers.get('set-cookie')!;
    idp.queueClaims(claims);
    const cbUrl = await idp.authorize(loginRes.headers.get('location')!);
    return ctx.app.request(`/api/auth/oidc/callback${new URL(cbUrl).search}`, { headers: { cookie } });
  }

  it('フルフロー: JIT 作成 → セッション Cookie → APP_URL へ 302', async () => {
    await resetDb(ctx.db);
    const res = await ssoLogin({ email: 'sso@example.com', email_verified: true, name: 'SSO Taro' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(testConfig().appUrl);
    expect(res.headers.get('set-cookie')).toContain('sid=');

    const rows = await ctx.db.query.users.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: 'sso@example.com', role: 'member', authProvider: 'oidc' });
  });

  it('ドメイン不許可は /login?error=oidc_domain へ 302 しセッションを作らない', async () => {
    await resetDb(ctx.db);
    const restrictedCtx = createTestApp({
      config: { oidc: { issuer: idp.issuer, clientId: 'kh-test', clientSecret: 'test-secret', allowedEmailDomains: ['corp.example.com'] } },
      oidcAuth: createOidcAuth(
        { issuer: idp.issuer, clientId: 'kh-test', clientSecret: 'test-secret', allowedEmailDomains: ['corp.example.com'] },
        { allowInsecure: true },
      ),
    });
    try {
      const loginRes = await restrictedCtx.app.request('/api/auth/oidc/login');
      const cookie = loginRes.headers.get('set-cookie')!;
      idp.queueClaims({ email: 'sso@other.com', email_verified: true });
      const cbUrl = await idp.authorize(loginRes.headers.get('location')!);
      const res = await restrictedCtx.app.request(`/api/auth/oidc/callback${new URL(cbUrl).search}`, {
        headers: { cookie },
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`${testConfig().appUrl}/login?error=oidc_domain`);
      expect(res.headers.get('set-cookie') ?? '').not.toContain('sid=');
      const rows = await restrictedCtx.db.query.users.findMany();
      expect(rows).toHaveLength(0);
    } finally {
      await restrictedCtx.pool.end();
    }
  });

  it('無効化ユーザーは oidc_inactive、email_verified=false は oidc_email', async () => {
    await resetDb(ctx.db);
    const inactive = await createTestUser(ctx.db, {
      authProvider: 'oidc',
      passwordHash: null,
      isActive: false,
      email: 'inactive@example.com',
    });
    const inactiveRes = await ssoLogin({ email: inactive.email, email_verified: true });
    expect(inactiveRes.status).toBe(302);
    expect(inactiveRes.headers.get('location')).toBe(`${testConfig().appUrl}/login?error=oidc_inactive`);
    expect(inactiveRes.headers.get('set-cookie') ?? '').not.toContain('sid=');

    const unverifiedRes = await ssoLogin({ email: 'unverified@example.com', email_verified: false });
    expect(unverifiedRes.status).toBe(302);
    expect(unverifiedRes.headers.get('location')).toBe(`${testConfig().appUrl}/login?error=oidc_email`);
    expect(unverifiedRes.headers.get('set-cookie') ?? '').not.toContain('sid=');
  });

  it('oidc_txn Cookie なしは oidc_failed', async () => {
    const res = await ctx.app.request('/api/auth/oidc/callback?code=abc&state=xyz');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${testConfig().appUrl}/login?error=oidc_failed`);
  });

  it('state 改ざんは oidc_failed でセッションなし', async () => {
    await resetDb(ctx.db);
    const loginRes = await ctx.app.request('/api/auth/oidc/login');
    const cookie = loginRes.headers.get('set-cookie')!;
    idp.queueClaims({ email: 'tampered@example.com', email_verified: true });
    const cbUrl = await idp.authorize(loginRes.headers.get('location')!);
    const tamperedUrl = new URL(cbUrl);
    tamperedUrl.searchParams.set('state', 'tampered-state');
    const res = await ctx.app.request(`/api/auth/oidc/callback${tamperedUrl.search}`, { headers: { cookie } });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${testConfig().appUrl}/login?error=oidc_failed`);
    expect(res.headers.get('set-cookie') ?? '').not.toContain('sid=');
  });

  it('IdP 到達不能なら login が oidc_unavailable へ 302（500 にしない）', async () => {
    const dead = createOidcAuth(
      { issuer: 'http://127.0.0.1:1', clientId: 'x', clientSecret: 'y', allowedEmailDomains: [] },
      { allowInsecure: true },
    );
    const deadCtx = createTestApp({ config: { oidc: { issuer: 'http://127.0.0.1:1', clientId: 'x', clientSecret: 'y', allowedEmailDomains: [] } }, oidcAuth: dead });
    try {
      const res = await deadCtx.app.request('/api/auth/oidc/login');
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`${testConfig().appUrl}/login?error=oidc_unavailable`);
    } finally {
      await deadCtx.pool.end();
    }
  });

  it('OIDC 未設定なら login は 404', async () => {
    const noOidcCtx = createTestApp();
    try {
      const res = await noOidcCtx.app.request('/api/auth/oidc/login');
      expect(res.status).toBe(404);
    } finally {
      await noOidcCtx.pool.end();
    }
  });
});
