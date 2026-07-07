import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { comments, notifications } from './schema';
import { createTestArticle, createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';

describe('notifications schema', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('挿入と取得ができ、readAt は null で始まる', async () => {
    const recipient = await createTestUser(ctx.db);
    const actor = await createTestUser(ctx.db);
    const article = await createTestArticle(ctx.db, { authorId: recipient.id });
    const [row] = await ctx.db
      .insert(notifications)
      .values({ recipientId: recipient.id, type: 'comment', actorId: actor.id, articleId: article.id })
      .returning();
    expect(row.readAt).toBeNull();
    expect(row.type).toBe('comment');
    expect(row.commentId).toBeNull();
  });

  it('コメント削除（物理）で通知が cascade 削除される', async () => {
    const recipient = await createTestUser(ctx.db);
    const actor = await createTestUser(ctx.db);
    const article = await createTestArticle(ctx.db, { authorId: recipient.id });
    const [comment] = await ctx.db
      .insert(comments)
      .values({ articleId: article.id, authorId: actor.id, bodyMd: 'hi' })
      .returning();
    await ctx.db.insert(notifications).values({
      recipientId: recipient.id, type: 'comment', actorId: actor.id,
      articleId: article.id, commentId: comment.id,
    });
    await ctx.db.delete(comments).where(eq(comments.id, comment.id));
    const rows = await ctx.db.select().from(notifications);
    expect(rows).toHaveLength(0);
  });
});
