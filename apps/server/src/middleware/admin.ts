import { createMiddleware } from 'hono/factory';
import { can } from '../services/permissions';
import type { AppEnv } from '../types';

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!can(c.get('user'), 'user:manage')) {
    return c.json({ code: 'FORBIDDEN', message: 'この操作には管理者権限が必要です' }, 403);
  }
  await next();
});
