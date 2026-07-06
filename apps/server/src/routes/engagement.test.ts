import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestCategory, createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';

describe('engagement routes', () => {
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

  async function publishedArticle(cookie: string) {
    const cat = await createTestCategory(ctx.db);
    const created = await (await ctx.app.request('/api/articles', j(cookie, {
      title: '記事', bodyMd: '本文', categoryId: cat.id, tags: [],
    }))).json();
    const pub = await ctx.app.request(`/api/articles/${created.id}/publish`, j(cookie, {}));
    expect(pub.status).toBe(200);
    return created.id as string;
  }

  it('未認証で engagement 系エンドポイントは 401', async () => {
    const author = await login('author@example.com');
    const articleId = await publishedArticle(author);
    const res = await ctx.app.request(`/api/articles/${articleId}/engagement`);
    expect(res.status).toBe(401);
  });

  it('リアクション POST が engagement に反映される', async () => {
    const author = await login('author2@example.com');
    const articleId = await publishedArticle(author);
    const user = await login('user2@example.com');
    const res = await ctx.app.request(`/api/articles/${articleId}/reactions`, j(user, { emoji: '👍' }));
    expect([200, 201, 204]).toContain(res.status);
    const engagement = await (
      await ctx.app.request(`/api/articles/${articleId}/engagement`, { headers: { cookie: user } })
    ).json();
    expect(engagement.reactions['👍']).toBe(1);
    expect(engagement.myReactions).toContain('👍');
  });

  it('プリセット外の絵文字での DELETE は 400', async () => {
    const author = await login('author3@example.com');
    const articleId = await publishedArticle(author);
    const user = await login('user3@example.com');
    const res = await ctx.app.request(
      `/api/articles/${articleId}/reactions/${encodeURIComponent('💩')}`,
      { method: 'DELETE', headers: { cookie: user } },
    );
    expect(res.status).toBe(400);
  });

  it('bookmark POST 後、GET /me/bookmarks に出る', async () => {
    const author = await login('author4@example.com');
    const articleId = await publishedArticle(author);
    const user = await login('user4@example.com');
    const post = await ctx.app.request(`/api/articles/${articleId}/bookmark`, j(user, {}));
    expect(post.status).toBe(204);
    const list = await (await ctx.app.request('/api/me/bookmarks', { headers: { cookie: user } })).json();
    expect(list.items.map((a: { id: string }) => a.id)).toContain(articleId);
    expect(list).toHaveProperty('nextCursor');
  });

  it('GET /articles/:id/engagement の形', async () => {
    const author = await login('author5@example.com');
    const articleId = await publishedArticle(author);
    const user = await login('user5@example.com');
    const res = await ctx.app.request(`/api/articles/${articleId}/engagement`, { headers: { cookie: user } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('reactions');
    expect(body).toHaveProperty('myReactions');
    expect(body).toHaveProperty('bookmarked');
    expect(body).toHaveProperty('commentCount');
  });
});
