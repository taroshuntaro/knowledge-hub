import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@knowledge-hub/shared';
import { articles } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createTestArticle, createTestCategory } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import {
  createCategory,
  deleteCategory,
  listCategoryTree,
} from './category-service';
import { publishArticle, softDeleteArticle } from './article-service';

const asUser = (id: string, role: 'member' | 'admin' = 'member'): SessionUser => ({
  id, email: 'x@example.com', displayName: 'X', role, avatarUrl: null, bio: '', authProvider: 'password',
});

describe('category service', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('親子を作成しツリーで返す', async () => {
    const parent = await createCategory(ctx.db, { name: 'テック' });
    await createCategory(ctx.db, { name: 'フロントエンド', parentId: parent.id });
    const tree = await listCategoryTree(ctx.db);
    expect(tree).toHaveLength(1);
    expect(tree[0].children.map((c) => c.name)).toEqual(['フロントエンド']);
  });

  it('深さ3（孫）は VALIDATION で拒否', async () => {
    const parent = await createCategory(ctx.db, { name: 'テック' });
    const child = await createCategory(ctx.db, { name: 'フロント', parentId: parent.id });
    await expect(
      createCategory(ctx.db, { name: 'React', parentId: child.id }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('子カテゴリがあると削除不可（CATEGORY_NOT_EMPTY）', async () => {
    const parent = await createCategory(ctx.db, { name: 'テック' });
    await createCategory(ctx.db, { name: '子', parentId: parent.id });
    await expect(deleteCategory(ctx.db, parent.id)).rejects.toMatchObject({
      code: 'CATEGORY_NOT_EMPTY',
    });
  });

  it('記事があり reassignToId 未指定は CATEGORY_NOT_EMPTY', async () => {
    const cat = await createTestCategory(ctx.db, { name: 'A' });
    await createTestArticle(ctx.db, { categoryId: cat.id });
    await expect(deleteCategory(ctx.db, cat.id)).rejects.toMatchObject({
      code: 'CATEGORY_NOT_EMPTY',
    });
  });

  it('reassignToId 指定で記事を付け替えて削除できる', async () => {
    const from = await createTestCategory(ctx.db, { name: 'From' });
    const to = await createTestCategory(ctx.db, { name: 'To' });
    const art = await createTestArticle(ctx.db, { categoryId: from.id });
    await deleteCategory(ctx.db, from.id, to.id);
    const [moved] = await ctx.db.select().from(articles).where(eq(articles.id, art.id));
    expect(moved.categoryId).toBe(to.id);
    expect(await listCategoryTree(ctx.db)).toHaveLength(1);
  });

  it('子も記事もないカテゴリは reassignToId なしで削除できる', async () => {
    const cat = await createTestCategory(ctx.db, { name: '空カテゴリ' });
    await deleteCategory(ctx.db, cat.id);
    expect(await listCategoryTree(ctx.db)).toHaveLength(0);
  });

  it('ゴミ箱の記事のみ残るカテゴリは reassignToId なしで削除できる', async () => {
    const cat = await createTestCategory(ctx.db, { name: 'ゴミ箱カテゴリ' });
    const art = await createTestArticle(ctx.db, { categoryId: cat.id });
    await publishArticle(ctx.db, art.id, asUser(art.authorId));
    await softDeleteArticle(ctx.db, art.id, asUser(art.authorId));
    await expect(deleteCategory(ctx.db, cat.id)).resolves.not.toThrow();
    expect(await listCategoryTree(ctx.db)).toHaveLength(0);
  });
});
