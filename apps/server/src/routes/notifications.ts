import { Hono } from 'hono';
import { z } from 'zod';
import { listQuerySchema } from '@knowledge-hub/shared';
import { AppError } from '../errors';
import { requireAuth } from '../middleware/session';
import { validate } from '../middleware/validate';
import { countUnread, listNotifications, markAllRead, markRead } from '../services/notification-service';
import type { AppEnv } from '../types';

function requireValidNotificationId(id: string): void {
  // 不正な UUID 形式は DB エラー（500）ではなく NOT_FOUND として扱う
  if (!z.string().uuid().safeParse(id).success) {
    throw new AppError('NOT_FOUND', '通知が見つかりません', 404);
  }
}

export const notificationRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get('/', validate('query', listQuerySchema), async (c) =>
    c.json(await listNotifications(c.get('db'), c.get('user').id, c.req.valid('query'))))
  .get('/unread-count', async (c) =>
    c.json({ count: await countUnread(c.get('db'), c.get('user').id) }))
  .post('/read-all', async (c) => {
    await markAllRead(c.get('db'), c.get('user').id);
    return c.body(null, 204);
  })
  .post('/:notificationId/read', async (c) => {
    requireValidNotificationId(c.req.param('notificationId'));
    await markRead(c.get('db'), c.get('user').id, c.req.param('notificationId'));
    return c.body(null, 204);
  });
