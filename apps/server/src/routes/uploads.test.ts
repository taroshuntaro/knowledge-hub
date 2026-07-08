import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { articles, users } from '../db/schema';
import { createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';

describe('upload routes', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  async function loginAs(email: string): Promise<string> {
    const res = await ctx.app.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
      headers: { 'content-type': 'application/json' },
    });
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  }

  async function login(): Promise<string> {
    await createTestUser(ctx.db, { email: 'a@example.com' });
    return loginAs('a@example.com');
  }

  async function upload(cookie: string): Promise<{ id: string; url: string }> {
    const fd = new FormData();
    fd.append('file', new File([PNG_BYTES], 'x.png', { type: 'image/png' }));
    const up = await ctx.app.request('/api/uploads', { method: 'POST', body: fd, headers: { cookie } });
    return up.json();
  }

  // 実際の PNG マジックバイト（\x89PNG\r\n\x1a\n）+ ダミーデータ
  const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

  it('画像をアップロードして取得できる', async () => {
    const cookie = await login();
    const fd = new FormData();
    fd.append('file', new File([PNG_BYTES], 'x.png', { type: 'image/png' }));
    const up = await ctx.app.request('/api/uploads', { method: 'POST', body: fd, headers: { cookie } });
    expect(up.status).toBe(200);
    const { id, url } = await up.json();
    expect(url).toBe(`/api/uploads/${id}`);
    const get = await ctx.app.request(url, { headers: { cookie } });
    expect(get.status).toBe(200);
    expect(get.headers.get('content-type')).toBe('image/png');
    expect(get.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('画像以外は 400', async () => {
    const cookie = await login();
    const fd = new FormData();
    fd.append('file', new File(['hello'], 'x.txt', { type: 'text/plain' }));
    const up = await ctx.app.request('/api/uploads', { method: 'POST', body: fd, headers: { cookie } });
    expect(up.status).toBe(400);
  });

  it('MIME が image/png でも中身が PNG でなければ 400', async () => {
    const cookie = await login();
    const fd = new FormData();
    fd.append('file', new File(['<html>not a png</html>'], 'x.png', { type: 'image/png' }));
    const up = await ctx.app.request('/api/uploads', { method: 'POST', body: fd, headers: { cookie } });
    expect(up.status).toBe(400);
    expect((await up.json()).code).toBe('VALIDATION');
  });

  it('未認証は 401', async () => {
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array([1])], 'x.png', { type: 'image/png' }));
    expect((await ctx.app.request('/api/uploads', { method: 'POST', body: fd })).status).toBe(401);
  });

  it('11MB超のファイルは 413', async () => {
    const cookie = await login();
    const fd = new FormData();
    const largeBuffer = new Uint8Array(11 * 1024 * 1024 + 1);
    largeBuffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    fd.append('file', new File([largeBuffer], 'large.png', { type: 'image/png' }));
    const up = await ctx.app.request('/api/uploads', { method: 'POST', body: fd, headers: { cookie } });
    expect(up.status).toBe(413);
    const result = await up.json();
    expect(result.code).toBe('VALIDATION');
  });

  it('GET /api/uploads/:id は malformed UUID で 404 を返す', async () => {
    const cookie = await login();
    const res = await ctx.app.request('/api/uploads/not-a-uuid', { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it('他ユーザーは公開文脈にない画像（ドラフトのヒーロー等）を取得できない（404）', async () => {
    const author = await createTestUser(ctx.db, { email: 'author@example.com' });
    const cookieA = await loginAs('author@example.com');
    const { id, url } = await upload(cookieA);

    await createTestUser(ctx.db, { email: 'other@example.com' });
    const cookieB = await loginAs('other@example.com');

    // 公開文脈がない状態では他人は取得不可
    expect((await ctx.app.request(url, { headers: { cookie: cookieB } })).status).toBe(404);

    // アップロード主体本人は取得可
    expect((await ctx.app.request(url, { headers: { cookie: cookieA } })).status).toBe(200);

    // ドラフト記事のヒーローに使っても他人はまだ取得不可
    const [draft] = await ctx.db
      .insert(articles)
      .values({ authorId: author.id, title: 'draft', heroImageUploadId: id, status: 'draft' })
      .returning();
    expect((await ctx.app.request(url, { headers: { cookie: cookieB } })).status).toBe(404);

    // 公開すると他人も取得可
    await ctx.db.update(articles).set({ status: 'published', publishedAt: new Date() }).where(eq(articles.id, draft.id));
    expect((await ctx.app.request(url, { headers: { cookie: cookieB } })).status).toBe(200);
  });

  it('admin は他人のドラフト画像も取得できる', async () => {
    await createTestUser(ctx.db, { email: 'author2@example.com' });
    const cookieA = await loginAs('author2@example.com');
    const { url } = await upload(cookieA);

    await createTestUser(ctx.db, { email: 'admin@example.com', role: 'admin' });
    const cookieAdmin = await loginAs('admin@example.com');
    expect((await ctx.app.request(url, { headers: { cookie: cookieAdmin } })).status).toBe(200);
  });

  it('アバターとして参照される画像は他ユーザーも取得できる', async () => {
    const owner = await createTestUser(ctx.db, { email: 'avatar-owner@example.com' });
    const cookieOwner = await loginAs('avatar-owner@example.com');
    const { id, url } = await upload(cookieOwner);
    await ctx.db.update(users).set({ avatarUrl: `/api/uploads/${id}` }).where(eq(users.id, owner.id));

    await createTestUser(ctx.db, { email: 'viewer@example.com' });
    const cookieViewer = await loginAs('viewer@example.com');
    expect((await ctx.app.request(url, { headers: { cookie: cookieViewer } })).status).toBe(200);
  });
});
