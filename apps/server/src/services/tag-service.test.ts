import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestArticle } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { getArticleTagNames, setArticleTags, upsertTags } from './tag-service';

describe('tag service', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('upsertTags は既存タグを再利用し重複を作らない', async () => {
    const a = await upsertTags(ctx.db, ['AWS', 'AWS', ' AWS ']);
    expect(a).toHaveLength(1);
    const b = await upsertTags(ctx.db, ['AWS', 'React']);
    expect(b).toHaveLength(2);
    expect(a[0].id).toBe(b.find((t) => t.name === 'AWS')!.id);
  });

  it('setArticleTags は記事のタグ集合を置換する', async () => {
    const art = await createTestArticle(ctx.db);
    await setArticleTags(ctx.db, art.id, ['AWS', 'React']);
    expect((await getArticleTagNames(ctx.db, art.id)).sort()).toEqual(['AWS', 'React']);
    await setArticleTags(ctx.db, art.id, ['React', 'Vue']);
    expect((await getArticleTagNames(ctx.db, art.id)).sort()).toEqual(['React', 'Vue']);
  });
});
