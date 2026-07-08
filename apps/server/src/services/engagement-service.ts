import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { REACTION_EMOJIS, type ArticleEngagement } from '@knowledge-hub/shared';
import { articles, bookmarks, categories, comments, reactions, users } from '../db/schema';
import { fetchListMetadata } from './article-service';
import type { Db } from '../types';
import { assertPublishedArticle, publishedArticleWhere } from './article-visibility';
import { decodeCursor, encodeCursor, type Page } from './cursor';
import { notifyReactionAdded, runNotify } from './notification-service';

export type BookmarkedArticle = {
  id: string;
  title: string;
  excerpt: string;
  authorId: string;
  authorName: string;
  categoryId: string | null;
  pinnedAt: Date | null;
  publishedAt: Date | null;
  updatedAt: Date;
  bookmarkedAt: Date;
  heroImage: string | null;
  categoryName: string | null;
  authorAvatarUrl: string | null;
  tags: string[];
  reactionCount: number;
  commentCount: number;
};


export async function addReaction(db: Db, userId: string, articleId: string, emoji: string): Promise<void> {
  const article = await assertPublishedArticle(db, articleId);
  const inserted = await db
    .insert(reactions)
    .values({ userId, articleId, emoji })
    .onConflictDoNothing({ target: [reactions.userId, reactions.articleId, reactions.emoji] })
    .returning({ id: reactions.id });
  // 既存行との衝突（同じリアクションの再 POST）では insert が起きないので通知もしない
  if (inserted.length > 0) {
    await runNotify('reaction-added', () =>
      notifyReactionAdded(db, { actorId: userId, articleId, articleAuthorId: article.authorId }),
    );
  }
}

export async function removeReaction(db: Db, userId: string, articleId: string, emoji: string): Promise<void> {
  // intentionally not gated on published: allow cleanup after unpublish (always 204, no existence oracle)
  await db
    .delete(reactions)
    .where(and(eq(reactions.userId, userId), eq(reactions.articleId, articleId), eq(reactions.emoji, emoji)));
}

export async function addBookmark(db: Db, userId: string, articleId: string): Promise<void> {
  await assertPublishedArticle(db, articleId);
  await db.insert(bookmarks).values({ userId, articleId }).onConflictDoNothing({
    target: [bookmarks.userId, bookmarks.articleId],
  });
}

export async function removeBookmark(db: Db, userId: string, articleId: string): Promise<void> {
  // intentionally not gated on published: allow cleanup after unpublish (always 204, no existence oracle)
  await db.delete(bookmarks).where(and(eq(bookmarks.userId, userId), eq(bookmarks.articleId, articleId)));
}

export async function getEngagement(db: Db, userId: string, articleId: string): Promise<ArticleEngagement> {
  await assertPublishedArticle(db, articleId);

  // 集計・自分の反応・ブックマーク有無・コメント数は互いに独立。Promise.all で 1 往復にまとめる。
  const [counts, mine, bookmark, [{ count: commentCount }]] = await Promise.all([
    db
      .select({ emoji: reactions.emoji, count: sql<number>`count(*)::int` })
      .from(reactions)
      .where(eq(reactions.articleId, articleId))
      .groupBy(reactions.emoji),
    db
      .select({ emoji: reactions.emoji })
      .from(reactions)
      .where(and(eq(reactions.articleId, articleId), eq(reactions.userId, userId))),
    db.query.bookmarks.findFirst({
      where: and(eq(bookmarks.userId, userId), eq(bookmarks.articleId, articleId)),
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(comments)
      .where(and(eq(comments.articleId, articleId), isNull(comments.deletedAt))),
  ]);
  const reactionMap: Record<string, number> = Object.fromEntries(REACTION_EMOJIS.map((e) => [e, 0]));
  for (const row of counts) {
    if (row.emoji in reactionMap) reactionMap[row.emoji] = row.count;
  }

  return {
    reactions: reactionMap,
    myReactions: mine.map((r) => r.emoji),
    bookmarked: !!bookmark,
    commentCount,
  };
}

const BOOKMARK_COLUMNS = {
  id: articles.id,
  title: articles.title,
  excerpt: sql<string>`left(${articles.searchText}, 160)`,
  authorId: articles.authorId,
  authorName: users.displayName,
  categoryId: articles.categoryId,
  pinnedAt: articles.pinnedAt,
  publishedAt: articles.publishedAt,
  updatedAt: articles.updatedAt,
  bookmarkedAt: bookmarks.createdAt,
  heroImageUploadId: articles.heroImageUploadId,
  categoryName: categories.name,
  authorAvatarUrl: users.avatarUrl,
  // カーソルのタイブレークは bookmarks.id で行うため、articles.id とは別に保持する
  // （BOOKMARK_COLUMNS.id は API 形状用に articles.id を指しており、bookmarks.id と
  // 混同するとタイブレークが無関係な article id と比較される不具合になる）。
  bookmarkId: bookmarks.id,
};

export async function listBookmarks(
  db: Db,
  userId: string,
  page: { cursor?: string; limit: number },
): Promise<Page<BookmarkedArticle>> {
  const base = and(eq(bookmarks.userId, userId), publishedArticleWhere());
  // bookmarks.createdAt は DB の now()（マイクロ秒精度）で入るが、カーソルは JS Date
  // （ミリ秒精度）で encode するため、WHERE と ORDER BY の両方で
  // date_trunc('milliseconds', ...) に丸めた同じキーを使う。丸めないと、同一 ms
  // バケット内で生タイムスタンプ順と id 順がずれる行がある場合に、次ページで
  // 一部の行が永久に欠落し得る（comment-service Task 3 で見つかったバグと同型）。
  const createdAtMs = sql`date_trunc('milliseconds', ${bookmarks.createdAt})`;
  const where = page.cursor
    ? and(
        base,
        (() => {
          const c = decodeCursor(page.cursor!);
          const cursorDate = new Date(c.sortKey);
          return or(
            sql`${createdAtMs} < ${cursorDate}`,
            and(sql`${createdAtMs} = ${cursorDate}`, lt(bookmarks.id, c.id)),
          );
        })(),
      )
    : base;

  const rows = await db
    .select(BOOKMARK_COLUMNS)
    .from(bookmarks)
    .innerJoin(articles, eq(bookmarks.articleId, articles.id))
    .innerJoin(users, eq(articles.authorId, users.id))
    .leftJoin(categories, eq(articles.categoryId, categories.id))
    .where(where)
    .orderBy(desc(createdAtMs), desc(bookmarks.id))
    .limit(page.limit + 1);

  const topRows = rows.slice(0, page.limit);
  const last = topRows[topRows.length - 1];
  const nextCursor = rows.length > page.limit ? encodeCursor(last.bookmarkedAt, last.bookmarkId) : null;
  const meta = await fetchListMetadata(db, topRows.map((r) => r.id));
  const items = topRows.map(({ bookmarkId, heroImageUploadId, ...rest }) => {
    const m = meta.get(rest.id);
    return {
      ...rest,
      heroImage: heroImageUploadId ? `/api/uploads/${heroImageUploadId}` : null,
      tags: m?.tags ?? [],
      reactionCount: m?.reactionCount ?? 0,
      commentCount: m?.commentCount ?? 0,
    };
  });
  return { items, nextCursor };
}
