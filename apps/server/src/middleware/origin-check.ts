import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../types';

export const originCheck = createMiddleware<AppEnv>(async (c, next) => {
  const method = c.req.method;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const origin = c.req.header('origin');
    if (origin && origin !== new URL(c.get('config').appUrl).origin) {
      return c.json({ code: 'FORBIDDEN', message: '不正なリクエスト元です' }, 403);
    }
  }
  await next();
});
