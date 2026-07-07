import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestArticle, createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';

describe('category routes', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  async function login(email: string, role: 'member' | 'admin'): Promise<string> {
    await createTestUser(ctx.db, { email, role });
    const res = await ctx.app.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
      headers: { 'content-type': 'application/json' },
    });
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  }

  it('member は作成不可（403）、admin は作成可', async () => {
    const member = await login('m@example.com', 'member');
    const admin = await login('a@example.com', 'admin');
    expect(
      (await ctx.app.request('/api/categories', {
        method: 'POST', body: JSON.stringify({ name: 'テック' }),
        headers: { 'content-type': 'application/json', cookie: member },
      })).status,
    ).toBe(403);
    const res = await ctx.app.request('/api/categories', {
      method: 'POST', body: JSON.stringify({ name: 'テック' }),
      headers: { 'content-type': 'application/json', cookie: admin },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe('テック');
  });

  it('ツリーを取得できる', async () => {
    const admin = await login('a@example.com', 'admin');
    await ctx.app.request('/api/categories', {
      method: 'POST', body: JSON.stringify({ name: 'テック' }),
      headers: { 'content-type': 'application/json', cookie: admin },
    });
    const res = await ctx.app.request('/api/categories', { headers: { cookie: admin } });
    expect(res.status).toBe(200);
    expect((await res.json()).length).toBe(1);
  });

  it('カテゴリの記事一覧エンドポイントが Page を返す', async () => {
    const admin = await login('a@example.com', 'admin');
    const created = await (await ctx.app.request('/api/categories', {
      method: 'POST', body: JSON.stringify({ name: 'テック' }),
      headers: { 'content-type': 'application/json', cookie: admin },
    })).json();
    const res = await ctx.app.request(`/api/categories/${created.id}/articles`, { headers: { cookie: admin } });
    expect(res.status).toBe(200);
    const page = await res.json();
    expect(page).toHaveProperty('items');
    expect(page).toHaveProperty('nextCursor');
  });

  it('DELETE /api/categories/:id は実在しない reassignToId で 400 を返す', async () => {
    const admin = await login('a@example.com', 'admin');
    const created = await (await ctx.app.request('/api/categories', {
      method: 'POST', body: JSON.stringify({ name: 'テック' }),
      headers: { 'content-type': 'application/json', cookie: admin },
    })).json();
    await createTestArticle(ctx.db, { categoryId: created.id });
    const res = await ctx.app.request(`/api/categories/${created.id}`, {
      method: 'DELETE', body: JSON.stringify({ reassignToId: randomUUID() }),
      headers: { 'content-type': 'application/json', cookie: admin },
    });
    expect(res.status).toBe(400);
  });

  it('DELETE /api/categories/:id は reassignToId = 自分自身で 400 を返す', async () => {
    const admin = await login('a@example.com', 'admin');
    const created = await (await ctx.app.request('/api/categories', {
      method: 'POST', body: JSON.stringify({ name: 'テック' }),
      headers: { 'content-type': 'application/json', cookie: admin },
    })).json();
    await createTestArticle(ctx.db, { categoryId: created.id });
    const res = await ctx.app.request(`/api/categories/${created.id}`, {
      method: 'DELETE', body: JSON.stringify({ reassignToId: created.id }),
      headers: { 'content-type': 'application/json', cookie: admin },
    });
    expect(res.status).toBe(400);
  });

  it('PATCH /api/categories/:id は空ボディを 400 で拒否する（500 にしない）', async () => {
    const admin = await login('a@example.com', 'admin');
    const created = await (await ctx.app.request('/api/categories', {
      method: 'POST', body: JSON.stringify({ name: 'テック' }),
      headers: { 'content-type': 'application/json', cookie: admin },
    })).json();
    const res = await ctx.app.request(`/api/categories/${created.id}`, {
      method: 'PATCH', body: JSON.stringify({}),
      headers: { 'content-type': 'application/json', cookie: admin },
    });
    expect(res.status).toBe(400);
  });

  it('GET /api/categories/:id/articles は malformed UUID で 404 を返す', async () => {
    const admin = await login('a@example.com', 'admin');
    const res = await ctx.app.request('/api/categories/not-a-uuid/articles', { headers: { cookie: admin } });
    expect(res.status).toBe(404);
  });
});
