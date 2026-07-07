import { desc, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { articles, comments, notifications } from '../db/schema';
import { createTestArticle, createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import {
  countUnread,
  listNotifications,
  markAllRead,
  markRead,
  notifyArticleMentions,
  notifyCommentCreated,
  notifyCommentMentionsOnEdit,
  notifyReactionAdded,
} from './notification-service';

describe('notification-service 書き込み', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  async function setup() {
    const author = await createTestUser(ctx.db);
    const actor = await createTestUser(ctx.db);
    const article = await createTestArticle(ctx.db, {
      authorId: author.id, status: 'published', publishedAt: new Date(),
    });
    return { author, actor, article };
  }

  // notifications.commentId は comments テーブルへの実 FK。テストで notification を発生させる
  // ケースでは、実在する comment 行を用意してからその id を渡す必要がある。
  async function seedComment(articleId: string, authorId: string, bodyMd = 'seed') {
    const [row] = await ctx.db.insert(comments).values({ articleId, authorId, bodyMd }).returning();
    return row.id;
  }

  const all = () => ctx.db.select().from(notifications);

  describe('notifyCommentCreated', () => {
    it('他人の記事へのコメントで記事著者に comment 通知', async () => {
      const { author, actor, article } = await setup();
      const commentId = await seedComment(article.id, actor.id, 'hi');
      await notifyCommentCreated(ctx.db, {
        comment: { id: commentId, articleId: article.id, authorId: actor.id, bodyMd: 'hi', parentId: null },
        articleAuthorId: author.id,
        parentAuthorId: null,
      });
      const rows = await all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ recipientId: author.id, type: 'comment', actorId: actor.id });
    });

    it('自分の記事への自分のコメントは通知なし', async () => {
      const { author, article } = await setup();
      await notifyCommentCreated(ctx.db, {
        comment: { id: crypto.randomUUID(), articleId: article.id, authorId: author.id, bodyMd: 'memo', parentId: null },
        articleAuthorId: author.id,
        parentAuthorId: null,
      });
      expect(await all()).toHaveLength(0);
    });

    it('返信では親コメント著者に reply、記事著者に comment（別人の場合）', async () => {
      const { author, actor, article } = await setup();
      const parentAuthor = await createTestUser(ctx.db);
      const commentId = await seedComment(article.id, actor.id, 're');
      await notifyCommentCreated(ctx.db, {
        comment: { id: commentId, articleId: article.id, authorId: actor.id, bodyMd: 're', parentId: crypto.randomUUID() },
        articleAuthorId: author.id,
        parentAuthorId: parentAuthor.id,
      });
      const rows = await all();
      expect(rows).toHaveLength(2);
      const types = Object.fromEntries(rows.map((r) => [r.recipientId, r.type]));
      expect(types[author.id]).toBe('comment');
      expect(types[parentAuthor.id]).toBe('reply');
    });

    it('親コメント著者 = 記事著者なら reply 1 件のみ（受信者ごと最大 1 件、reply > comment）', async () => {
      const { author, actor, article } = await setup();
      const commentId = await seedComment(article.id, actor.id, 're');
      await notifyCommentCreated(ctx.db, {
        comment: { id: commentId, articleId: article.id, authorId: actor.id, bodyMd: 're', parentId: crypto.randomUUID() },
        articleAuthorId: author.id,
        parentAuthorId: author.id,
      });
      const rows = await all();
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe('reply');
    });

    it('記事著者へのメンション入りコメントは mention 1 件のみ（mention > comment）', async () => {
      const { author, actor, article } = await setup();
      const bodyMd1 = `[@著者](/users/${author.id}) 確認お願いします`;
      const commentId1 = await seedComment(article.id, actor.id, bodyMd1);
      await notifyCommentCreated(ctx.db, {
        comment: {
          id: commentId1, articleId: article.id, authorId: actor.id,
          bodyMd: bodyMd1, parentId: null,
        },
        articleAuthorId: author.id,
        parentAuthorId: null,
      });
      const rows = await all();
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe('mention');
    });

    it('第三者メンションは mention、実在しない UUID と inactive ユーザーは無視', async () => {
      const { author, actor, article } = await setup();
      const third = await createTestUser(ctx.db);
      const inactive = await createTestUser(ctx.db, { isActive: false });
      const ghost = crypto.randomUUID();
      const bodyMd2 = `[@a](/users/${third.id}) [@b](/users/${inactive.id}) [@c](/users/${ghost})`;
      const commentId2 = await seedComment(article.id, actor.id, bodyMd2);
      await notifyCommentCreated(ctx.db, {
        comment: {
          id: commentId2, articleId: article.id, authorId: actor.id,
          bodyMd: bodyMd2, parentId: null,
        },
        articleAuthorId: author.id,
        parentAuthorId: null,
      });
      const rows = await all();
      // author への comment + third への mention の 2 件
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.recipientId === third.id)?.type).toBe('mention');
    });

    it('自分自身へのメンションは通知なし', async () => {
      const { author, actor, article } = await setup();
      const bodyMd3 = `セルフ [@俺](/users/${actor.id})`;
      const commentId3 = await seedComment(article.id, actor.id, bodyMd3);
      await notifyCommentCreated(ctx.db, {
        comment: {
          id: commentId3, articleId: article.id, authorId: actor.id,
          bodyMd: bodyMd3, parentId: null,
        },
        articleAuthorId: author.id,
        parentAuthorId: null,
      });
      const rows = await all();
      expect(rows).toHaveLength(1); // author への comment のみ
      expect(rows[0].recipientId).toBe(author.id);
    });
  });

  describe('notifyCommentMentionsOnEdit', () => {
    it('編集で追加されたメンションは通知され、同一コメントで通知済みの相手には出ない', async () => {
      const { author, actor, article } = await setup();
      const third = await createTestUser(ctx.db);
      const commentId = await seedComment(article.id, actor.id, 'v1');
      // 作成時: author に comment 通知
      await notifyCommentCreated(ctx.db, {
        comment: { id: commentId, articleId: article.id, authorId: actor.id, bodyMd: 'v1', parentId: null },
        articleAuthorId: author.id,
        parentAuthorId: null,
      });
      // 編集で author と third をメンション
      await notifyCommentMentionsOnEdit(ctx.db, {
        id: commentId, articleId: article.id, authorId: actor.id,
        bodyMd: `[@著者](/users/${author.id}) [@三者](/users/${third.id})`,
      });
      const rows = await all();
      // author は作成時の comment 通知で通知済み → 追加なし。third の mention のみ増える。
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.recipientId === third.id)?.type).toBe('mention');
      // 再編集（同内容）→ 増えない
      await notifyCommentMentionsOnEdit(ctx.db, {
        id: commentId, articleId: article.id, authorId: actor.id,
        bodyMd: `[@著者](/users/${author.id}) [@三者](/users/${third.id})`,
      });
      expect(await all()).toHaveLength(2);
    });
  });

  describe('notifyReactionAdded', () => {
    it('記事著者に reaction 通知、自分の記事なら通知なし', async () => {
      const { author, actor, article } = await setup();
      await notifyReactionAdded(ctx.db, { actorId: actor.id, articleId: article.id, articleAuthorId: author.id });
      expect(await all()).toHaveLength(1);
      await notifyReactionAdded(ctx.db, { actorId: author.id, articleId: article.id, articleAuthorId: author.id });
      expect(await all()).toHaveLength(1);
    });

    it('同一 actor × 記事の未読 reaction 通知が残っている間は追加しない', async () => {
      const { author, actor, article } = await setup();
      await notifyReactionAdded(ctx.db, { actorId: actor.id, articleId: article.id, articleAuthorId: author.id });
      await notifyReactionAdded(ctx.db, { actorId: actor.id, articleId: article.id, articleAuthorId: author.id });
      expect(await all()).toHaveLength(1);
    });
  });

  describe('notifyArticleMentions', () => {
    it('本文メンションで通知し、再実行では同一受信者に再通知しない', async () => {
      const { author, article } = await setup();
      const third = await createTestUser(ctx.db);
      const body = `紹介 [@三者](/users/${third.id})`;
      await notifyArticleMentions(ctx.db, { id: article.id, authorId: author.id, bodyMd: body });
      expect(await all()).toHaveLength(1);
      await notifyArticleMentions(ctx.db, { id: article.id, authorId: author.id, bodyMd: body });
      expect(await all()).toHaveLength(1);
    });

    it('編集で追加されたメンションだけ新規通知される', async () => {
      const { author, article } = await setup();
      const a = await createTestUser(ctx.db);
      const b = await createTestUser(ctx.db);
      await notifyArticleMentions(ctx.db, { id: article.id, authorId: author.id, bodyMd: `[@a](/users/${a.id})` });
      await notifyArticleMentions(ctx.db, {
        id: article.id, authorId: author.id, bodyMd: `[@a](/users/${a.id}) [@b](/users/${b.id})`,
      });
      const rows = await all();
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((r) => r.recipientId))).toEqual(new Set([a.id, b.id]));
    });

    it('自分メンションのみなら通知なし', async () => {
      const { author, article } = await setup();
      await notifyArticleMentions(ctx.db, {
        id: article.id, authorId: author.id, bodyMd: `[@自分](/users/${author.id})`,
      });
      expect(await all()).toHaveLength(0);
    });
  });
});

