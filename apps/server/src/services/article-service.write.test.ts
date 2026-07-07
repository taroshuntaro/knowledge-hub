import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@knowledge-hub/shared';
import { articleRevisions, uploads } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { createTestCategory, createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { createArticle, publishArticle, updateArticle } from './article-service';
import { getArticleTagNames } from './tag-service';

const asUser = (id: string, role: 'member' | 'admin' = 'member'): SessionUser => ({
  id, email: 'x@example.com', displayName: 'X', role, avatarUrl: null, bio: '', authProvider: 'password',
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

  it('同一 expectedUpdatedAt の並行更新は片方だけ成功する（楽観ロックの原子性）', async () => {
    const author = await createTestUser(ctx.db);
    const article = await createArticle(ctx.db, author.id, { title: 't', bodyMd: 'b', tags: [] });
    // pg.Pool は初回はアイドル接続を1本しか持たないため、ウォームアップなしだと片方の
    // 呼び出しが新規コネクション確立の遅延で常に後追いになり、レースが再現しない
    // （偶然どちらか一方が確実に先着し、非同期の check-then-act でも毎回 1 勝 1 敗に見える）。
    // 2 本の接続を先に温めておくことで、本当に同時に SELECT が走る状況を作る。
    await Promise.all([ctx.db.execute(sql`select 1`), ctx.db.execute(sql`select 1`)]);
    const expected = article.updatedAt.toISOString();
    const input = (title: string) => ({ title, bodyMd: 'b', tags: [], expectedUpdatedAt: expected });
    const results = await Promise.allSettled([
      updateArticle(ctx.db, article.id, asUser(author.id), input('A')),
      updateArticle(ctx.db, article.id, asUser(author.id), input('B')),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const ng = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(ng).toHaveLength(1);
    expect((ng[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'CONFLICT' });
  });

  it('同一内容の保存はリビジョンを増やさない', async () => {
    const u = await createTestUser(ctx.db);
    const a = await createArticle(ctx.db, u.id, { title: 't', bodyMd: 'b', tags: [] });
    let current = a;
    for (let i = 0; i < 2; i++) {
      current = await updateArticle(ctx.db, a.id, asUser(u.id), {
        title: 't', bodyMd: 'b', tags: [], expectedUpdatedAt: current.updatedAt.toISOString(),
      });
    }
    const revs = await ctx.db.select().from(articleRevisions).where(eq(articleRevisions.articleId, a.id));
    expect(revs).toHaveLength(1);
  });

  it('10 分以内の連続保存は直近リビジョンを上書きする', async () => {
    const u = await createTestUser(ctx.db);
    const a = await createArticle(ctx.db, u.id, { title: 't', bodyMd: 'b', tags: [] });
    const v2 = await updateArticle(ctx.db, a.id, asUser(u.id), {
      title: 'v2', bodyMd: 'b2', tags: [], expectedUpdatedAt: a.updatedAt.toISOString(),
    });
    await updateArticle(ctx.db, a.id, asUser(u.id), {
      title: 'v3', bodyMd: 'b3', tags: [], expectedUpdatedAt: v2.updatedAt.toISOString(),
    });
    const revs = await ctx.db.select().from(articleRevisions).where(eq(articleRevisions.articleId, a.id));
    expect(revs).toHaveLength(1);
    expect(revs[0].title).toBe('v3');
    expect(revs[0].bodyMd).toBe('b3');
  });

  it('作成時に heroImageUploadId を保存できる', async () => {
    const author = await createTestUser(ctx.db);
    const [upload] = await ctx.db
      .insert(uploads)
      .values({ uploaderId: author.id, storageKey: 'uploads/hero.png', mimeType: 'image/png', size: 100 })
      .returning();
    const row = await createArticle(ctx.db, author.id, {
      title: 't', bodyMd: 'b', tags: [], heroImageUploadId: upload.id,
    });
    expect(row.heroImageUploadId).toBe(upload.id);
  });

  it('更新で heroImageUploadId を差し替え・null 化できる', async () => {
    const author = await createTestUser(ctx.db);
    const [upload] = await ctx.db
      .insert(uploads)
      .values({ uploaderId: author.id, storageKey: 'uploads/hero.png', mimeType: 'image/png', size: 100 })
      .returning();
    const article = await createArticle(ctx.db, author.id, {
      title: 't', bodyMd: 'b', tags: [], heroImageUploadId: upload.id,
    });
    const updated = await updateArticle(ctx.db, article.id, asUser(author.id), {
      title: 't2', bodyMd: 'b', tags: [], heroImageUploadId: null,
      expectedUpdatedAt: article.updatedAt.toISOString(),
    });
    expect(updated.heroImageUploadId).toBeNull();
  });

  it('10 分より古い直近リビジョンがある場合は新規リビジョンを作る', async () => {
    const u = await createTestUser(ctx.db);
    const a = await createArticle(ctx.db, u.id, { title: 't', bodyMd: 'b', tags: [] });
    const v2 = await updateArticle(ctx.db, a.id, asUser(u.id), {
      title: 'v2', bodyMd: 'b2', tags: [], expectedUpdatedAt: a.updatedAt.toISOString(),
    });
    await ctx.db.execute(
      sql`update article_revisions set saved_at = now() - interval '11 minutes' where article_id = ${a.id}`,
    );
    await updateArticle(ctx.db, a.id, asUser(u.id), {
      title: 'v3', bodyMd: 'b3', tags: [], expectedUpdatedAt: v2.updatedAt.toISOString(),
    });
    const revs = await ctx.db.select().from(articleRevisions).where(eq(articleRevisions.articleId, a.id));
    expect(revs).toHaveLength(2);
  });
});
