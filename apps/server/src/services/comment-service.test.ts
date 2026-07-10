import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@knowledge-hub/shared';
import { comments } from '../db/schema';
import { createTestArticle, createTestCategory, createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { publishArticle } from './article-service';
import {
  createComment, deleteComment, listComments, updateComment,
} from './comment-service';

const asUser = (id: string, role: 'member' | 'admin' = 'member'): SessionUser => ({
  id, email: 'x@example.com', displayName: 'X', role, avatarUrl: null, bio: '', authProvider: 'password',
});

describe('comment service', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  async function publishedArticle() {
    const author = await createTestUser(ctx.db);
    const category = await createTestCategory(ctx.db, { name: `テック-${randomUUID()}` });
    const article = await createTestArticle(ctx.db, { authorId: author.id, categoryId: category.id });
    return publishArticle(ctx.db, article.id, asUser(author.id));
  }

  it('1. トップレベルコメントを作成 → 一覧に出る（bodyMd・authorName 含む）', async () => {
    const article = await publishedArticle();
    const commenter = await createTestUser(ctx.db, { displayName: 'コメント太郎' });
    await createComment(ctx.db, article.id, asUser(commenter.id), { bodyMd: 'はじめまして' });
    const page = await listComments(ctx.db, article.id, { limit: 10 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].bodyMd).toBe('はじめまして');
    expect(page.items[0].authorName).toBe('コメント太郎');
    expect(page.items[0].isDeleted).toBe(false);
  });

  it('2. 返信を作成（parentId = トップレベル）→ そのトップレベルの replies に入る', async () => {
    const article = await publishedArticle();
    const commenter = await createTestUser(ctx.db);
    const replier = await createTestUser(ctx.db);
    const top = await createComment(ctx.db, article.id, asUser(commenter.id), { bodyMd: '親コメント' });
    await createComment(ctx.db, article.id, asUser(replier.id), { bodyMd: '返信です', parentId: top.id });
    const page = await listComments(ctx.db, article.id, { limit: 10 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].replies).toHaveLength(1);
    expect(page.items[0].replies[0].bodyMd).toBe('返信です');
    expect(page.items[0].replies[0].parentId).toBe(top.id);
  });

  it('3. 返信への返信を拒否（VALIDATION 400）', async () => {
    const article = await publishedArticle();
    const commenter = await createTestUser(ctx.db);
    const top = await createComment(ctx.db, article.id, asUser(commenter.id), { bodyMd: '親' });
    const reply = await createComment(ctx.db, article.id, asUser(commenter.id), { bodyMd: '子', parentId: top.id });
    await expect(
      createComment(ctx.db, article.id, asUser(commenter.id), { bodyMd: '孫', parentId: reply.id }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('4. 他記事のコメントを parent に指定して拒否（VALIDATION 400）', async () => {
    const article1 = await publishedArticle();
    const article2 = await publishedArticle();
    const commenter = await createTestUser(ctx.db);
    const topOfArticle1 = await createComment(ctx.db, article1.id, asUser(commenter.id), { bodyMd: '記事1の親' });
    await expect(
      createComment(ctx.db, article2.id, asUser(commenter.id), {
        bodyMd: '記事2への返信のつもり', parentId: topOfArticle1.id,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('5. 下書き記事へのコメント作成を拒否（NOT_FOUND 404）／不在記事も 404', async () => {
    const author = await createTestUser(ctx.db);
    const draft = await createTestArticle(ctx.db, { authorId: author.id });
    const commenter = await createTestUser(ctx.db);
    await expect(
      createComment(ctx.db, draft.id, asUser(commenter.id), { bodyMd: '下書きへのコメント' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      createComment(ctx.db, '00000000-0000-0000-0000-000000000000', asUser(commenter.id), { bodyMd: 'なし' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('6. コメント編集（作成者）→ bodyMd 更新・updatedAt が進む', async () => {
    const article = await publishedArticle();
    const commenter = await createTestUser(ctx.db);
    const created = await createComment(ctx.db, article.id, asUser(commenter.id), { bodyMd: '元の本文' });
    await new Promise((r) => setTimeout(r, 5));
    const updated = await updateComment(ctx.db, created.id, asUser(commenter.id), { bodyMd: '更新後の本文' });
    expect(updated.bodyMd).toBe('更新後の本文');
    expect(updated.updatedAt.getTime()).toBeGreaterThan(created.createdAt.getTime());
  });

  it('7. 他人のコメントを編集しようとして拒否（FORBIDDEN 403）', async () => {
    const article = await publishedArticle();
    const commenter = await createTestUser(ctx.db);
    const other = await createTestUser(ctx.db);
    const created = await createComment(ctx.db, article.id, asUser(commenter.id), { bodyMd: '本文' });
    await expect(
      updateComment(ctx.db, created.id, asUser(other.id), { bodyMd: '書き換え' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('8. コメント削除（作成者）→ 一覧には残るが bodyMd: null, isDeleted: true、replies は保持', async () => {
    const article = await publishedArticle();
    const commenter = await createTestUser(ctx.db);
    const replier = await createTestUser(ctx.db);
    const top = await createComment(ctx.db, article.id, asUser(commenter.id), { bodyMd: '削除される親' });
    await createComment(ctx.db, article.id, asUser(replier.id), { bodyMd: '残る返信', parentId: top.id });
    await deleteComment(ctx.db, top.id, asUser(commenter.id));
    const page = await listComments(ctx.db, article.id, { limit: 10 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].bodyMd).toBeNull();
    expect(page.items[0].isDeleted).toBe(true);
    expect(page.items[0].replies).toHaveLength(1);
    expect(page.items[0].replies[0].bodyMd).toBe('残る返信');
  });

  it('削除済みコメントへの返信は拒否される（VALIDATION 400）', async () => {
    const article = await publishedArticle();
    const commenter = await createTestUser(ctx.db);
    const replier = await createTestUser(ctx.db);
    const top = await createComment(ctx.db, article.id, asUser(commenter.id), { bodyMd: '親' });
    await deleteComment(ctx.db, top.id, asUser(commenter.id));
    await expect(
      createComment(ctx.db, article.id, asUser(replier.id), { bodyMd: '返信', parentId: top.id }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('削除済みコメントの編集は拒否される（NOT_FOUND 404）', async () => {
    const article = await publishedArticle();
    const commenter = await createTestUser(ctx.db);
    const created = await createComment(ctx.db, article.id, asUser(commenter.id), { bodyMd: '本文' });
    await deleteComment(ctx.db, created.id, asUser(commenter.id));
    await expect(
      updateComment(ctx.db, created.id, asUser(commenter.id), { bodyMd: '復活' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('9. admin は他人のコメントを削除できる（isDeleted: true になる）', async () => {
    const article = await publishedArticle();
    const commenter = await createTestUser(ctx.db);
    const admin = await createTestUser(ctx.db, { role: 'admin' });
    const top = await createComment(ctx.db, article.id, asUser(commenter.id), { bodyMd: '本文' });
    await deleteComment(ctx.db, top.id, asUser(admin.id, 'admin'));
    const page = await listComments(ctx.db, article.id, { limit: 10 });
    expect(page.items[0].isDeleted).toBe(true);
    expect(page.items[0].bodyMd).toBeNull();
  });

  it('10. member は他人のコメントを削除できない（FORBIDDEN 403）', async () => {
    const article = await publishedArticle();
    const commenter = await createTestUser(ctx.db);
    const other = await createTestUser(ctx.db);
    const top = await createComment(ctx.db, article.id, asUser(commenter.id), { bodyMd: '本文' });
    await expect(
      deleteComment(ctx.db, top.id, asUser(other.id)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('11. カーソルページング: トップレベルを limit=1 で 2 ページ取得、古い順・重複なし', async () => {
    const article = await publishedArticle();
    const commenter = await createTestUser(ctx.db);
    const first = await createComment(ctx.db, article.id, asUser(commenter.id), { bodyMd: '1件目' });
    await new Promise((r) => setTimeout(r, 5));
    const second = await createComment(ctx.db, article.id, asUser(commenter.id), { bodyMd: '2件目' });

    const page1 = await listComments(ctx.db, article.id, { limit: 1 });
    expect(page1.items).toHaveLength(1);
    expect(page1.items[0].id).toBe(first.id);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listComments(ctx.db, article.id, { limit: 1, cursor: page1.nextCursor! });
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0].id).toBe(second.id);
    expect(page2.nextCursor).toBeNull();
  });

  it('12. カーソルページング: 同一ミリ秒バケット内でマイクロ秒順と id 順が逆でも欠落・重複なし', async () => {
    const article = await publishedArticle();
    const commenter = await createTestUser(ctx.db);

    // 決定論的にスキップのバグ条件を再現する:
    // 2 行の createdAt を「同一ミリ秒バケット内でマイクロ秒だけ異なる」値に固定し、
    // かつ「生タイムスタンプが早い方の id を大きく」する。
    // 旧 ORDER BY（asc(createdAt), asc(id)）は生のマイクロ秒順でフェッチするため
    // page1 で earlyRow を返し、cursor.id = earlyRow.id（大）。次ページの WHERE は
    // id > earlyRow.id を要求するので id の小さい lateRow が永久に欠落する。
    // 修正後は ORDER BY も date_trunc('milliseconds', ...) を使うため id 昇順で並び、
    // 両行が取得できる。
    // JS の Date はミリ秒精度しか持てないので、マイクロ秒差は生 SQL リテラルで注入する。
    const [smallId, largeId] = [randomUUID(), randomUUID()].sort();
    // 早い生タイムスタンプ（.000100）に大きい id を割り当てる = スキップを誘発する並び。
    const earlyId = largeId;
    const lateId = smallId;
    await ctx.db.insert(comments).values([
      {
        id: earlyId,
        articleId: article.id,
        authorId: commenter.id,
        parentId: null,
        bodyMd: '早いμ秒・大きい id',
        createdAt: sql`'2026-01-01 00:00:00.000100+00'::timestamptz`,
      },
      {
        id: lateId,
        articleId: article.id,
        authorId: commenter.id,
        parentId: null,
        bodyMd: '遅いμ秒・小さい id',
        createdAt: sql`'2026-01-01 00:00:00.000900+00'::timestamptz`,
      },
    ]);
    const expectedIds = new Set([earlyId, lateId]);

    const page1 = await listComments(ctx.db, article.id, { limit: 1 });
    expect(page1.items).toHaveLength(1);

    const seenIds = [page1.items[0].id];
    let nextCursor = page1.nextCursor;
    while (nextCursor) {
      const page = await listComments(ctx.db, article.id, { limit: 1, cursor: nextCursor });
      expect(page.items).toHaveLength(1);
      seenIds.push(page.items[0].id);
      nextCursor = page.nextCursor;
    }

    // 欠落なし・重複なし: 見えた id 集合が両 id と厳密一致し、合計 2 件。
    expect(seenIds).toHaveLength(2);
    expect(new Set(seenIds)).toEqual(expectedIds);
  });

  it('replies は親コメント 1 件につき最大 100 件に制限される', async () => {
    const article = await publishedArticle();
    const commenter = await createTestUser(ctx.db);
    const parent = await createComment(ctx.db, article.id, asUser(commenter.id), { bodyMd: 'parent' });
    await ctx.db.insert(comments).values(
      Array.from({ length: 101 }, (_, i) => ({
        articleId: article.id,
        authorId: commenter.id,
        parentId: parent.id,
        bodyMd: `reply-${i}`,
      })),
    );
    const page = await listComments(ctx.db, article.id, { limit: 20 });
    const node = page.items.find((n) => n.id === parent.id)!;
    expect(node.replies).toHaveLength(100);
  });
});
