import { and, eq, inArray, isNull } from 'drizzle-orm';
import { notifications, users } from '../db/schema';
import type { Db } from '../types';
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

export async function notifyCommentMentionsOnEdit(
  db: Db,
  comment: { id: string; articleId: string; authorId: string; bodyMd: string },
): Promise<void> {
  const recipients = await resolveMentionRecipients(db, comment.bodyMd, comment.authorId);
  if (recipients.length === 0) return;
  // このコメントで既に通知（種別問わず・既読含む）済みの相手には再通知しない
  const existing = await db
    .select({ recipientId: notifications.recipientId })
    .from(notifications)
    .where(and(eq(notifications.commentId, comment.id), inArray(notifications.recipientId, recipients)));
  const notified = new Set(existing.map((r) => r.recipientId));
  const fresh = recipients.filter((id) => !notified.has(id));
  if (fresh.length === 0) return;
  await db.insert(notifications).values(
    fresh.map((recipientId) => ({
      recipientId,
      type: 'mention' as const,
      actorId: comment.authorId,
      articleId: comment.articleId,
      commentId: comment.id,
    })),
  );
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
  const recipients = await resolveMentionRecipients(db, article.bodyMd, article.authorId);
  if (recipients.length === 0) return;
  // 同一記事で既に本文メンション通知（既読含む）済みの相手には再通知しない
  const existing = await db
    .select({ recipientId: notifications.recipientId })
    .from(notifications)
    .where(
      and(
        eq(notifications.articleId, article.id),
        eq(notifications.type, 'mention'),
        isNull(notifications.commentId),
        inArray(notifications.recipientId, recipients),
      ),
    );
  const notified = new Set(existing.map((r) => r.recipientId));
  const fresh = recipients.filter((id) => !notified.has(id));
  if (fresh.length === 0) return;
  await db.insert(notifications).values(
    fresh.map((recipientId) => ({
      recipientId,
      type: 'mention' as const,
      actorId: article.authorId,
      articleId: article.id,
    })),
  );
}
