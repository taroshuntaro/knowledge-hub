import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';

describe('upload routes', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  async function login(): Promise<string> {
    await createTestUser(ctx.db, { email: 'a@example.com' });
    const res = await ctx.app.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@example.com', password: TEST_PASSWORD }),
      headers: { 'content-type': 'application/json' },
    });
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
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
});
