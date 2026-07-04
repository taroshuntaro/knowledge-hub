import { and, eq, isNull } from 'drizzle-orm';
import type { SessionUser } from '@knowledge-hub/shared';
import { articleRevisions, articles } from '../db/schema';
import { AppError } from '../errors';
import type { Db } from '../types';
import { buildSearchText } from './markdown';
import { can } from './permissions';
import { getArticleTagNames, setArticleTags } from './tag-service';

export type ArticleRecord = typeof articles.$inferSelect;
export type ArticleInput = {
  title: string;
  bodyMd: string;
  categoryId?: string | null;
  tags: string[];
};

async function snapshot(db: Db, article: { id: string; title: string; bodyMd: string }) {
  await db.insert(articleRevisions).values({
    articleId: article.id,
    title: article.title,
    bodyMd: article.bodyMd,
  });
}

export async function createArticle(
  db: Db,
  authorId: string,
  input: ArticleInput,
): Promise<ArticleRecord> {
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
  const current = await loadEditable(db, id);
  if (!can(editor, 'article:edit', { authorId: current.authorId })) {
    throw new AppError('FORBIDDEN', 'この記事を編集する権限がありません', 403);
  }
  if (current.updatedAt.toISOString() !== input.expectedUpdatedAt) {
    throw new AppError('CONFLICT', '別の場所で更新されています。読み込み直してください', 409);
  }
  const searchText = buildSearchText({ title: input.title, bodyMd: input.bodyMd, tags: input.tags });
  const [row] = await db
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
  await setArticleTags(db, id, input.tags);
  await snapshot(db, row);
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

// re-export（read/lifecycle タスクで同ファイルに追記される getArticleTagNames の橋渡し）
export { getArticleTagNames };
