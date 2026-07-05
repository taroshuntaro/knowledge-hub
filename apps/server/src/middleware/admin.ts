import { createMiddleware } from 'hono/factory';
import { can, type Action } from '../services/permissions';
import type { AppEnv } from '../types';

export function requireCan(action: Action) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!can(c.get('user'), action)) {
      return c.json({ code: 'FORBIDDEN', message: 'この操作には管理者権限が必要です' }, 403);
    }
    await next();
  });
}
