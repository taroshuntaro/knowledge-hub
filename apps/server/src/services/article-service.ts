import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { SessionUser } from '@knowledge-hub/shared';
import {
  articleRevisions, articles, articleTags, categories, tags, users,
} from '../db/schema';
import { AppError } from '../errors';
import type { Db } from '../types';
import { decodeCursor, encodeCursor } from './cursor';
import { buildSearchText } from './markdown';
import { notifyArticleMentions, runNotify } from './notification-service';
import { can } from './permissions';
import { getArticleTagNames, setArticleTags } from './tag-service';

export type ArticleRecord = typeof articles.$inferSelect;
export type ArticleInput = {
  title: string;
  bodyMd: string;
  categoryId?: string | null;
  tags: string[];
};

// updateArticle が SELECT ... FOR UPDATE トランザクション内から tx を渡せるように、
// Db 全体ではなく実際に使うメソッドだけを要求する（tag-service.TagStore と同じ手法）。
type RevisionStore = Pick<Db, 'select' | 'insert' | 'update'>;

async function snapshot(db: RevisionStore, article: { id: string; title: string; bodyMd: string }) {
  await db.insert(articleRevisions).values({
    articleId: article.id,
    title: article.title,
    bodyMd: article.bodyMd,
  });
}

async function assertCategoryExists(db: Db, categoryId: string): Promise<void> {
  const row = await db.query.categories.findFirst({
    where: eq(categories.id, categoryId), columns: { id: true },
  });
  if (!row) throw new AppError('VALIDATION', '指定されたカテゴリが存在しません', 400);
}

export async function createArticle(
  db: Db,
  authorId: string,
  input: ArticleInput,
): Promise<ArticleRecord> {
  if (input.categoryId) await assertCategoryExists(db, input.categoryId);
  const searchText = buildSearchText({ title: input.title, bodyMd: input.bodyMd, tags: input.tags });
  const [row] = await db
    .insert(articles)
    .values({
      authorId,
      categoryId: input.categoryId ?? null,
      title: input.title,
      bodyMd: input.bodyMd,
      searchText,
    })
    .returning();
  await setArticleTags(db, row.id, input.tags);
  await snapshot(db, row);
  return row;
}

async function loadEditable(db: Db, id: string): Promise<ArticleRecord> {
  const row = await db.query.articles.findFirst({
    where: and(eq(articles.id, id), isNull(articles.deletedAt)),
  });
  if (!row) throw new AppError('NOT_FOUND', '記事が見つかりません', 404);
  return row;
}

export async function updateArticle(
  db: Db,
  id: string,
  editor: SessionUser,
  input: ArticleInput & { expectedUpdatedAt: string },
): Promise<ArticleRecord> {
  if (input.categoryId) await assertCategoryExists(db, input.categoryId);
  // SELECT → JS 比較 → 無条件 UPDATE の check-then-act だと、同一 expectedUpdatedAt の
  // 並行 PATCH が両方とも「一致している」と判定して両方成功してしまう（lost update）。
  // SELECT ... FOR UPDATE で対象行をロックし、比較と UPDATE を同一トランザクションに
  // 閉じ込めることで直列化する（auth-service.loginWithPassword / user-service.updateUserByAdmin
  // と同じパターン）。WHERE updated_at = expectedUpdatedAt の条件付き UPDATE にしないのは、
  // DB 側がマイクロ秒精度・アプリ側の Date がミリ秒精度で、切り捨てにより自分自身の直前の
  // 書き込みとすら一致しなくなる罠があるため。
  const row = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(articles)
      .where(and(eq(articles.id, id), isNull(articles.deletedAt)))
      .for('update');
    if (!current) throw new AppError('NOT_FOUND', '記事が見つかりません', 404);
    if (!can(editor, 'article:edit', { authorId: current.authorId })) {
      throw new AppError('FORBIDDEN', 'この記事を編集する権限がありません', 403);
    }
    if (current.updatedAt.toISOString() !== input.expectedUpdatedAt) {
      throw new AppError('CONFLICT', '別の場所で更新されています。読み込み直してください', 409);
    }
    if (current.status === 'published' && !input.categoryId) {
      throw new AppError('VALIDATION', '公開記事にはカテゴリの指定が必要です', 400);
    }
    const searchText = buildSearchText({ title: input.title, bodyMd: input.bodyMd, tags: input.tags });
    const [updated] = await tx
      .update(articles)
      .set({
        title: input.title,
        bodyMd: input.bodyMd,
        categoryId: input.categoryId ?? null,
        searchText,
        updatedAt: new Date(),
      })
      .where(eq(articles.id, id))
      .returning();
    await setArticleTags(tx, id, input.tags);
    await snapshot(tx, updated);
    return updated;
  });
  // 通知は best-effort のままトランザクションの外（Global Constraints）
  // 記事本文メンションは公開状態でのみ通知（draft 保存では通知しない）
  if (row.status === 'published') {
    await runNotify('article-mentions-update', () => notifyArticleMentions(db, row));
  }
  return row;
}

