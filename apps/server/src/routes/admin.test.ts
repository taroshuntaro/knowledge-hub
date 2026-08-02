import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { loginLimiter } from './auth';

describe('admin routes', () => {
  const ctx = createTestApp();
  beforeEach(async () => {
    await resetDb(ctx.db);
    loginLimiter.reset();
  });
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
    const list = await res.json();
    expect(list.length).toBe(2);
    expect(list[0]).toHaveProperty('avatarUrl');
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

  it('PATCH /api/admin/users/:id は malformed UUID で 404 を返す', async () => {
    const cookie = await login('a@example.com');
    const res = await ctx.app.request('/api/admin/users/not-a-uuid', {
      method: 'PATCH',
      body: JSON.stringify({ isActive: false }),
      headers: { 'content-type': 'application/json', cookie },
    });
    expect(res.status).toBe(404);
  });

  describe('registration-code', () => {
    it('member は 403', async () => {
      const cookie = await login('m@example.com', 'member');
      expect(
        (await ctx.app.request('/api/admin/registration-code', { headers: { cookie } })).status,
      ).toBe(403);
    });

    it('POST は 201 で平文 code を1回だけ返す。以降 GET はメタのみ', async () => {
      const cookie = await login('a@example.com');
      const postRes = await ctx.app.request('/api/admin/registration-code', {
        method: 'POST',
        body: JSON.stringify({ expiresInDays: 30 }),
        headers: { 'content-type': 'application/json', cookie },
      });
      expect(postRes.status).toBe(201);
      const created = await postRes.json();
      expect(typeof created.code).toBe('string');
      expect(created.expiresAt).toBeDefined();

      const getRes = await ctx.app.request('/api/admin/registration-code', { headers: { cookie } });
      expect(getRes.status).toBe(200);
      const meta = await getRes.json();
      expect(meta).not.toHaveProperty('code');
      expect(meta.createdAt).toBeDefined();
      expect(meta.expiresAt).toBeDefined();
    });

    it('DELETE は現在のコードを無効化する', async () => {
      const cookie = await login('a@example.com');
      await ctx.app.request('/api/admin/registration-code', {
        method: 'POST',
        body: JSON.stringify({ expiresInDays: 7 }),
        headers: { 'content-type': 'application/json', cookie },
      });
      const delRes = await ctx.app.request('/api/admin/registration-code', {
        method: 'DELETE',
        headers: { cookie },
      });
      expect(delRes.status).toBe(204);
      const meta = await (
        await ctx.app.request('/api/admin/registration-code', { headers: { cookie } })
      ).json();
      expect(meta).toBeNull();
    });
  });

  describe('users provisioning', () => {
    it('POST /users は 201 で pending の AdminUserView を返す', async () => {
      const cookie = await login('a@example.com');
      const res = await ctx.app.request('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ email: 'new@example.com', displayName: '新井' }),
        headers: { 'content-type': 'application/json', cookie },
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toMatchObject({ email: 'new@example.com', authProvider: 'pending', role: 'member' });
    });

    it('POST /users/deactivate は指定ユーザーを無効化する', async () => {
      const cookie = await login('a@example.com');
      const target = await createTestUser(ctx.db, { email: 'b@example.com' });
      const res = await ctx.app.request('/api/admin/users/deactivate', {
        method: 'POST',
        body: JSON.stringify({ userIds: [target.id] }),
        headers: { 'content-type': 'application/json', cookie },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ deactivated: 1 });
    });

    it('POST /users/registrations/import は CSV エラーを CSV_IMPORT_FAILED で返す', async () => {
      const cookie = await login('a@example.com');
      const csv = 'email,display_name,department,position,hire_year\n,名無し,,,\n';
      const fd = new FormData();
      fd.append('file', new File([csv], 'file.csv', { type: 'text/csv' }));
      const res = await ctx.app.request('/api/admin/users/registrations/import', {
        method: 'POST',
        body: fd,
        headers: { cookie },
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('CSV_IMPORT_FAILED');
      expect(Array.isArray(body.details)).toBe(true);
      expect(body.details.length).toBeGreaterThan(0);
    });

    it('POST /users/deactivate/import は CSV エラーを CSV_IMPORT_FAILED で返す', async () => {
      const cookie = await login('a@example.com');
      const csv = 'email\nnotfound@example.com\n';
      const fd = new FormData();
      fd.append('file', new File([csv], 'file.csv', { type: 'text/csv' }));
      const res = await ctx.app.request('/api/admin/users/deactivate/import', {
        method: 'POST',
        body: fd,
        headers: { cookie },
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('CSV_IMPORT_FAILED');
      expect(Array.isArray(body.details)).toBe(true);
      expect(body.details.length).toBeGreaterThan(0);
    });

    it('DELETE /users/:id は pending のみ削除できる（クレーム済みは CONFLICT）', async () => {
      const cookie = await login('a@example.com');
      const pendingRes = await ctx.app.request('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ email: 'p@example.com', displayName: 'P' }),
        headers: { 'content-type': 'application/json', cookie },
      });
      const pending = await pendingRes.json();
      const delRes = await ctx.app.request(`/api/admin/users/${pending.id}`, {
        method: 'DELETE',
        headers: { cookie },
      });
      expect(delRes.status).toBe(204);

      const claimed = await createTestUser(ctx.db, { email: 'c@example.com' });
      const delClaimedRes = await ctx.app.request(`/api/admin/users/${claimed.id}`, {
        method: 'DELETE',
        headers: { cookie },
      });
      expect(delClaimedRes.status).toBe(409);
      expect((await delClaimedRes.json()).code).toBe('CONFLICT');
    });

    it('POST /users/:id/unclaim はクレーム済みのみ pending に戻せる', async () => {
      const cookie = await login('a@example.com');
      const claimed = await createTestUser(ctx.db, { email: 'c@example.com' });
      const res = await ctx.app.request(`/api/admin/users/${claimed.id}/unclaim`, {
        method: 'POST',
        headers: { cookie },
      });
      expect(res.status).toBe(200);
      expect((await res.json()).authProvider).toBe('pending');

      const pendingRes = await ctx.app.request('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ email: 'p2@example.com', displayName: 'P2' }),
        headers: { 'content-type': 'application/json', cookie },
      });
      const pending = await pendingRes.json();
      const failRes = await ctx.app.request(`/api/admin/users/${pending.id}/unclaim`, {
        method: 'POST',
        headers: { cookie },
      });
      expect(failRes.status).toBe(409);
    });
  });
});
