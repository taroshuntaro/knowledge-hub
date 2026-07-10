import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { articles, notifications, users } from '../db/schema';
import { logger } from '../logger';
import type { Db } from '../types';
import { publishedArticleWhere } from './article-visibility';
import { decodeCursor, encodeCursor, type Page } from './cursor';
import { extractMentionedUserIds } from './mention';

export type NotificationRecord = typeof notifications.$inferSelect;

/** 本文中のメンション UUID を実在するアクティブユーザーに絞り込む（actor 本人は除外） */
async function resolveMentionRecipients(db: Db, bodyMd: string, actorId: string): Promise<string[]> {
  const ids = extractMentionedUserIds(bodyMd).filter((id) => id !== actorId);
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.isActive, true)));
  return rows.map((r) => r.id);
}

export async function notifyCommentCreated(
  db: Db,
  input: {
    comment: { id: string; articleId: string; authorId: string; bodyMd: string; parentId: string | null };
    articleAuthorId: string;
    parentAuthorId: string | null;
  },
): Promise<void> {
  const actorId = input.comment.authorId;
  // 1 イベントにつき受信者ごとに最大 1 通知。後から set する種別が勝つ（mention > reply > comment）
  const byRecipient = new Map<string, 'comment' | 'reply' | 'mention'>();
  if (input.articleAuthorId !== actorId) byRecipient.set(input.articleAuthorId, 'comment');
  if (input.parentAuthorId && input.parentAuthorId !== actorId) byRecipient.set(input.parentAuthorId, 'reply');
  for (const id of await resolveMentionRecipients(db, input.comment.bodyMd, actorId)) {
    byRecipient.set(id, 'mention');
  }
  if (byRecipient.size === 0) return;
  await db.insert(notifications).values(
    [...byRecipient].map(([recipientId, type]) => ({
      recipientId,
      type,
      actorId,
      articleId: input.comment.articleId,
      commentId: input.comment.id,
    })),
  );
}

/**
 * 本文メンションのうち、notifiedScope 内で通知済み（種別・既読問わず）の相手を除いて
 * mention 通知を insert する共通処理。comment 編集と記事公開/更新で共有。
 */
async function notifyFreshMentions(
  db: Db,
  input: {
    bodyMd: string;
    actorId: string;
    articleId: string;
    commentId: string | null;
    notifiedScope: SQL;
  },
): Promise<void> {
  const recipients = await resolveMentionRecipients(db, input.bodyMd, input.actorId);
  if (recipients.length === 0) return;
  const existing = await db
    .select({ recipientId: notifications.recipientId })
    .from(notifications)
    .where(and(input.notifiedScope, inArray(notifications.recipientId, recipients)));
  const notified = new Set(existing.map((r) => r.recipientId));
  const fresh = recipients.filter((id) => !notified.has(id));
  if (fresh.length === 0) return;
  await db.insert(notifications).values(
    fresh.map((recipientId) => ({
      recipientId,
      type: 'mention' as const,
      actorId: input.actorId,
      articleId: input.articleId,
      ...(input.commentId ? { commentId: input.commentId } : {}),
    })),
  );
}

export async function notifyCommentMentionsOnEdit(
  db: Db,
  comment: { id: string; articleId: string; authorId: string; bodyMd: string },
): Promise<void> {
  // このコメントで既に通知（種別問わず・既読含む）済みの相手には再通知しない
  await notifyFreshMentions(db, {
    bodyMd: comment.bodyMd,
    actorId: comment.authorId,
    articleId: comment.articleId,
    commentId: comment.id,
    notifiedScope: eq(notifications.commentId, comment.id),
  });
}

