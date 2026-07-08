import { Hono } from 'hono';
import { listQuerySchema } from '@knowledge-hub/shared';
import { requireAuth } from '../middleware/session';
import { validate } from '../middleware/validate';
import { countUnread, listNotifications, markAllRead, markRead } from '../services/notification-service';
import type { AppEnv } from '../types';
import { requireUuidParam } from './guards';

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
    requireUuidParam(c.req.param('notificationId'), '通知が見つかりません');
    await markRead(c.get('db'), c.get('user').id, c.req.param('notificationId'));
    return c.body(null, 204);
  });