describe('notification-service 読み取り', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  async function seed() {
    const me = await createTestUser(ctx.db);
    const actor = await createTestUser(ctx.db, { displayName: 'アクター' });
    const article = await createTestArticle(ctx.db, {
      authorId: me.id, title: '対象記事', status: 'published', publishedAt: new Date(),
    });
    return { me, actor, article };
  }

  it('自分宛の通知だけを新しい順に返し、actorName と articleTitle を含む', async () => {
    const { me, actor, article } = await seed();
    const other = await createTestUser(ctx.db);
    await ctx.db.insert(notifications).values([
      { recipientId: me.id, type: 'comment', actorId: actor.id, articleId: article.id },
      { recipientId: other.id, type: 'comment', actorId: actor.id, articleId: article.id },
    ]);
    const page = await listNotifications(ctx.db, me.id, { limit: 20 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      type: 'comment', actorName: 'アクター', articleTitle: '対象記事', articleId: article.id,
    });
  });

  it('カーソルページングが動作し、同一 ms 内の µs 差でも行が欠落しない', async () => {
    const { me, actor, article } = await seed();
    // 同一 ms・異 µs、かつ「µs が早い行ほど UUID が大きい」逆転を直接 insert して
    // 丸め漏れ（WHERE/ORDER BY 精度不一致）を決定的に検出する（3b と同じパターン）
    const bigId = '00000000-0000-4000-8000-00000000000a';
    const smallId = '00000000-0000-4000-8000-000000000001';
    await ctx.db.execute(sql`
      insert into notifications (id, recipient_id, type, actor_id, article_id, created_at) values
      (${bigId}, ${me.id}, 'comment', ${actor.id}, ${article.id}, '2026-01-01T00:00:00.000100Z'),
      (${smallId}, ${me.id}, 'reply', ${actor.id}, ${article.id}, '2026-01-01T00:00:00.000900Z')
    `);
    const page1 = await listNotifications(ctx.db, me.id, { limit: 1 });
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await listNotifications(ctx.db, me.id, { cursor: page1.nextCursor!, limit: 1 });
    const ids = [...page1.items, ...page2.items].map((n) => n.id);
    expect(new Set(ids)).toEqual(new Set([bigId, smallId]));
  });

  it('対象記事がゴミ箱 or 非公開なら一覧にも未読数にも出ない', async () => {
    const { me, actor, article } = await seed();
    await ctx.db.insert(notifications).values({
      recipientId: me.id, type: 'reaction', actorId: actor.id, articleId: article.id,
    });
    expect(await countUnread(ctx.db, me.id)).toBe(1);
    await ctx.db.update(articles).set({ deletedAt: new Date() }).where(sql`id = ${article.id}`);
    expect(await countUnread(ctx.db, me.id)).toBe(0);
    expect((await listNotifications(ctx.db, me.id, { limit: 20 })).items).toHaveLength(0);
  });

  it('markRead は自分の通知のみ既読化し、他人の id では何も起きない', async () => {
    const { me, actor, article } = await seed();
    const other = await createTestUser(ctx.db);
    const [mine] = await ctx.db.insert(notifications).values({
      recipientId: me.id, type: 'comment', actorId: actor.id, articleId: article.id,
    }).returning();
    const [theirs] = await ctx.db.insert(notifications).values({
      recipientId: other.id, type: 'comment', actorId: actor.id, articleId: article.id,
    }).returning();
    await markRead(ctx.db, me.id, mine.id);
    await markRead(ctx.db, me.id, theirs.id); // 他人のもの → no-op
    const rows = await ctx.db.select().from(notifications).orderBy(desc(notifications.createdAt));
    expect(rows.find((r) => r.id === mine.id)?.readAt).not.toBeNull();
    expect(rows.find((r) => r.id === theirs.id)?.readAt).toBeNull();
  });

  it('markAllRead で自分の未読が全て既読になり countUnread が 0 になる', async () => {
    const { me, actor, article } = await seed();
    await ctx.db.insert(notifications).values([
      { recipientId: me.id, type: 'comment', actorId: actor.id, articleId: article.id },
      { recipientId: me.id, type: 'reaction', actorId: actor.id, articleId: article.id },
    ]);
    expect(await countUnread(ctx.db, me.id)).toBe(2);
    await markAllRead(ctx.db, me.id);
    expect(await countUnread(ctx.db, me.id)).toBe(0);
  });
});
