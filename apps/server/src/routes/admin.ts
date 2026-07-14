import { Hono } from 'hono';
import { createMasterSchema, inviteSchema, updateMasterSchema, updateUserByAdminSchema } from '@knowledge-hub/shared';
import { requireCan } from '../middleware/admin';
import { requireAuth } from '../middleware/session';
import { validate } from '../middleware/validate';
import { createInvitation } from '../services/invitation-service';
import {
  createDepartment, createPosition, deleteDepartment, deletePosition,
  listDepartments, listPositions, updateDepartment, updatePosition,
} from '../services/master-service';
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
  })
  .get('/departments', async (c) => c.json(await listDepartments(c.get('db'))))
  .post('/departments', validate('json', createMasterSchema), async (c) =>
    c.json(await createDepartment(c.get('db'), c.req.valid('json').name), 201))
  .patch('/departments/:id', validate('json', updateMasterSchema), async (c) => {
    requireUuidParam(c.req.param('id'), '所属が見つかりません');
    return c.json(await updateDepartment(c.get('db'), c.req.param('id'), c.req.valid('json')));
  })
  .delete('/departments/:id', async (c) => {
    requireUuidParam(c.req.param('id'), '所属が見つかりません');
    await deleteDepartment(c.get('db'), c.req.param('id'));
    return c.body(null, 204);
  })
  .get('/positions', async (c) => c.json(await listPositions(c.get('db'))))
  .post('/positions', validate('json', createMasterSchema), async (c) =>
    c.json(await createPosition(c.get('db'), c.req.valid('json').name), 201))
  .patch('/positions/:id', validate('json', updateMasterSchema), async (c) => {
    requireUuidParam(c.req.param('id'), '役職が見つかりません');
    return c.json(await updatePosition(c.get('db'), c.req.param('id'), c.req.valid('json')));
  })
  .delete('/positions/:id', async (c) => {
    requireUuidParam(c.req.param('id'), '役職が見つかりません');
    await deletePosition(c.get('db'), c.req.param('id'));
    return c.body(null, 204);
  });
