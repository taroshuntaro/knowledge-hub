import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@knowledge-hub/shared';
import { comments, reactions, uploads } from '../db/schema';
import { createTestCategory, createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import {
  createArticle, getArticleForViewer, listByCategory, listFeed, listMine, publishArticle,
} from './article-service';
import { setArticleTags } from './tag-service';

const asUser = (id: string, role: 'member' | 'admin' = 'member'): SessionUser => ({
  id, email: 'x@example.com', displayName: 'X', role, avatarUrl: null, bio: '', authProvider: 'password',
});

async function publishOne(ctx: { db: any }, authorId: string, categoryId: string, title: string) {
  const a = await createArticle(ctx.db, authorId, { title, bodyMd: '本文', categoryId, tags: [] });
  await publishArticle(ctx.db, a.id, asUser(authorId));
  return a;
}

describe('article read', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('フィードは公開記事のみを新しい順で返す', async () => {
    const u = await createTestUser(ctx.db);
    const c = await createTestCategory(ctx.db);
    await createArticle(ctx.db, u.id, { title: '下書き', bodyMd: '', categoryId: c.id, tags: [] });
    await publishOne(ctx, u.id, c.id, '公開1');
    await publishOne(ctx, u.id, c.id, '公開2');
    const page = await listFeed(ctx.db, { limit: 20 });
    expect(page.items.map((i) => i.title)).toEqual(['公開2', '公開1']);
  });

  it('カテゴリ一覧は子カテゴリの記事も含む', async () => {
    const u = await createTestUser(ctx.db);
    const parent = await createTestCategory(ctx.db, { name: '親' });
    const child = await createTestCategory(ctx.db, { name: '子', parentId: parent.id });
    await publishOne(ctx, u.id, child.id, '子の記事');
    const page = await listByCategory(ctx.db, parent.id, { limit: 20 });
    expect(page.items.map((i) => i.title)).toEqual(['子の記事']);
  });

  it('下書きは著者のみ閲覧可、他人は NOT_FOUND', async () => {
    const author = await createTestUser(ctx.db);
    const other = await createTestUser(ctx.db);
    const c = await createTestCategory(ctx.db);
    const a = await createArticle(ctx.db, author.id, { title: '秘密', bodyMd: '', categoryId: c.id, tags: [] });
    expect((await getArticleForViewer(ctx.db, a.id, asUser(author.id))).title).toBe('秘密');
    await expect(getArticleForViewer(ctx.db, a.id, asUser(other.id))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('カーソルページングで続きを取得できる', async () => {
    const u = await createTestUser(ctx.db);
    const c = await createTestCategory(ctx.db);
    for (let i = 0; i < 3; i++) await publishOne(ctx, u.id, c.id, `記事${i}`);
    const p1 = await listFeed(ctx.db, { limit: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await listFeed(ctx.db, { limit: 2, cursor: p1.nextCursor! });
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
  });

  it('listMine はカーソルで続きを取得でき重複しない', async () => {
    const u = await createTestUser(ctx.db);
    const c = await createTestCategory(ctx.db);
    for (let i = 0; i < 3; i++) {
      await createArticle(ctx.db, u.id, { title: `下書き${i}`, bodyMd: '', categoryId: c.id, tags: [] });
    }
    const p1 = await listMine(ctx.db, u.id, 'draft', { limit: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await listMine(ctx.db, u.id, 'draft', { limit: 2, cursor: p1.nextCursor! });
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    const allIds = [...p1.items, ...p2.items].map((i) => i.id);
    expect(new Set(allIds).size).toBe(3);
  });

  it('listMine は同一ミリ秒の下書きをページ境界で取りこぼさない', async () => {
    const u = await createTestUser(ctx.db);
    const a1 = await createArticle(ctx.db, u.id, { title: '下書きA', bodyMd: '', tags: [] });
    const a2 = await createArticle(ctx.db, u.id, { title: '下書きB', bodyMd: '', tags: [] });
    // 2 記事を作成後、SQL で updated_at を同一 ms・異なる µs に固定する
    // （engagement-service.test.ts の µs 注入手法を流用）。
    const [idSmall, idBig] = [a1.id, a2.id].sort();
    await ctx.db.execute(sql`update articles set updated_at = '2026-01-01 00:00:00.123456+00' where id = ${idSmall}`);
    await ctx.db.execute(sql`update articles set updated_at = '2026-01-01 00:00:00.123789+00' where id = ${idBig}`);
    const page1 = await listMine(ctx.db, u.id, 'draft', { limit: 1 });
    const page2 = await listMine(ctx.db, u.id, 'draft', { cursor: page1.nextCursor!, limit: 1 });
    const seen = [...page1.items, ...page2.items].map((a) => a.id);
    // 現状は同一 ms バケットの行が欠落して FAIL する
    expect(new Set(seen).size).toBe(2);
  });

  it('フィード一覧はカテゴリ名・タグ・反応数・コメント数・ヒーロー画像を含む', async () => {
    const author = await createTestUser(ctx.db, { avatarUrl: 'https://example.com/avatar.png' });
    const reactor = await createTestUser(ctx.db);
    const c = await createTestCategory(ctx.db, { name: 'デザイン' });
    const [upload] = await ctx.db
      .insert(uploads)
      .values({ uploaderId: author.id, storageKey: 'k1', mimeType: 'image/png', size: 1 })
      .returning();
    const article = await createArticle(ctx.db, author.id, {
      title: 'ヒーロー付き記事', bodyMd: '本文', categoryId: c.id, heroImageUploadId: upload.id, tags: ['a', 'b'],
    });
    await publishArticle(ctx.db, article.id, asUser(author.id));
    await setArticleTags(ctx.db, article.id, ['a', 'b']);
    await ctx.db.insert(reactions).values([
      { userId: author.id, articleId: article.id, emoji: '👍' },
      { userId: reactor.id, articleId: article.id, emoji: '👍' },
    ]);
    await ctx.db.insert(comments).values([
      { articleId: article.id, authorId: reactor.id, bodyMd: 'コメント' },
      { articleId: article.id, authorId: reactor.id, bodyMd: '削除済み', deletedAt: new Date() },
    ]);

    const bare = await publishOne(ctx, author.id, c.id, '付加情報なし記事');

    const page = await listFeed(ctx.db, { limit: 20 });
    const item = page.items.find((i) => i.id === article.id)!;
    expect(item.categoryName).toBe('デザイン');
    expect(item.tags.slice().sort()).toEqual(['a', 'b']);
    expect(item.reactionCount).toBe(2);
    expect(item.commentCount).toBe(1);
    expect(item.heroImage).toBe(`/api/uploads/${upload.id}`);
    expect(item.authorAvatarUrl).toBe('https://example.com/avatar.png');

    const bareItem = page.items.find((i) => i.id === bare.id)!;
    expect(bareItem.tags).toEqual([]);
    expect(bareItem.reactionCount).toBe(0);
    expect(bareItem.commentCount).toBe(0);
    expect(bareItem.heroImage).toBeNull();
  });

  it('記事詳細は categoryName・authorAvatarUrl・heroImage を含む', async () => {
    const author = await createTestUser(ctx.db, { avatarUrl: 'https://example.com/avatar.png' });
    const c = await createTestCategory(ctx.db, { name: 'デザイン' });
    const [upload] = await ctx.db
      .insert(uploads)
      .values({ uploaderId: author.id, storageKey: 'k2', mimeType: 'image/png', size: 1 })
      .returning();
    const article = await createArticle(ctx.db, author.id, {
      title: 'ヒーロー付き記事', bodyMd: '本文', categoryId: c.id, heroImageUploadId: upload.id, tags: [],
    });
    await publishArticle(ctx.db, article.id, asUser(author.id));

    const detail = await getArticleForViewer(ctx.db, article.id, asUser(author.id));
    expect(detail.categoryName).toBe('デザイン');
    expect(detail.heroImage).toBe(`/api/uploads/${upload.id}`);
    expect(detail.authorAvatarUrl).toBe('https://example.com/avatar.png');
  });

  it('カテゴリ/画像なしの記事は categoryName・heroImage が null', async () => {
    const author = await createTestUser(ctx.db);
    const article = await createArticle(ctx.db, author.id, { title: '付加情報なし', bodyMd: '本文', tags: [] });

    const detail = await getArticleForViewer(ctx.db, article.id, asUser(author.id));
    expect(detail.categoryName).toBeNull();
    expect(detail.heroImage).toBeNull();
  });
});
