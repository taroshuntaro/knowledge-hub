import { Hono } from 'hono';
import { changePasswordSchema, updateProfileSchema } from '@knowledge-hub/shared';
import { requireAuth, setSessionCookie } from '../middleware/session';
import { validate } from '../middleware/validate';
import { createSession } from '../services/session-service';
import { changePassword, updateProfile } from '../services/user-service';
import type { AppEnv } from '../types';

export const userRoutes = new Hono<AppEnv>()
  .use(requireAuth)
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
  });
