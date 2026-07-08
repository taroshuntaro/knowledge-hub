import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestArticle, createTestUser, TEST_PASSWORD } from '../test/factories';
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

  it('GET /api/users/:id は不正な UUID 形式で 404（500 にならない）', async () => {
    const cookie = await loginCookie('viewer@example.com');
    const res = await ctx.app.request('/api/users/not-a-uuid', { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it('GET /api/users/:id で公開プロフィールが取得できる', async () => {
    const cookie = await loginCookie('viewer@example.com');
    const author = await createTestUser(ctx.db, { displayName: '公開太郎' });
    const res = await ctx.app.request(`/api/users/${author.id}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: author.id, displayName: '公開太郎' });
    expect(body).not.toHaveProperty('email');
  });

  it('GET /api/users/:id/articles は本人の下書きを含まない', async () => {
    const cookie = await loginCookie('viewer2@example.com');
    const author = await createTestUser(ctx.db);
    await createTestArticle(ctx.db, { authorId: author.id, title: '公開記事', status: 'published' });
    await createTestArticle(ctx.db, { authorId: author.id, title: '下書き記事', status: 'draft' });
    const res = await ctx.app.request(`/api/users/${author.id}/articles?limit=20`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const titles = body.items.map((a: { title: string }) => a.title);
    expect(titles).toContain('公開記事');
    expect(titles).not.toContain('下書き記事');
  });

  it('不正な UUID 形式の :id は 404（500 にならない）', async () => {
    const cookie = await loginCookie('viewer3@example.com');
    const res1 = await ctx.app.request('/api/users/abc', { headers: { cookie } });
    expect(res1.status).toBe(404);
    const res2 = await ctx.app.request('/api/users/abc/articles?limit=20', { headers: { cookie } });
    expect(res2.status).toBe(404);
  });
});
