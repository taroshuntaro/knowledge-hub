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

  it('画像をアップロードして取得できる', async () => {
    const cookie = await login();
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' }));
    const up = await ctx.app.request('/api/uploads', { method: 'POST', body: fd, headers: { cookie } });
    expect(up.status).toBe(200);
    const { id, url } = await up.json();
    expect(url).toBe(`/api/uploads/${id}`);
    const get = await ctx.app.request(url, { headers: { cookie } });
    expect(get.status).toBe(200);
    expect(get.headers.get('content-type')).toBe('image/png');
  });

  it('画像以外は 400', async () => {
    const cookie = await login();
    const fd = new FormData();
    fd.append('file', new File(['hello'], 'x.txt', { type: 'text/plain' }));
    const up = await ctx.app.request('/api/uploads', { method: 'POST', body: fd, headers: { cookie } });
    expect(up.status).toBe(400);
  });

  it('未認証は 401', async () => {
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array([1])], 'x.png', { type: 'image/png' }));
    expect((await ctx.app.request('/api/uploads', { method: 'POST', body: fd })).status).toBe(401);
  });
});
