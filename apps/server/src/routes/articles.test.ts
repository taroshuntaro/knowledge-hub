import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestCategory, createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';

describe('article routes', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  async function login(email: string, role: 'member' | 'admin' = 'member'): Promise<string> {
    await createTestUser(ctx.db, { email, role });
    const res = await ctx.app.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
      headers: { 'content-type': 'application/json' },
    });
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  }
  const j = (cookie: string, body: unknown, method = 'POST') => ({
    method, body: JSON.stringify(body), headers: { 'content-type': 'application/json', cookie },
  });

  it('作成→公開→フィード表示までを通す', async () => {
    const cookie = await login('a@example.com');
    const cat = await createTestCategory(ctx.db);
    const created = await ctx.app.request('/api/articles', j(cookie, {
      title: 'AWS 入門', bodyMd: '本文', categoryId: cat.id, tags: ['AWS'],
    }));
    expect(created.status).toBe(200);
    const article = await created.json();
    const pub = await ctx.app.request(`/api/articles/${article.id}/publish`, j(cookie, {}));
    expect(pub.status).toBe(200);
    const feed = await ctx.app.request('/api/articles', { headers: { cookie } });
    expect((await feed.json()).items.map((i: { title: string }) => i.title)).toContain('AWS 入門');
  });

  it('他人の下書きは 404', async () => {
    const author = await login('author@example.com');
    const cat = await createTestCategory(ctx.db);
    const created = await (await ctx.app.request('/api/articles', j(author, {
      title: '秘密', bodyMd: '', categoryId: cat.id, tags: [],
    }))).json();
    const other = await login('other@example.com');
    const res = await ctx.app.request(`/api/articles/${created.id}`, { headers: { cookie: other } });
    expect(res.status).toBe(404);
  });
});
