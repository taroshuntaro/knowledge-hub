import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { logger } from '../logger';
import type { AppEnv } from '../types';

// 構造化リクエストログ（§13）。ボディは出さない（パスワード等の漏洩防止）。
export const requestLogger: MiddlewareHandler<AppEnv> = async (c, next) => {
  const start = Date.now();
  const requestId = randomUUID();
  await next();
  // ログの requestId と突き合わせられるようにレスポンスにも返す（障害調査用）
  c.res.headers.set('X-Request-Id', requestId);
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
