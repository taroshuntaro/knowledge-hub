import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { SessionUser } from '@knowledge-hub/shared';
import { articles, comments, users } from '../db/schema';
import { AppError } from '../errors';
import type { Db } from '../types';
import { decodeCursor, encodeCursor, type Page } from './cursor';
import { notifyCommentCreated, notifyCommentMentionsOnEdit, runNotify } from './notification-service';
import { can } from './permissions';

export type CommentRecord = typeof comments.$inferSelect;

export type CommentNode = {
  id: string;
  articleId: string;
  authorId: string;
  authorName: string;
  parentId: string | null;
  bodyMd: string | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
  replies: CommentNode[];
};


/**
 * 対象記事が公開・未削除であることを確認する。draft / 削除済み / 不在は NOT_FOUND。
 * create/list の両方から呼ばれる（Task 4 も同様に利用する）。見つかった記事行を返す。
 */
export async function assertPublishedArticle(db: Db, articleId: string) {
  const row = await db.query.articles.findFirst({ where: eq(articles.id, articleId) });
  if (!row || row.status !== 'published' || row.deletedAt) {
    throw new AppError('NOT_FOUND', '記事が見つかりません', 404);
  }
  return row;
}

function toNode(row: {
  id: string;
  articleId: string;
  authorId: string;
  authorName: string;
  parentId: string | null;
  bodyMd: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): CommentNode {
  const isDeleted = row.deletedAt !== null;
  return {
    id: row.id,
    articleId: row.articleId,
    authorId: row.authorId,
    authorName: row.authorName,
    parentId: row.parentId,
    bodyMd: isDeleted ? null : row.bodyMd,
    isDeleted,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    replies: [],
  };
}

const COMMENT_COLUMNS = {
  id: comments.id,
  articleId: comments.articleId,
  authorId: comments.authorId,
  authorName: users.displayName,
  parentId: comments.parentId,
  bodyMd: comments.bodyMd,
  deletedAt: comments.deletedAt,
  createdAt: comments.createdAt,
  updatedAt: comments.updatedAt,
};

export async function createComment(
  db: Db,
  articleId: string,
  author: SessionUser,
  input: { bodyMd: string; parentId?: string },
): Promise<CommentRecord> {
  const article = await assertPublishedArticle(db, articleId);

  let parent: CommentRecord | null = null;
  if (input.parentId) {
    parent = (await db.query.comments.findFirst({ where: eq(comments.id, input.parentId) })) ?? null;
    if (!parent || parent.articleId !== articleId || parent.parentId !== null || parent.deletedAt !== null) {
      throw new AppError('VALIDATION', '返信先のコメントが不正です', 400);
    }
  }

  const [row] = await db
    .insert(comments)
    .values({
      articleId,
      authorId: author.id,
      parentId: input.parentId ?? null,
      bodyMd: input.bodyMd,
    })
    .returning();

  await runNotify('comment-created', () =>
    notifyCommentCreated(db, {
      comment: row,
      articleAuthorId: article.authorId,
      parentAuthorId: parent?.authorId ?? null,
    }),
  );

  return row;
}

export async function listComments(
  db: Db,
  articleId: string,
  page: { cursor?: string; limit: number },
): Promise<Page<CommentNode>> {
  await assertPublishedArticle(db, articleId);

  const base = and(eq(comments.articleId, articleId), isNull(comments.parentId));
  // comments.createdAt は DB の now() で挿入され、JS の Date（ミリ秒精度）より細かい精度
  // （マイクロ秒）を持ちうる。カーソルはミリ秒精度で encode するため、比較側も
  // date_trunc('milliseconds', ...) で丸めてから比較しないと、同一行が「自分自身より
  // 後」と誤判定されて次ページに重複して現れる。
  // ORDER BY も同じ丸め済みキーを使わないと、WHERE のキーセット境界（丸め済み ms, id）と
  // フェッチ順（生のマイクロ秒, id）がずれて、同一 ms バケット内で raw タイムスタンプが
  // 早いが id が大きい行がある場合、id が小さい行が次ページ以降で永久に欠落しうる。
  const createdAtMs = sql`date_trunc('milliseconds', ${comments.createdAt})`;
  const where = page.cursor
    ? and(
        base,
        (() => {
          const c = decodeCursor(page.cursor!);
          const cursorDate = new Date(c.sortKey);
          return or(
            sql`${createdAtMs} > ${cursorDate}`,
            and(sql`${createdAtMs} = ${cursorDate}`, gt(comments.id, c.id)),
          );
        })(),
      )
    : base;

  const rows = await db
    .select(COMMENT_COLUMNS)
    .from(comments)
    .innerJoin(users, eq(comments.authorId, users.id))
    .where(where)
    .orderBy(createdAtMs, asc(comments.id))
    .limit(page.limit + 1);

  const topRows = rows.slice(0, page.limit);
  const nextCursor =
    rows.length > page.limit
      ? encodeCursor(topRows[topRows.length - 1].createdAt, topRows[topRows.length - 1].id)
      : null;

  const topIds = topRows.map((r) => r.id);
  const replyRows = topIds.length
    ? await db
        .select(COMMENT_COLUMNS)
        .from(comments)
        .innerJoin(users, eq(comments.authorId, users.id))
        .where(inArray(comments.parentId, topIds))
        .orderBy(asc(comments.createdAt), asc(comments.id))
    : [];

  const items = topRows.map((row) => {
    const node = toNode(row);
    node.replies = replyRows.filter((r) => r.parentId === row.id).map((r) => toNode(r));
    return node;
  });

  return { items, nextCursor };
}

async function loadOwnComment(db: Db, id: string): Promise<CommentRecord> {
  const row = await db.query.comments.findFirst({ where: eq(comments.id, id) });
  if (!row) throw new AppError('NOT_FOUND', 'コメントが見つかりません', 404);
  return row;
}

export async function updateComment(
  db: Db,
  id: string,
  editor: SessionUser,
  input: { bodyMd: string },
): Promise<CommentRecord> {
  const current = await loadOwnComment(db, id);
  // 論理削除（モデレート削除）済みコメントは編集不可。編集で mention 通知を
  // 再送してモデレーションを回避する経路を塞ぐ。
  if (current.deletedAt !== null) {
    throw new AppError('NOT_FOUND', 'コメントが見つかりません', 404);
  }
  if (!can(editor, 'comment:edit', { authorId: current.authorId })) {
    throw new AppError('FORBIDDEN', 'このコメントを編集する権限がありません', 403);
  }
  const [row] = await db
    .update(comments)
    .set({ bodyMd: input.bodyMd, updatedAt: new Date() })
    .where(eq(comments.id, id))
    .returning();
  await runNotify('comment-mentions-edit', () => notifyCommentMentionsOnEdit(db, row));
  return row;
}

export async function deleteComment(db: Db, id: string, editor: SessionUser): Promise<void> {
  const current = await loadOwnComment(db, id);
  if (!can(editor, 'comment:delete', { authorId: current.authorId })) {
    throw new AppError('FORBIDDEN', 'このコメントを削除する権限がありません', 403);
  }
  await db.update(comments).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(comments.id, id));
}
