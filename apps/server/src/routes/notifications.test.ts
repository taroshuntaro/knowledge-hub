import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestCategory, createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';

describe('notification routes', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  async function login(email: string): Promise<string> {
    await createTestUser(ctx.db, { email });
    const res = await ctx.app.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
      headers: { 'content-type': 'application/json' },
    });
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  }
  const j = (cookie: string, body: unknown = {}, method = 'POST') => ({
    method, body: JSON.stringify(body), headers: { 'content-type': 'application/json', cookie },
  });

  // author が記事を公開し、actor がコメント → author に通知が 1 件できる状態を作る
  async function seedNotification() {
    const authorCookie = await login('author@example.com');
    const cat = await createTestCategory(ctx.db);
    const created = await (await ctx.app.request('/api/articles', j(authorCookie, {
      title: '記事', bodyMd: '本文', categoryId: cat.id, tags: [],
    }))).json();
    await ctx.app.request(`/api/articles/${created.id}/publish`, j(authorCookie));
    const actorCookie = await login('actor@example.com');
    await ctx.app.request(`/api/articles/${created.id}/comments`, j(actorCookie, { bodyMd: 'こんにちは' }));
    return { authorCookie, actorCookie, articleId: created.id as string };
  }

  it('未認証は全エンドポイントで 401', async () => {
    for (const [path, method] of [
      ['/api/notifications', 'GET'],
      ['/api/notifications/unread-count', 'GET'],
      ['/api/notifications/read-all', 'POST'],
      ['/api/users', 'GET'],
    ] as const) {
      const res = await ctx.app.request(path, { method });
      expect(res.status, path).toBe(401);
    }
  });

  it('一覧と未読数が自分宛のものだけを返す', async () => {
    const { authorCookie, actorCookie } = await seedNotification();
    const mine = await (await ctx.app.request('/api/notifications', { headers: { cookie: authorCookie } })).json();
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0].type).toBe('comment');
    expect(mine.items[0].actorName).toBeTruthy();
    expect(mine.items[0].articleTitle).toBe('記事');
    const count = await (await ctx.app.request('/api/notifications/unread-count', { headers: { cookie: authorCookie } })).json();
    expect(count.count).toBe(1);
    const others = await (await ctx.app.request('/api/notifications', { headers: { cookie: actorCookie } })).json();
    expect(others.items).toHaveLength(0);
  });

  it('POST /:id/read で既読になり、他人の通知 id でも 204（no-op）', async () => {
    const { authorCookie, actorCookie } = await seedNotification();
    const mine = await (await ctx.app.request('/api/notifications', { headers: { cookie: authorCookie } })).json();
    const id = mine.items[0].id as string;
    // 他人（actor）が author の通知を既読化しようとしても no-op
    const foreign = await ctx.app.request(`/api/notifications/${id}/read`, j(actorCookie));
    expect(foreign.status).toBe(204);
    let count = await (await ctx.app.request('/api/notifications/unread-count', { headers: { cookie: authorCookie } })).json();
    expect(count.count).toBe(1);
    // 本人による既読化
    const own = await ctx.app.request(`/api/notifications/${id}/read`, j(authorCookie));
    expect(own.status).toBe(204);
    count = await (await ctx.app.request('/api/notifications/unread-count', { headers: { cookie: authorCookie } })).json();
    expect(count.count).toBe(0);
  });

  it('不正な UUID の read は 404、read-all は 204 で全既読', async () => {
    const { authorCookie } = await seedNotification();
    const bad = await ctx.app.request('/api/notifications/not-a-uuid/read', j(authorCookie));
    expect(bad.status).toBe(404);
    const res = await ctx.app.request('/api/notifications/read-all', j(authorCookie));
    expect(res.status).toBe(204);
    const count = await (await ctx.app.request('/api/notifications/unread-count', { headers: { cookie: authorCookie } })).json();
    expect(count.count).toBe(0);
  });

  it('GET /api/users は active ユーザーの id/displayName/avatarUrl のみ返し、email を含まない', async () => {
    const cookie = await login('viewer@example.com');
    await createTestUser(ctx.db, { displayName: '休眠', isActive: false });
    const res = await ctx.app.request('/api/users', { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.some((u: { displayName: string }) => u.displayName === '休眠')).toBe(false);
    for (const u of body) {
      expect(Object.keys(u).sort()).toEqual(['avatarUrl', 'displayName', 'id']);
    }
  });
});
