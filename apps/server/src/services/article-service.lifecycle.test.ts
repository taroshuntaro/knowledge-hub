import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@knowledge-hub/shared';
import { createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import {
  createArticle, publishArticle, setPinned, softDeleteArticle, unpublishArticle,
} from './article-service';

const asUser = (id: string, role: 'member' | 'admin' = 'member'): SessionUser => ({
  id, email: 'x@example.com', displayName: 'X', role, avatarUrl: null, bio: '',
});

describe('article lifecycle', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('カテゴリ未設定の公開は VALIDATION', async () => {
    const u = await createTestUser(ctx.db);
    const a = await createArticle(ctx.db, u.id, { title: 't', bodyMd: '', tags: [] });
    await expect(publishArticle(ctx.db, a.id, asUser(u.id))).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('公開すると published_at が入り、ピンできる', async () => {
    const u = await createTestUser(ctx.db);
    const admin = await createTestUser(ctx.db, { role: 'admin' });
    const cat = (await import('../test/factories')).createTestCategory;
    const c = await cat(ctx.db);
    const a = await createArticle(ctx.db, u.id, { title: 't', bodyMd: '', categoryId: c.id, tags: [] });
    const pub = await publishArticle(ctx.db, a.id, asUser(u.id));
    expect(pub.status).toBe('published');
    expect(pub.publishedAt).not.toBeNull();
    const pinned = await setPinned(ctx.db, a.id, asUser(admin.id, 'admin'), true);
    expect(pinned.pinnedAt).not.toBeNull();
  });

  it('非公開化でピンが自動解除される', async () => {
    const u = await createTestUser(ctx.db);
    const admin = await createTestUser(ctx.db, { role: 'admin' });
    const c = await (await import('../test/factories')).createTestCategory(ctx.db);
    const a = await createArticle(ctx.db, u.id, { title: 't', bodyMd: '', categoryId: c.id, tags: [] });
    await publishArticle(ctx.db, a.id, asUser(u.id));
    await setPinned(ctx.db, a.id, asUser(admin.id, 'admin'), true);
    const back = await unpublishArticle(ctx.db, a.id, asUser(u.id));
    expect(back.status).toBe('draft');
    expect(back.pinnedAt).toBeNull();
  });

  it('未公開記事はピンできない（VALIDATION）', async () => {
    const u = await createTestUser(ctx.db);
    const admin = await createTestUser(ctx.db, { role: 'admin' });
    const a = await createArticle(ctx.db, u.id, { title: 't', bodyMd: '', tags: [] });
    await expect(setPinned(ctx.db, a.id, asUser(admin.id, 'admin'), true)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('削除でピン自動解除・deletedAt 設定', async () => {
    const u = await createTestUser(ctx.db);
    const admin = await createTestUser(ctx.db, { role: 'admin' });
    const c = await (await import('../test/factories')).createTestCategory(ctx.db);
    const a = await createArticle(ctx.db, u.id, { title: 't', bodyMd: '', categoryId: c.id, tags: [] });
    await publishArticle(ctx.db, a.id, asUser(u.id));
    await setPinned(ctx.db, a.id, asUser(admin.id, 'admin'), true);
    await softDeleteArticle(ctx.db, a.id, asUser(u.id));
    const row = await ctx.db.query.articles.findFirst({
      where: (t, { eq }) => eq(t.id, a.id),
    });
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.pinnedAt).toBeNull();
  });
});
