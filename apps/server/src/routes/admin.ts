import { Hono } from 'hono';
import { inviteSchema, updateUserByAdminSchema } from '@knowledge-hub/shared';
import { requireCan } from '../middleware/admin';
import { requireAuth } from '../middleware/session';
import { validate } from '../middleware/validate';
import { createInvitation } from '../services/invitation-service';
import { listUsers, updateUserByAdmin } from '../services/user-service';
import type { AppEnv } from '../types';
import { requireUuidParam } from './guards';

export const adminRoutes = new Hono<AppEnv>()
  .use(requireAuth, requireCan('user:manage'))
  .get('/users', async (c) => c.json(await listUsers(c.get('db'))))
  .post('/users/invitations', validate('json', inviteSchema), async (c) => {
    await createInvitation(c.get('db'), c.get('mailer'), c.get('config'), c.req.valid('json').email);
    return c.body(null, 204);
  })
  .patch('/users/:id', validate('json', updateUserByAdminSchema), async (c) => {
    requireUuidParam(c.req.param('id'), 'ユーザーが見つかりません');
    const updated = await updateUserByAdmin(c.get('db'), c.req.param('id'), c.req.valid('json'));
    return c.json(updated);
  });