async function loadOwned(db: Db, id: string, editor: SessionUser): Promise<ArticleRecord> {
  const current = await loadEditable(db, id);
  if (!can(editor, 'article:edit', { authorId: current.authorId })) {
    throw new AppError('FORBIDDEN', 'この記事を操作する権限がありません', 403);
  }
  return current;
}

export async function publishArticle(db: Db, id: string, editor: SessionUser): Promise<ArticleRecord> {
  const current = await loadOwned(db, id, editor);
  if (!current.categoryId) {
    throw new AppError('VALIDATION', '公開にはカテゴリの指定が必要です', 400);
  }
  const [row] = await db
    .update(articles)
    .set({ status: 'published', publishedAt: current.publishedAt ?? new Date(), updatedAt: new Date() })
    .where(eq(articles.id, id))
    .returning();
  await runNotify('article-mentions-publish', () => notifyArticleMentions(db, row));
  return row;
}

export async function unpublishArticle(db: Db, id: string, editor: SessionUser): Promise<ArticleRecord> {
  await loadOwned(db, id, editor);
  const [row] = await db
    .update(articles)
    .set({ status: 'draft', pinnedAt: null, updatedAt: new Date() })
    .where(eq(articles.id, id))
    .returning();
  return row;
}

export async function softDeleteArticle(db: Db, id: string, editor: SessionUser): Promise<void> {
  await loadOwned(db, id, editor);
  await db.update(articles).set({ deletedAt: new Date(), pinnedAt: null }).where(eq(articles.id, id));
}

export async function restoreArticle(db: Db, id: string, editor: SessionUser): Promise<void> {
  const row = await db.query.articles.findFirst({ where: eq(articles.id, id) });
  if (!row) throw new AppError('NOT_FOUND', '記事が見つかりません', 404);
  if (!can(editor, 'article:edit', { authorId: row.authorId })) {
    throw new AppError('FORBIDDEN', 'この記事を操作する権限がありません', 403);
  }
  await db.update(articles).set({ deletedAt: null }).where(eq(articles.id, id));
}

export async function purgeArticle(db: Db, id: string, admin: SessionUser): Promise<void> {
  if (admin.role !== 'admin') throw new AppError('FORBIDDEN', '管理者権限が必要です', 403);
  const row = await db.query.articles.findFirst({ where: eq(articles.id, id) });
  if (!row) throw new AppError('NOT_FOUND', '記事が見つかりません', 404);
  if (!row.deletedAt) {
    throw new AppError('CONFLICT', 'ゴミ箱にある記事のみ完全削除できます', 409);
  }
  await db.delete(articles).where(eq(articles.id, id));
}

export async function setPinned(
  db: Db,
  id: string,
  admin: SessionUser,
  pinned: boolean,
): Promise<ArticleRecord> {
  if (!can(admin, 'article:pin')) throw new AppError('FORBIDDEN', 'ピン留めには管理者権限が必要です', 403);
  const current = await loadEditable(db, id);
  if (pinned && current.status !== 'published') {
    throw new AppError('VALIDATION', '公開記事のみピン留めできます', 400);
  }
  const [row] = await db
    .update(articles)
    .set({ pinnedAt: pinned ? new Date() : null })
    .where(eq(articles.id, id))
    .returning();
  return row;
}

export type ArticleListItem = {
  id: string;
  title: string;
  excerpt: string;
  authorId: string;
  authorName: string;
  categoryId: string | null;
  pinnedAt: Date | null;
  publishedAt: Date | null;
  updatedAt: Date;
};
export type Page<T> = { items: T[]; nextCursor: string | null };
export type ArticleDetail = ArticleRecord & { authorName: string; tags: string[] };

const LIST_COLUMNS = {
  id: articles.id,
  title: articles.title,
  excerpt: sql<string>`left(${articles.searchText}, 160)`,
  authorId: articles.authorId,
  authorName: users.displayName,
  categoryId: articles.categoryId,
  pinnedAt: articles.pinnedAt,
  publishedAt: articles.publishedAt,
  updatedAt: articles.updatedAt,
};

async function pagePublished(
  db: Db,
  extraWhere: ReturnType<typeof and>,
  page: { cursor?: string; limit: number },
): Promise<Page<ArticleListItem>> {
  const base = and(eq(articles.status, 'published'), isNull(articles.deletedAt), extraWhere);
  const where = page.cursor
    ? and(
        base,
        (() => {
          const c = decodeCursor(page.cursor!);
          return or(
            lt(articles.publishedAt, new Date(c.sortKey)),
            and(eq(articles.publishedAt, new Date(c.sortKey)), lt(articles.id, c.id)),
          );
        })(),
      )
    : base;
  const rows = await db
    .select(LIST_COLUMNS)
    .from(articles)
    .innerJoin(users, eq(articles.authorId, users.id))
    .where(where)
    .orderBy(desc(articles.publishedAt), desc(articles.id))
    .limit(page.limit + 1);
  const items = rows.slice(0, page.limit);
  const last = items[items.length - 1];
  const nextCursor = rows.length > page.limit ? encodeCursor(last.publishedAt, last.id) : null;
  return { items, nextCursor };
}

