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

// re-export（read/lifecycle タスクで同ファイルに追記される getArticleTagNames の橋渡し）
export { getArticleTagNames };