export async function notifyReactionAdded(
  db: Db,
  input: { actorId: string; articleId: string; articleAuthorId: string },
): Promise<void> {
  if (input.articleAuthorId === input.actorId) return;
  // トグル連打のスパム防止: 同一 actor × 記事の未読 reaction 通知が残っていれば追加しない
  const existing = await db.query.notifications.findFirst({
    where: and(
      eq(notifications.recipientId, input.articleAuthorId),
      eq(notifications.type, 'reaction'),
      eq(notifications.actorId, input.actorId),
      eq(notifications.articleId, input.articleId),
      isNull(notifications.readAt),
    ),
  });
  if (existing) return;
  await db.insert(notifications).values({
    recipientId: input.articleAuthorId,
    type: 'reaction',
    actorId: input.actorId,
    articleId: input.articleId,
  });
}

export async function notifyArticleMentions(
  db: Db,
  article: { id: string; authorId: string; bodyMd: string },
): Promise<void> {
  // 同一記事で既に本文メンション通知（既読含む）済みの相手には再通知しない
  await notifyFreshMentions(db, {
    bodyMd: article.bodyMd,
    actorId: article.authorId,
    articleId: article.id,
    commentId: null,
    notifiedScope: and(
      eq(notifications.articleId, article.id),
      eq(notifications.type, 'mention'),
      isNull(notifications.commentId),
    )!,
  });
}

export type NotificationItem = {
  id: string;
  type: 'comment' | 'reply' | 'reaction' | 'mention';
  actorId: string;
  actorName: string;
  articleId: string;
  articleTitle: string;
  commentId: string | null;
  readAt: Date | null;
  createdAt: Date;
};

export async function listNotifications(
  db: Db,
  userId: string,
  page: { cursor?: string; limit: number },
): Promise<Page<NotificationItem>> {
  const base = and(eq(notifications.recipientId, userId), publishedArticleWhere());
  // created_at は DB の now()（µs 精度）、カーソルは JS Date（ms 精度）。WHERE と ORDER BY の
  // 両方で同じ date_trunc('milliseconds', ...) キーを使わないと同一 ms バケット内で行が
  // 永久欠落しうる（comment/bookmark カーソルと同じ確立パターン）。
  const createdAtMs = sql`date_trunc('milliseconds', ${notifications.createdAt})`;
  const where = page.cursor
    ? and(
        base,
        (() => {
          const c = decodeCursor(page.cursor!);
          const cursorDate = new Date(c.sortKey);
          return or(
            sql`${createdAtMs} < ${cursorDate}`,
            and(sql`${createdAtMs} = ${cursorDate}`, lt(notifications.id, c.id)),
          );
        })(),
      )
    : base;

  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      actorId: notifications.actorId,
      actorName: users.displayName,
      articleId: notifications.articleId,
      articleTitle: articles.title,
      commentId: notifications.commentId,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .innerJoin(users, eq(notifications.actorId, users.id))
    .innerJoin(articles, eq(notifications.articleId, articles.id))
    .where(where)
    .orderBy(desc(createdAtMs), desc(notifications.id))
    .limit(page.limit + 1);

  const items = rows.slice(0, page.limit);
  const last = items[items.length - 1];
  const nextCursor = rows.length > page.limit ? encodeCursor(last.createdAt, last.id) : null;
  return { items, nextCursor };
}

export async function countUnread(db: Db, userId: string): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .innerJoin(articles, eq(notifications.articleId, articles.id))
    .where(and(eq(notifications.recipientId, userId), isNull(notifications.readAt), publishedArticleWhere()));
  return count;
}

export async function markRead(db: Db, userId: string, id: string): Promise<void> {
  // 自分の未読のみ更新。他人の id・既読済みは no-op（204 のまま、存在オラクルなし）
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.recipientId, userId), isNull(notifications.readAt)));
}

export async function markAllRead(db: Db, userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.recipientId, userId), isNull(notifications.readAt)));
}

// 通知生成は副次機能: 失敗しても中核操作（コメント/リアクション/公開）を巻き込まない。
// トランザクションでは囲まず、失敗は警告ログに記録して握り潰す（best-effort）。
export async function runNotify(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logger.warn({ err, notification: label }, 'notification generation failed');
  }
}
