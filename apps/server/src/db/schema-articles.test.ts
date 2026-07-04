import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { articles } from './schema';
import { createTestArticle, createTestCategory } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';

describe('article schema', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('記事を挿入でき、既定は draft・deletedAt は null', async () => {
    const cat = await createTestCategory(ctx.db);
    const a = await createTestArticle(ctx.db, { categoryId: cat.id });
    expect(a.status).toBe('draft');
    expect(a.deletedAt).toBeNull();
    const rows = await ctx.db.select().from(articles);
    expect(rows).toHaveLength(1);
  });
});
