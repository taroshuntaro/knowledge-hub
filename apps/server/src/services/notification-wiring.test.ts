import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@knowledge-hub/shared';
import { notifications, users } from '../db/schema';
import { createTestArticle, createTestCategory, createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { publishArticle, updateArticle } from './article-service';
import { createComment, updateComment } from './comment-service';
import { addBookmark, addReaction, removeBookmark, removeReaction } from './engagement-service';

function asSession(u: typeof users.$inferSelect): SessionUser {
  return { id: u.id, email: u.email, displayName: u.displayName, role: u.role, avatarUrl: u.avatarUrl, bio: u.bio };
}

describe('通知の seam 配線', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  const all = () => ctx.db.select().from(notifications);

  async function setup() {
    const author = await createTestUser(ctx.db);
    const actor = await createTestUser(ctx.db);
    const article = await createTestArticle(ctx.db, {
      authorId: author.id, status: 'published', publishedAt: new Date(),
    });
    return { author, actor, article };
  }

  it('createComment: 記事著者に comment 通知が入る', async () => {
    const { author, actor, article } = await setup();
    await createComment(ctx.db, article.id, asSession(actor), { bodyMd: 'こんにちは' });
    const rows = await all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipientId: author.id, type: 'comment', actorId: actor.id });
    expect(rows[0].commentId).not.toBeNull();
  });

  it('createComment: 返信で親コメント著者に reply 通知が入る', async () => {
    const { actor, article } = await setup();
    const parentAuthor = await createTestUser(ctx.db);
    const parent = await createComment(ctx.db, article.id, asSession(parentAuthor), { bodyMd: '親' });
    await ctx.db.delete(notifications); // 親作成分をクリア
    await createComment(ctx.db, article.id, asSession(actor), { bodyMd: '返信', parentId: parent.id });
    const rows = await all();
    expect(rows.find((r) => r.recipientId === parentAuthor.id)?.type).toBe('reply');
  });

  it('updateComment: 編集で追加したメンションが通知される', async () => {
    const { actor, article } = await setup();
    const third = await createTestUser(ctx.db);
    const comment = await createComment(ctx.db, article.id, asSession(actor), { bodyMd: 'v1' });
    await ctx.db.delete(notifications);
    await updateComment(ctx.db, comment.id, asSession(actor), {
      bodyMd: `v2 [@三者](/users/${third.id})`,
    });
    const rows = await all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipientId: third.id, type: 'mention', commentId: comment.id });
  });

  it('addReaction: 記事著者に reaction 通知。既存リアクションへの再 POST（conflict）では増えない', async () => {
    const { author, actor, article } = await setup();
    await addReaction(ctx.db, actor.id, article.id, '👍');
    expect(await all()).toHaveLength(1);
    await addReaction(ctx.db, actor.id, article.id, '👍'); // conflict → insert なし → 通知なし
    expect(await all()).toHaveLength(1);
  });

  it('addReaction: 外して付け直しても未読が残っていれば増えない', async () => {
    const { actor, article } = await setup();
    await addReaction(ctx.db, actor.id, article.id, '👍');
    await removeReaction(ctx.db, actor.id, article.id, '👍');
    await addReaction(ctx.db, actor.id, article.id, '👍');
    expect(await all()).toHaveLength(1);
  });

  it('ブックマークの追加・削除は通知を一切生成しない', async () => {
    const { actor, article } = await setup();
    await addBookmark(ctx.db, actor.id, article.id);
    await removeBookmark(ctx.db, actor.id, article.id);
    expect(await all()).toHaveLength(0);
  });

  it('自分の記事への自分のコメント・リアクションは通知なし', async () => {
    const { author, article } = await setup();
    await createComment(ctx.db, article.id, asSession(author), { bodyMd: 'セルフ' });
    await addReaction(ctx.db, author.id, article.id, '👍');
    expect(await all()).toHaveLength(0);
  });

  it('publishArticle: 本文メンションが publish 時に通知される（draft 保存では通知されない）', async () => {
    const author = await createTestUser(ctx.db);
    const third = await createTestUser(ctx.db);
    const cat = await createTestCategory(ctx.db);
    const draft = await createTestArticle(ctx.db, {
      authorId: author.id, categoryId: cat.id, status: 'draft',
      bodyMd: `紹介 [@三者](/users/${third.id})`,
    });
    expect(await all()).toHaveLength(0); // draft 作成では通知なし
    await publishArticle(ctx.db, draft.id, asSession(author));
    const rows = await all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipientId: third.id, type: 'mention', articleId: draft.id });
    expect(rows[0].commentId).toBeNull();
  });

  it('updateArticle: published 記事の編集で追加メンションのみ通知、draft の編集では通知なし', async () => {
    const author = await createTestUser(ctx.db);
    const a = await createTestUser(ctx.db);
    const b = await createTestUser(ctx.db);
    const cat = await createTestCategory(ctx.db);
    const article = await createTestArticle(ctx.db, {
      authorId: author.id, categoryId: cat.id, status: 'published', publishedAt: new Date(),
      bodyMd: `[@a](/users/${a.id})`,
    });

    await updateArticle(ctx.db, article.id, asSession(author), {
      title: article.title,
      bodyMd: `[@a](/users/${a.id}) [@b](/users/${b.id})`,
      categoryId: cat.id,
      tags: [],
      expectedUpdatedAt: article.updatedAt.toISOString(),
    });
    const rows = await all();
    // dedupe（通知済み受信者のスキップ）自体の検証は Task 3 で済んでいる。
    // ここでは published 記事の update が通知経路に乗ることを確認する。
    expect(new Set(rows.map((r) => r.recipientId))).toEqual(new Set([a.id, b.id]));

    // draft の編集では通知されない
    const draftArt = await createTestArticle(ctx.db, {
      authorId: author.id, categoryId: cat.id, status: 'draft', bodyMd: '',
    });
    await ctx.db.delete(notifications);
    await updateArticle(ctx.db, draftArt.id, asSession(author), {
      title: 'd', bodyMd: `[@a](/users/${a.id})`, categoryId: cat.id, tags: [],
      expectedUpdatedAt: draftArt.updatedAt.toISOString(),
    });
    expect(await all()).toHaveLength(0);
  });
});
