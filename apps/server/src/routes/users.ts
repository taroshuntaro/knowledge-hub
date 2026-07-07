import { Hono } from 'hono';
import { changePasswordSchema, listQuerySchema, updateProfileSchema } from '@knowledge-hub/shared';
import { requireAuth, setSessionCookie } from '../middleware/session';
import { validate } from '../middleware/validate';
import { listByAuthor } from '../services/article-service';
import { createSession } from '../services/session-service';
import {
  changePassword,
  getPublicProfile,
  listMentionCandidates,
  updateProfile,
} from '../services/user-service';
import type { AppEnv } from '../types';
import { requireUuidParam } from './guards';

export const userRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get('/', async (c) => c.json(await listMentionCandidates(c.get('db'))))
  .patch('/me', validate('json', updateProfileSchema), async (c) => {
    const updated = await updateProfile(c.get('db'), c.get('user').id, c.req.valid('json'));
    return c.json(updated);
  })
  .post('/me/password', validate('json', changePasswordSchema), async (c) => {
    const { currentPassword, newPassword } = c.req.valid('json');
    const userId = c.get('user').id;
    await changePassword(c.get('db'), userId, currentPassword, newPassword);
    const sid = await createSession(c.get('db'), userId);
    setSessionCookie(c, sid, c.get('config'));
    return c.body(null, 204);
  })
  .get('/:id', async (c) => c.json(await getPublicProfile(c.get('db'), c.req.param('id'))))
  .get('/:id/articles', validate('query', listQuerySchema), async (c) => {
    requireUuidParam(c.req.param('id'), 'ユーザーが見つかりません');
    return c.json(await listByAuthor(c.get('db'), c.req.param('id'), c.req.valid('query')));
  });
