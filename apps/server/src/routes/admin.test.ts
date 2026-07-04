import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';

describe('admin routes', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  async function login(email: string, role: 'member' | 'admin' = 'admin'): Promise<string> {
    await createTestUser(ctx.db, { email, role });
    const res = await ctx.app.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
      headers: { 'content-type': 'application/json' },
    });
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  }

  it('member は 403', async () => {
    const cookie = await login('m@example.com', 'member');
    expect((await ctx.app.request('/api/admin/users', { headers: { cookie } })).status).toBe(403);
  });

  it('admin はユーザー一覧を取得できる', async () => {
    const cookie = await login('a@example.com');
    await createTestUser(ctx.db, { email: 'b@example.com' });
    const res = await ctx.app.request('/api/admin/users', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect((await res.json()).length).toBe(2);
  });

  it('admin は招待を送れる', async () => {
    const cookie = await login('a@example.com');
    const res = await ctx.app.request('/api/admin/users/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: 'new@example.com' }),
      headers: { 'content-type': 'application/json', cookie },
    });
    expect(res.status).toBe(204);
    expect(ctx.mailer.sent.at(-1)?.to).toBe('new@example.com');
  });

  it('無効化するとそのユーザーのセッションが切れる', async () => {
    const adminCookie = await login('a@example.com');
    const targetCookie = await login('b@example.com', 'member');
    const target = (await (await ctx.app.request('/api/admin/users', { headers: { cookie: adminCookie } })).json())
      .find((u: { email: string }) => u.email === 'b@example.com');
    const res = await ctx.app.request(`/api/admin/users/${target.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: false }),
      headers: { 'content-type': 'application/json', cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    expect((await ctx.app.request('/api/auth/me', { headers: { cookie: targetCookie } })).status).toBe(401);
  });

  it('最後の admin の降格は LAST_ADMIN', async () => {
    const cookie = await login('a@example.com');
    const me = await (await ctx.app.request('/api/auth/me', { headers: { cookie } })).json();
    const res = await ctx.app.request(`/api/admin/users/${me.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'member' }),
      headers: { 'content-type': 'application/json', cookie },
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('LAST_ADMIN');
  });

  it('admin が 2 人いれば降格できる', async () => {
    const cookie = await login('a@example.com');
    const other = await createTestUser(ctx.db, { email: 'a2@example.com', role: 'admin' });
    const res = await ctx.app.request(`/api/admin/users/${other.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'member' }),
      headers: { 'content-type': 'application/json', cookie },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe('member');
  });
});
