import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../logger';
import { createTestApp } from '../test/helpers';

describe('request logger', () => {
  const ctx = createTestApp();
  afterAll(() => ctx.pool.end());
  afterEach(() => vi.restoreAllMocks());

  it('リクエストごとに method/path/status/durationMs/requestId を info ログする', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => logger);
    await ctx.app.request('/healthz');
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/healthz',
        status: 200,
        durationMs: expect.any(Number),
        requestId: expect.any(String),
      }),
      'request',
    );
  });

  it('リクエストボディはログに含めない', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => logger);
    await ctx.app.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'x@example.com', password: 'super-secret-pw' }),
      headers: { 'content-type': 'application/json' },
    });
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain('super-secret-pw');
  });
});
