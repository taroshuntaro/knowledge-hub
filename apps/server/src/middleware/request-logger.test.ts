import { Hono } from 'hono';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../logger';
import { createTestApp } from '../test/helpers';
import type { AppEnv } from '../types';
import { requestLogger } from './request-logger';

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

  it('path はルートパターンでログし、URL 中の生トークンは含めない', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => logger);
    await ctx.app.request('/api/auth/password-reset/confirm/SECRET-TOKEN-123', {
      method: 'POST',
      body: JSON.stringify({ password: 'NewPassw0rd!' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/auth/password-reset/confirm/:token' }),
      'request',
    );
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain('SECRET-TOKEN-123');
  });

  it('レスポンスに X-Request-Id ヘッダ（UUID）を付与する', async () => {
    const app = new Hono<AppEnv>().use(requestLogger).get('/ping', (c) => c.text('ok'));
    const res = await app.request('/ping');
    const id = res.headers.get('X-Request-Id');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
