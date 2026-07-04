import { afterAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../test/helpers';

describe('GET /healthz', () => {
  const ctx = createTestApp();
  afterAll(() => ctx.pool.end());

  it('DB 接続込みで 200 を返す', async () => {
    const res = await ctx.app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
