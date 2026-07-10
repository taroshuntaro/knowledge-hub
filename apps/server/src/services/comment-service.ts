import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { SessionUser } from '@knowledge-hub/shared';
import { comments, users } from '../db/schema';
import { AppError } from '../errors';
import type { Db } from '../types';
import { assertPublishedArticle } from './article-visibility';
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
/** mutation の戻り値・list の各ノードで共通の 1 件分（replies を持たない）。 */
export type CommentItem = Omit<CommentNode, 'replies'>;

function toItem(row: {
  id: string;
  articleId: string;
  authorId: string;
  authorName: string;
  parentId: string | null;
  bodyMd: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): CommentItem {
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
  };
}
function toNode(row: Parameters<typeof toItem>[0]): CommentNode {
  return { ...toItem(row), replies: [] };
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

/** mutation 後に list と同じ形（author JOIN 済み・可視性規則適用）で 1 件返す */
async function loadItem(db: Db, id: string): Promise<CommentItem> {
  const [row] = await db
    .select(COMMENT_COLUMNS)
    .from(comments)
    .innerJoin(users, eq(comments.authorId, users.id))
    .where(eq(comments.id, id));
  return toItem(row);
}

export async function createComment(
  db: Db,
  articleId: string,
  author: SessionUser,
  input: { bodyMd: string; parentId?: string },
): Promise<CommentItem> {
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

  return loadItem(db, row.id);
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
  // 返信は 1 階層のみで実運用では少数だが、防御上限として親ごとに最大 100 件に制限する
  // （超過分は切り捨て。無制限だと 1 親に大量返信を付けられた場合にレスポンスが際限なく肥大する）。
  const REPLIES_PER_PARENT_LIMIT = 100;
  const ranked = db
    .select({
      ...COMMENT_COLUMNS,
      rn: sql<number>`row_number() over (
        partition by ${comments.parentId}
        order by ${comments.createdAt} asc, ${comments.id} asc
      )`.as('rn'),
    })
    .from(comments)
    .innerJoin(users, eq(comments.authorId, users.id))
    .where(inArray(comments.parentId, topIds))
    .as('ranked');
  const replyRows = topIds.length
    ? await db
        .select()
        .from(ranked)
        .where(sql`${ranked.rn} <= ${REPLIES_PER_PARENT_LIMIT}`)
        .orderBy(asc(ranked.createdAt), asc(ranked.id))
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
): Promise<CommentItem> {
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
  return loadItem(db, row.id);
}

export async function deleteComment(db: Db, id: string, editor: SessionUser): Promise<void> {
  const current = await loadOwnComment(db, id);
  if (!can(editor, 'comment:delete', { authorId: current.authorId })) {
    throw new AppError('FORBIDDEN', 'このコメントを削除する権限がありません', 403);
  }
  await db.update(comments).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(comments.id, id));
}
