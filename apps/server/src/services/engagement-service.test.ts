import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { SessionUser } from '@knowledge-hub/shared';
import { REACTION_EMOJIS } from '@knowledge-hub/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { bookmarks } from '../db/schema';
import { createTestArticle, createTestCategory, createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { publishArticle, unpublishArticle } from './article-service';
import { createComment, deleteComment } from './comment-service';
import {
  addBookmark,
  addReaction,
  getEngagement,
  listBookmarks,
  removeBookmark,
  removeReaction,
} from './engagement-service';

const asUser = (id: string, role: 'member' | 'admin' = 'member'): SessionUser => ({
  id, email: 'x@example.com', displayName: 'X', role, avatarUrl: null, bio: '', authProvider: 'password',
});

describe('engagement service', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  async function publishedArticle() {
    const author = await createTestUser(ctx.db);
    const category = await createTestCategory(ctx.db, { name: `テック-${randomUUID()}` });
    const article = await createTestArticle(ctx.db, { authorId: author.id, categoryId: category.id });
    return publishArticle(ctx.db, article.id, asUser(author.id));
  }

  it('1. addReaction → getEngagement.reactions[絵文字] が 1、myReactions に含まれる', async () => {
    const article = await publishedArticle();
    const user = await createTestUser(ctx.db);
    await addReaction(ctx.db, user.id, article.id, '👍');
    const engagement = await getEngagement(ctx.db, user.id, article.id);
    expect(engagement.reactions['👍']).toBe(1);
    expect(engagement.myReactions).toContain('👍');
  });

  it('2. 同じリアクションを 2 回 addReaction → 冪等（件数 1 のまま、例外なし）', async () => {
    const article = await publishedArticle();
    const user = await createTestUser(ctx.db);
    await addReaction(ctx.db, user.id, article.id, '👍');
    await expect(addReaction(ctx.db, user.id, article.id, '👍')).resolves.not.toThrow();
    const engagement = await getEngagement(ctx.db, user.id, article.id);
    expect(engagement.reactions['👍']).toBe(1);
  });

  it('3. removeReaction → 件数 0、myReactions から消える', async () => {
    const article = await publishedArticle();
    const user = await createTestUser(ctx.db);
    await addReaction(ctx.db, user.id, article.id, '👍');
    await removeReaction(ctx.db, user.id, article.id, '👍');
    const engagement = await getEngagement(ctx.db, user.id, article.id);
    expect(engagement.reactions['👍']).toBe(0);
    expect(engagement.myReactions).not.toContain('👍');
  });

  it('4. 別ユーザーの同絵文字リアクション → 件数 2、自分の myReactions は自分の分だけ', async () => {
    const article = await publishedArticle();
    const user1 = await createTestUser(ctx.db);
    const user2 = await createTestUser(ctx.db);
    await addReaction(ctx.db, user1.id, article.id, '👍');
    await addReaction(ctx.db, user2.id, article.id, '👍');
    const engagement = await getEngagement(ctx.db, user1.id, article.id);
    expect(engagement.reactions['👍']).toBe(2);
    expect(engagement.myReactions).toEqual(['👍']);
  });

  it('5. 下書き記事への addReaction を拒否（NOT_FOUND 404）', async () => {
    const author = await createTestUser(ctx.db);
    const draft = await createTestArticle(ctx.db, { authorId: author.id });
    const user = await createTestUser(ctx.db);
    await expect(addReaction(ctx.db, user.id, draft.id, '👍')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('6. addBookmark → bookmarked: true、removeBookmark → false、2 回 add は冪等', async () => {
    const article = await publishedArticle();
    const user = await createTestUser(ctx.db);
    await addBookmark(ctx.db, user.id, article.id);
    await expect(addBookmark(ctx.db, user.id, article.id)).resolves.not.toThrow();
    let engagement = await getEngagement(ctx.db, user.id, article.id);
    expect(engagement.bookmarked).toBe(true);
    await removeBookmark(ctx.db, user.id, article.id);
    engagement = await getEngagement(ctx.db, user.id, article.id);
    expect(engagement.bookmarked).toBe(false);
  });

  it('7. listBookmarks: 追加した記事が出る。非公開化した記事はブックマークが残っていても一覧に出ない', async () => {
    const user = await createTestUser(ctx.db);
    const article1 = await publishedArticle();
    const article2 = await publishedArticle();
    await addBookmark(ctx.db, user.id, article1.id);
    await addBookmark(ctx.db, user.id, article2.id);

    const author2 = asUser(article2.authorId);
    await unpublishArticle(ctx.db, article2.id, author2);

    const page = await listBookmarks(ctx.db, user.id, { limit: 10 });
    const ids = page.items.map((i) => i.id);
    expect(ids).toContain(article1.id);
    expect(ids).not.toContain(article2.id);
  });

  it('8. getEngagement.commentCount: 未削除コメント 2 + 削除済み 1 → commentCount === 2', async () => {
    const article = await publishedArticle();
    const user = await createTestUser(ctx.db);
    const commenter = await createTestUser(ctx.db);
    await createComment(ctx.db, article.id, asUser(commenter.id), { bodyMd: '1件目' });
    const second = await createComment(ctx.db, article.id, asUser(commenter.id), { bodyMd: '2件目' });
    const third = await createComment(ctx.db, article.id, asUser(commenter.id), { bodyMd: '3件目' });
    await deleteComment(ctx.db, third.id, asUser(commenter.id));
    void second;
    const engagement = await getEngagement(ctx.db, user.id, article.id);
    expect(engagement.commentCount).toBe(2);
  });

  it('9. getEngagement.reactions は全プリセット絵文字キーを持つ（未使用の絵文字は 0）', async () => {
    const article = await publishedArticle();
    const user = await createTestUser(ctx.db);
    await addReaction(ctx.db, user.id, article.id, '👍');
    const engagement = await getEngagement(ctx.db, user.id, article.id);
    for (const emoji of REACTION_EMOJIS) {
      expect(engagement.reactions).toHaveProperty(emoji);
    }
    expect(Object.keys(engagement.reactions)).toHaveLength(REACTION_EMOJIS.length);
    const unused = REACTION_EMOJIS.find((e) => e !== '👍')!;
    expect(engagement.reactions[unused]).toBe(0);
  });

  it('10. listBookmarks カーソルページング（limit=1 で 2 ページ、created_at desc、重複なし）', async () => {
    const user = await createTestUser(ctx.db);
    const article1 = await publishedArticle();
    await addBookmark(ctx.db, user.id, article1.id);
    await new Promise((r) => setTimeout(r, 5));
    const article2 = await publishedArticle();
    await addBookmark(ctx.db, user.id, article2.id);

    const page1 = await listBookmarks(ctx.db, user.id, { limit: 1 });
    expect(page1.items).toHaveLength(1);
    expect(page1.items[0].id).toBe(article2.id);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listBookmarks(ctx.db, user.id, { limit: 1, cursor: page1.nextCursor! });
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0].id).toBe(article1.id);
    expect(page2.nextCursor).toBeNull();
  });

  it('11. カーソルページング: 同一ミリ秒バケット内でマイクロ秒順と id 順が逆でも欠落・重複なし', async () => {
    const user = await createTestUser(ctx.db);
    const article1 = await publishedArticle();
    const article2 = await publishedArticle();

    // 決定論的にスキップのバグ条件を再現する（comment-service Task 3 の desc 版）:
    // 2 つの bookmark 行を「同一ミリ秒バケット内でマイクロ秒だけ異なる」createdAt で
    // 直接 insert（addBookmark を経由しない）し、かつ「生タイムスタンプが早い方の
    // bookmark.id を大きく」する。生 createdAt を使う ORDER BY desc は lateRow を先に
    // 返し、cursor.id = lateRow.id（小）。次ページの WHERE desc は id < lateRow.id（小）を
    // 要求するので id の大きい earlyRow が永久に欠落する。修正後は ORDER BY も
    // date_trunc('milliseconds', ...) desc を使うため id 降順で並び、両行が取得できる。
    // JS の Date はミリ秒精度しか持てないので、マイクロ秒差は生 SQL リテラルで注入する。
    const [smallId, largeId] = [randomUUID(), randomUUID()].sort();
    // 早い生マイクロ秒（.000100）に大きい id を割り当てる = スキップを誘発する並び。
    const earlyBookmarkId = largeId;
    const lateBookmarkId = smallId;
    await ctx.db.insert(bookmarks).values([
      {
        id: earlyBookmarkId,
        userId: user.id,
        articleId: article1.id,
        createdAt: sql`'2026-01-01 00:00:00.000100+00'::timestamptz`,
      },
      {
        id: lateBookmarkId,
        userId: user.id,
        articleId: article2.id,
        createdAt: sql`'2026-01-01 00:00:00.000900+00'::timestamptz`,
      },
    ]);
    const expectedIds = new Set([article1.id, article2.id]);

    const page1 = await listBookmarks(ctx.db, user.id, { limit: 1 });
    expect(page1.items).toHaveLength(1);

    const seenIds = [page1.items[0].id];
    let nextCursor = page1.nextCursor;
    while (nextCursor) {
      const page = await listBookmarks(ctx.db, user.id, { limit: 1, cursor: nextCursor });
      expect(page.items).toHaveLength(1);
      seenIds.push(page.items[0].id);
      nextCursor = page.nextCursor;
    }

    // 欠落なし・重複なし: 見えた記事 id 集合が両 id と厳密一致し、合計 2 件。
    expect(seenIds).toHaveLength(2);
    expect(new Set(seenIds)).toEqual(expectedIds);
  });
});
