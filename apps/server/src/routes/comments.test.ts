import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestCategory, createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';

describe('comment routes', () => {
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

  it('未認証でコメント一覧・作成は 401', async () => {
    const author = await login('author@example.com');
    const articleId = await publishedArticle(author);
    const list = await ctx.app.request(`/api/articles/${articleId}/comments`);
    expect(list.status).toBe(401);
    const post = await ctx.app.request(`/api/articles/${articleId}/comments`, {
      method: 'POST', body: JSON.stringify({ bodyMd: 'hi' }), headers: { 'content-type': 'application/json' },
    });
    expect(post.status).toBe(401);
  });

  it('公開記事へのコメント作成は 200/201 で本文を返す', async () => {
    const author = await login('author2@example.com');
    const articleId = await publishedArticle(author);
    const commenter = await login('commenter@example.com');
    const res = await ctx.app.request(
      `/api/articles/${articleId}/comments`,
      j(commenter, { bodyMd: 'はじめまして' }),
    );
    expect([200, 201]).toContain(res.status);
    const body = await res.json();
    expect(body.bodyMd).toBe('はじめまして');
    expect(body.articleId).toBe(articleId);
  });

  it('下書き記事へのコメント作成は 404', async () => {
    const author = await login('author3@example.com');
    const cat = await createTestCategory(ctx.db);
    const created = await (await ctx.app.request('/api/articles', j(author, {
      title: '下書き', bodyMd: '', categoryId: cat.id, tags: [],
    }))).json();
    const commenter = await login('commenter2@example.com');
    const res = await ctx.app.request(
      `/api/articles/${created.id}/comments`,
      j(commenter, { bodyMd: '下書きへのコメント' }),
    );
    expect(res.status).toBe(404);
  });

  it('他人のコメントを member が DELETE すると 403', async () => {
    const author = await login('author4@example.com');
    const articleId = await publishedArticle(author);
    const commenter = await login('commenter3@example.com');
    const created = await (
      await ctx.app.request(`/api/articles/${articleId}/comments`, j(commenter, { bodyMd: 'コメント' }))
    ).json();
    const other = await login('other@example.com');
    const res = await ctx.app.request(`/api/comments/${created.id}`, j(other, {}, 'DELETE'));
    expect(res.status).toBe(403);
  });

  it('コメント一覧 GET は items/nextCursor の形で返る', async () => {
    const author = await login('author5@example.com');
    const articleId = await publishedArticle(author);
    const commenter = await login('commenter4@example.com');
    await ctx.app.request(`/api/articles/${articleId}/comments`, j(commenter, { bodyMd: '1件目' }));
    const res = await ctx.app.request(`/api/articles/${articleId}/comments`, { headers: { cookie: commenter } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('nextCursor');
    expect(body.items).toHaveLength(1);
    expect(body.items[0].bodyMd).toBe('1件目');
    expect(body.items[0]).toHaveProperty('replies');
  });

  it('不正な UUID の記事 id は 404', async () => {
    const commenter = await login('commenter5@example.com');
    const res = await ctx.app.request('/api/articles/not-a-uuid/comments', { headers: { cookie: commenter } });
    expect(res.status).toBe(404);
  });
});
