import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';

describe('user routes', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  async function loginCookie(email: string): Promise<string> {
    await createTestUser(ctx.db, { email });
    const res = await ctx.app.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
      headers: { 'content-type': 'application/json' },
    });
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  }

  it('PATCH /api/users/me でプロフィール更新できる', async () => {
    const cookie = await loginCookie('a@example.com');
    const res = await ctx.app.request('/api/users/me', {
      method: 'PATCH',
      body: JSON.stringify({ displayName: '花子', bio: 'SRE' }),
      headers: { 'content-type': 'application/json', cookie },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).displayName).toBe('花子');
  });

  it('パスワード変更後、旧 Cookie は無効で新 Cookie が発行される', async () => {
    const cookie = await loginCookie('a@example.com');
    const res = await ctx.app.request('/api/users/me/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: TEST_PASSWORD, newPassword: 'new-password-long' }),
      headers: { 'content-type': 'application/json', cookie },
    });
    expect(res.status).toBe(204);
    const newCookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
    expect((await ctx.app.request('/api/auth/me', { headers: { cookie } })).status).toBe(401);
    expect((await ctx.app.request('/api/auth/me', { headers: { cookie: newCookie } })).status).toBe(200);
  });
});
