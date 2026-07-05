import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@knowledge-hub/shared';
import { createTestCategory, createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import {
  createArticle, getArticleForViewer, listByCategory, listFeed, listMine, publishArticle,
} from './article-service';

const asUser = (id: string, role: 'member' | 'admin' = 'member'): SessionUser => ({
  id, email: 'x@example.com', displayName: 'X', role, avatarUrl: null, bio: '',
});

async function publishOne(ctx: { db: any }, authorId: string, categoryId: string, title: string) {
  const a = await createArticle(ctx.db, authorId, { title, bodyMd: '本文', categoryId, tags: [] });
  await publishArticle(ctx.db, a.id, asUser(authorId));
  return a;
}

describe('article read', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('フィードは公開記事のみを新しい順で返す', async () => {
    const u = await createTestUser(ctx.db);
    const c = await createTestCategory(ctx.db);
    await createArticle(ctx.db, u.id, { title: '下書き', bodyMd: '', categoryId: c.id, tags: [] });
    await publishOne(ctx, u.id, c.id, '公開1');
    await publishOne(ctx, u.id, c.id, '公開2');
    const page = await listFeed(ctx.db, { limit: 20 });
    expect(page.items.map((i) => i.title)).toEqual(['公開2', '公開1']);
  });

  it('カテゴリ一覧は子カテゴリの記事も含む', async () => {
    const u = await createTestUser(ctx.db);
    const parent = await createTestCategory(ctx.db, { name: '親' });
    const child = await createTestCategory(ctx.db, { name: '子', parentId: parent.id });
    await publishOne(ctx, u.id, child.id, '子の記事');
    const page = await listByCategory(ctx.db, parent.id, { limit: 20 });
    expect(page.items.map((i) => i.title)).toEqual(['子の記事']);
  });

  it('下書きは著者のみ閲覧可、他人は NOT_FOUND', async () => {
    const author = await createTestUser(ctx.db);
    const other = await createTestUser(ctx.db);
    const c = await createTestCategory(ctx.db);
    const a = await createArticle(ctx.db, author.id, { title: '秘密', bodyMd: '', categoryId: c.id, tags: [] });
    expect((await getArticleForViewer(ctx.db, a.id, asUser(author.id))).title).toBe('秘密');
    await expect(getArticleForViewer(ctx.db, a.id, asUser(other.id))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('カーソルページングで続きを取得できる', async () => {
    const u = await createTestUser(ctx.db);
    const c = await createTestCategory(ctx.db);
    for (let i = 0; i < 3; i++) await publishOne(ctx, u.id, c.id, `記事${i}`);
    const p1 = await listFeed(ctx.db, { limit: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await listFeed(ctx.db, { limit: 2, cursor: p1.nextCursor! });
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
  });

  it('listMine はカーソルで続きを取得でき重複しない', async () => {
    const u = await createTestUser(ctx.db);
    const c = await createTestCategory(ctx.db);
    for (let i = 0; i < 3; i++) {
      await createArticle(ctx.db, u.id, { title: `下書き${i}`, bodyMd: '', categoryId: c.id, tags: [] });
    }
    const p1 = await listMine(ctx.db, u.id, 'draft', { limit: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await listMine(ctx.db, u.id, 'draft', { limit: 2, cursor: p1.nextCursor! });
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    const allIds = [...p1.items, ...p2.items].map((i) => i.id);
    expect(new Set(allIds).size).toBe(3);
  });
});
