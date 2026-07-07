import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { logger } from '../logger';
import type { AppEnv } from '../types';

// 構造化リクエストログ（§13）。ボディは出さない（パスワード等の漏洩防止）。
export const requestLogger: MiddlewareHandler<AppEnv> = async (c, next) => {
  const start = Date.now();
  const requestId = randomUUID();
  await next();
  logger.info(
    {
      requestId,
      method: c.req.method,
      path: c.req.routePath,
      status: c.res.status,
      durationMs: Date.now() - start,
    },
    'request',
  );
};
