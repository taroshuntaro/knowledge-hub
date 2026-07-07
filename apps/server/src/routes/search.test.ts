import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@knowledge-hub/shared';
import { createTestCategory, createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { createArticle, publishArticle } from '../services/article-service';

describe('search routes', () => {
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

  it('未認証は 401', async () => {
    const res = await ctx.app.request('/api/search?q=test');
    expect(res.status).toBe(401);
  });

  it('q なしは 400', async () => {
    const cookie = await login('a@example.com');
    const res = await ctx.app.request('/api/search', { headers: { cookie } });
    expect(res.status).toBe(400);
  });

  it('認証済みでヒットする記事があれば 200 と items 形状を返す', async () => {
    const cookie = await login('b@example.com');
    const user = await createTestUser(ctx.db);
    const category = await createTestCategory(ctx.db);
    const asUser: SessionUser = {
      id: user.id, email: user.email, displayName: user.displayName, role: 'member', avatarUrl: null, bio: '', authProvider: 'password',
    };
    const article = await createArticle(ctx.db, user.id, {
      title: 'ルート検証用ユニークタイトル', bodyMd: '本文', categoryId: category.id, tags: [],
    });
    await publishArticle(ctx.db, article.id, asUser);

    const res = await ctx.app.request('/api/search?q=ルート検証用ユニークタイトル', { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      items: [
        expect.objectContaining({ id: article.id, title: 'ルート検証用ユニークタイトル' }),
      ],
      nextCursor: null,
    });
  });
});
