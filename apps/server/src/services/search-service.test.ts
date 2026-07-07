import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@knowledge-hub/shared';
import { comments, reactions, uploads } from '../db/schema';
import { createTestCategory, createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { createArticle, publishArticle, softDeleteArticle } from './article-service';
import { createBigmSearchService } from './search-service';
import { setArticleTags } from './tag-service';

const asUser = (id: string, role: 'member' | 'admin' = 'member'): SessionUser => ({
  id, email: 'x@example.com', displayName: 'X', role, avatarUrl: null, bio: '', authProvider: 'password',
});

async function publishOne(
  db: any,
  authorId: string,
  categoryId: string | null,
  title: string,
  bodyMd = '本文',
  tags: string[] = [],
) {
  const a = await createArticle(db, authorId, { title, bodyMd, categoryId, tags });
  await publishArticle(db, a.id, asUser(authorId));
  return a;
}

describe('search-service', () => {
  const ctx = createTestApp();
  const service = createBigmSearchService();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('1. タイトルのみにヒットする語で検索すると該当記事が返る', async () => {
    const u = await createTestUser(ctx.db);
    const c = await createTestCategory(ctx.db);
    await publishOne(ctx.db, u.id, c.id, 'ユニークタイトルワード', '無関係の本文');
    const page = await service.search(ctx.db, { q: 'ユニークタイトルワード', limit: 20 });
    expect(page.items.map((i) => i.title)).toEqual(['ユニークタイトルワード']);
  });

  it('2. 本文のみにヒットする語で検索すると返る', async () => {
    const u = await createTestUser(ctx.db);
    const c = await createTestCategory(ctx.db);
    await publishOne(ctx.db, u.id, c.id, '別タイトル', '本文中にしかない特殊キーワードXYZ');
    const page = await service.search(ctx.db, { q: '特殊キーワードXYZ', limit: 20 });
    expect(page.items.map((i) => i.title)).toEqual(['別タイトル']);
  });

  it('3. タグのみにヒットする語で検索すると返る', async () => {
    const u = await createTestUser(ctx.db);
    const c = await createTestCategory(ctx.db);
    await publishOne(ctx.db, u.id, c.id, 'タグ記事', '本文', ['タグワード専用']);
    const page = await service.search(ctx.db, { q: 'タグワード専用', limit: 20 });
    expect(page.items.map((i) => i.title)).toEqual(['タグ記事']);
  });

  it('4. 下書き記事・ゴミ箱記事は同じ語を含んでいてもヒットしない', async () => {
    const u = await createTestUser(ctx.db);
    const c = await createTestCategory(ctx.db);
    // draft (never published)
    await createArticle(ctx.db, u.id, { title: '下書き専用ワード', bodyMd: '本文', categoryId: c.id, tags: [] });
    // trashed
    const trashed = await publishOne(ctx.db, u.id, c.id, 'ゴミ箱専用ワード', '本文');
    await softDeleteArticle(ctx.db, trashed.id, asUser(u.id));

    const page1 = await service.search(ctx.db, { q: '下書き専用ワード', limit: 20 });
    expect(page1.items).toHaveLength(0);
    const page2 = await service.search(ctx.db, { q: 'ゴミ箱専用ワード', limit: 20 });
    expect(page2.items).toHaveLength(0);
  });

  it('5. % を含むクエリはリテラルとして扱われる', async () => {
    const u = await createTestUser(ctx.db);
    const c = await createTestCategory(ctx.db);
    await publishOne(ctx.db, u.id, c.id, '割引記事', '達成率100%です');
    await publishOne(ctx.db, u.id, c.id, '別記事', '普通の本文です');
    const page = await service.search(ctx.db, { q: '100%', limit: 20 });
    expect(page.items.map((i) => i.title)).toEqual(['割引記事']);
  });

  it('6. categoryId 絞り込みは親カテゴリ指定で子カテゴリの記事も返る', async () => {
    const u = await createTestUser(ctx.db);
    const parent = await createTestCategory(ctx.db, { name: '親' });
    const child = await createTestCategory(ctx.db, { name: '子', parentId: parent.id });
    const other = await createTestCategory(ctx.db, { name: '無関係' });
    await publishOne(ctx.db, u.id, child.id, '子記事カテゴリテスト');
    await publishOne(ctx.db, u.id, other.id, '無関係記事カテゴリテスト');
    const page = await service.search(ctx.db, { q: 'カテゴリテスト', categoryId: parent.id, limit: 20 });
    expect(page.items.map((i) => i.title)).toEqual(['子記事カテゴリテスト']);
  });

  it('7. tag 絞り込みは指定タグを持つ記事のみ返す', async () => {
    const u = await createTestUser(ctx.db);
    const c = await createTestCategory(ctx.db);
    await publishOne(ctx.db, u.id, c.id, 'タグ絞り込みA', '本文', ['絞り込みタグ']);
    await publishOne(ctx.db, u.id, c.id, 'タグ絞り込みB', '本文', ['別タグ']);
    const page = await service.search(ctx.db, { q: 'タグ絞り込み', tag: '絞り込みタグ', limit: 20 });
    expect(page.items.map((i) => i.title)).toEqual(['タグ絞り込みA']);
  });

  it('8. authorId 絞り込みは指定著者のみ返す', async () => {
    const u1 = await createTestUser(ctx.db);
    const u2 = await createTestUser(ctx.db);
    const c = await createTestCategory(ctx.db);
    await publishOne(ctx.db, u1.id, c.id, '著者絞り込み記事1');
    await publishOne(ctx.db, u2.id, c.id, '著者絞り込み記事2');
    const page = await service.search(ctx.db, { q: '著者絞り込み', authorId: u1.id, limit: 20 });
    expect(page.items.map((i) => i.title)).toEqual(['著者絞り込み記事1']);
  });

  it('9. スニペットは本文後方でヒットした場合もクエリ語を含む', async () => {
    const u = await createTestUser(ctx.db);
    const c = await createTestCategory(ctx.db);
    const padding = 'あ'.repeat(200);
    await publishOne(ctx.db, u.id, c.id, '後方ヒット記事', `${padding}後方専用キーワードZZZ`);
    const page = await service.search(ctx.db, { q: '後方専用キーワードZZZ', limit: 20 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].snippet).toContain('後方専用キーワードZZZ');
  });

  it('10. カーソルページングで limit=1 の 2 ページ目が取れ重複しない', async () => {
    const u = await createTestUser(ctx.db);
    const c = await createTestCategory(ctx.db);
    await publishOne(ctx.db, u.id, c.id, 'ページング記事1', 'カーソルページング共通語');
    await publishOne(ctx.db, u.id, c.id, 'ページング記事2', 'カーソルページング共通語');
    const p1 = await service.search(ctx.db, { q: 'カーソルページング共通語', limit: 1 });
    expect(p1.items).toHaveLength(1);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await service.search(ctx.db, {
      q: 'カーソルページング共通語',
      limit: 1,
      cursor: p1.nextCursor!,
    });
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    const ids = [...p1.items, ...p2.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('11. 大文字小文字を無視して検索できる', async () => {
    const u = await createTestUser(ctx.db);
    const c = await createTestCategory(ctx.db);
    await publishOne(ctx.db, u.id, c.id, 'TypeScript入門', '本文');
    const page = await service.search(ctx.db, { q: 'typescript', limit: 20 });
    expect(page.items.map((i) => i.title)).toEqual(['TypeScript入門']);
  });

  it('12. 検索結果はカテゴリ名・タグ・反応数・コメント数・ヒーロー画像・スニペットを含む', async () => {
    const author = await createTestUser(ctx.db, { avatarUrl: 'https://example.com/avatar.png' });
    const reactor = await createTestUser(ctx.db);
    const c = await createTestCategory(ctx.db, { name: 'デザイン' });
    const [upload] = await ctx.db
      .insert(uploads)
      .values({ uploaderId: author.id, storageKey: 'k1', mimeType: 'image/png', size: 1 })
      .returning();
    const article = await createArticle(ctx.db, author.id, {
      title: '検索メタ情報記事', bodyMd: '本文', categoryId: c.id, heroImageUploadId: upload.id, tags: ['a', 'b'],
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

    const page = await service.search(ctx.db, { q: '検索メタ情報記事', limit: 20 });
    const item = page.items.find((i) => i.id === article.id)!;
    expect(item.categoryName).toBe('デザイン');
    expect(item.tags.slice().sort()).toEqual(['a', 'b']);
    expect(item.reactionCount).toBe(2);
    expect(item.commentCount).toBe(1);
    expect(item.heroImage).toBe(`/api/uploads/${upload.id}`);
    expect(item.authorAvatarUrl).toBe('https://example.com/avatar.png');
    expect(item.snippet).toContain('検索メタ情報記事');
  });
});