export function listFeed(db: Db, page: { cursor?: string; limit: number }) {
  return pagePublished(db, undefined, page);
}

export async function listPickup(db: Db): Promise<ArticleListItem[]> {
  return db
    .select(LIST_COLUMNS)
    .from(articles)
    .innerJoin(users, eq(articles.authorId, users.id))
    .where(and(eq(articles.status, 'published'), isNull(articles.deletedAt), sql`${articles.pinnedAt} is not null`))
    .orderBy(desc(articles.pinnedAt), desc(articles.id));
}

export async function listByCategory(db: Db, categoryId: string, page: { cursor?: string; limit: number }) {
  const children = await db.select({ id: categories.id }).from(categories).where(eq(categories.parentId, categoryId));
  const ids = [categoryId, ...children.map((c) => c.id)];
  return pagePublished(db, inArray(articles.categoryId, ids), page);
}

export async function listByTag(db: Db, tagName: string, page: { cursor?: string; limit: number }) {
  const ids = await db
    .select({ articleId: articleTags.articleId })
    .from(articleTags)
    .innerJoin(tags, eq(articleTags.tagId, tags.id))
    .where(eq(tags.name, tagName));
  const articleIds = ids.map((r) => r.articleId);
  if (articleIds.length === 0) return { items: [], nextCursor: null };
  return pagePublished(db, inArray(articles.id, articleIds), page);
}

export function listByAuthor(db: Db, authorId: string, page: { cursor?: string; limit: number }) {
  return pagePublished(db, eq(articles.authorId, authorId), page);
}

export async function listMine(
  db: Db,
  authorId: string,
  tab: 'draft' | 'published' | 'trash',
  page: { cursor?: string; limit: number },
): Promise<Page<ArticleListItem>> {
  const filter =
    tab === 'trash'
      ? and(eq(articles.authorId, authorId), sql`${articles.deletedAt} is not null`)
      : and(eq(articles.authorId, authorId), isNull(articles.deletedAt), eq(articles.status, tab));
  // articles.updatedAt は DB の now()（マイクロ秒精度）で入るが、カーソルは JS Date
  // （ミリ秒精度）で encode するため、WHERE と ORDER BY の両方で
  // date_trunc('milliseconds', ...) に丸めた同じキーを使う。丸めないと、同一 ms
  // バケット内で生タイムスタンプ順と id 順がずれる行がある場合に、次ページで
  // 一部の行が永久に欠落し得る（comment-service / engagement-service と同型のバグ）。
  const updatedAtMs = sql`date_trunc('milliseconds', ${articles.updatedAt})`;
  const where = page.cursor
    ? and(
        filter,
        (() => {
          const c = decodeCursor(page.cursor!);
          return or(
            sql`${updatedAtMs} < ${new Date(c.sortKey)}`,
            and(sql`${updatedAtMs} = ${new Date(c.sortKey)}`, lt(articles.id, c.id)),
          );
        })(),
      )
    : filter;
  const rows = await db
    .select(LIST_COLUMNS)
    .from(articles)
    .innerJoin(users, eq(articles.authorId, users.id))
    .where(where)
    .orderBy(desc(updatedAtMs), desc(articles.id))
    .limit(page.limit + 1);
  const items = rows.slice(0, page.limit);
  const last = items[items.length - 1];
  const nextCursor = rows.length > page.limit ? encodeCursor(last.updatedAt, last.id) : null;
  return { items, nextCursor };
}

export async function getArticleForViewer(
  db: Db,
  id: string,
  viewer: SessionUser,
): Promise<ArticleDetail> {
  const row = await db.query.articles.findFirst({ where: eq(articles.id, id) });
  if (!row) throw new AppError('NOT_FOUND', '記事が見つかりません', 404);
  const isOwnerOrAdmin = viewer.role === 'admin' || viewer.id === row.authorId;
  const visible = row.status === 'published' && !row.deletedAt;
  if (!visible && !isOwnerOrAdmin) throw new AppError('NOT_FOUND', '記事が見つかりません', 404);
  const [author] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, row.authorId));
  const tagNames = await getArticleTagNames(db, id);
  return { ...row, authorName: author?.name ?? '', tags: tagNames };
}

export async function listRevisions(db: Db, id: string, editor: SessionUser) {
  const row = await db.query.articles.findFirst({ where: eq(articles.id, id) });
  if (!row) throw new AppError('NOT_FOUND', '記事が見つかりません', 404);
  if (!can(editor, 'article:edit', { authorId: row.authorId })) {
    throw new AppError('FORBIDDEN', '権限がありません', 403);
  }
  return db
    .select({ id: articleRevisions.id, title: articleRevisions.title, savedAt: articleRevisions.savedAt })
    .from(articleRevisions)
    .where(eq(articleRevisions.articleId, id))
    .orderBy(desc(articleRevisions.savedAt));
}

// re-export（read/lifecycle タスクで同ファイルに追記される getArticleTagNames の橋渡し）
export { getArticleTagNames };
