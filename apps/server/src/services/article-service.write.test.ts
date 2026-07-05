import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@knowledge-hub/shared';
import { articleRevisions } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createTestCategory, createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { createArticle, publishArticle, updateArticle } from './article-service';
import { getArticleTagNames } from './tag-service';

const asUser = (id: string, role: 'member' | 'admin' = 'member'): SessionUser => ({
  id, email: 'x@example.com', displayName: 'X', role, avatarUrl: null, bio: '',
});

describe('article write', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('下書きを作成し search_text とタグとリビジョンが入る', async () => {
    const u = await createTestUser(ctx.db);
    const a = await createArticle(ctx.db, u.id, {
      title: 'AWS 入門', bodyMd: '# 見出し\n本文', tags: ['AWS'],
    });
    expect(a.status).toBe('draft');
    expect(a.searchText).toContain('見出し');
    expect(await getArticleTagNames(ctx.db, a.id)).toEqual(['AWS']);
    const revs = await ctx.db.select().from(articleRevisions).where(eq(articleRevisions.articleId, a.id));
    expect(revs).toHaveLength(1);
  });

  it('他人は更新できない（FORBIDDEN）', async () => {
    const author = await createTestUser(ctx.db);
    const other = await createTestUser(ctx.db);
    const a = await createArticle(ctx.db, author.id, { title: 't', bodyMd: '', tags: [] });
    await expect(
      updateArticle(ctx.db, a.id, asUser(other.id), {
        title: 'x', bodyMd: '', tags: [], expectedUpdatedAt: a.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('admin は他人の記事を更新できる', async () => {
    const author = await createTestUser(ctx.db);
    const admin = await createTestUser(ctx.db, { role: 'admin' });
    const a = await createArticle(ctx.db, author.id, { title: 't', bodyMd: '', tags: [] });
    const updated = await updateArticle(ctx.db, a.id, asUser(admin.id, 'admin'), {
      title: '改題', bodyMd: '', tags: [], expectedUpdatedAt: a.updatedAt.toISOString(),
    });
    expect(updated.title).toBe('改題');
  });

  it('expectedUpdatedAt 不一致は CONFLICT', async () => {
    const u = await createTestUser(ctx.db);
    const a = await createArticle(ctx.db, u.id, { title: 't', bodyMd: '', tags: [] });
    await expect(
      updateArticle(ctx.db, a.id, asUser(u.id), {
        title: 'x', bodyMd: '', tags: [],
        expectedUpdatedAt: new Date(a.updatedAt.getTime() - 1000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('公開記事のカテゴリを外そうとすると VALIDATION', async () => {
    const u = await createTestUser(ctx.db);
    const cat = await createTestCategory(ctx.db);
    const a = await createArticle(ctx.db, u.id, { title: 't', bodyMd: '', categoryId: cat.id, tags: [] });
    const published = await publishArticle(ctx.db, a.id, asUser(u.id));
    await expect(
      updateArticle(ctx.db, a.id, asUser(u.id), {
        title: 't', bodyMd: '', categoryId: null, tags: [],
        expectedUpdatedAt: published.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('下書きはカテゴリなしに更新できる', async () => {
    const u = await createTestUser(ctx.db);
    const cat = await createTestCategory(ctx.db);
    const a = await createArticle(ctx.db, u.id, { title: 't', bodyMd: '', categoryId: cat.id, tags: [] });
    const updated = await updateArticle(ctx.db, a.id, asUser(u.id), {
      title: 't', bodyMd: '', categoryId: null, tags: [],
      expectedUpdatedAt: a.updatedAt.toISOString(),
    });
    expect(updated.categoryId).toBeNull();
  });
});
