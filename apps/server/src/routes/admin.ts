import type { Context } from 'hono';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  adminCreateUserSchema,
  createMasterSchema,
  deactivateUsersSchema,
  issueRegistrationCodeSchema,
  updateMasterSchema,
  updateUserByAdminSchema,
} from '@knowledge-hub/shared';
import { AppError } from '../errors';
import { requireCan } from '../middleware/admin';
import { requireAuth } from '../middleware/session';
import { validate } from '../middleware/validate';
import {
  createDepartment, createPosition, deleteDepartment, deletePosition,
  listDepartments, listPositions, updateDepartment, updatePosition,
} from '../services/master-service';
import {
  getActiveCodeMeta,
  issueRegistrationCode,
  revokeActiveCode,
} from '../services/registration-code-service';
import {
  deactivateUsers, deletePendingUser, listUsers, unclaimUser, updateUserByAdmin,
} from '../services/user-service';
import { importUserDeactivations } from '../services/user-deactivation-import';
import { importUserOrg } from '../services/user-import-service';
import { createPendingUser, importUserRegistrations } from '../services/user-provision-service';
import type { AppEnv } from '../types';
import { requireUuidParam } from './guards';

const csvBodyLimit = bodyLimit({
  maxSize: 5 * 1024 * 1024,
  onError: (c) => c.json({ code: 'VALIDATION', message: 'ファイルサイズが大きすぎます（上限5MB）' }, 413),
});

async function readCsvFile(c: Context<AppEnv>): Promise<string> {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) {
    throw new AppError('VALIDATION', 'CSV ファイルを file フィールドで指定してください', 400);
  }
  return file.text();
}

export const adminRoutes = new Hono<AppEnv>()
  .use(requireAuth, requireCan('user:manage'))
  .get('/registration-code', async (c) => c.json(await getActiveCodeMeta(c.get('db'))))
  .post('/registration-code', validate('json', issueRegistrationCodeSchema), async (c) =>
    c.json(await issueRegistrationCode(c.get('db'), c.req.valid('json').expiresInDays), 201))
  .delete('/registration-code', async (c) => {
    await revokeActiveCode(c.get('db'));
    return c.body(null, 204);
  })
  .get('/users', async (c) => c.json(await listUsers(c.get('db'))))
  .post('/users', validate('json', adminCreateUserSchema), async (c) =>
    c.json(await createPendingUser(c.get('db'), c.req.valid('json')), 201))
  .post('/users/registrations/import', csvBodyLimit, async (c) => {
    const result = await importUserRegistrations(c.get('db'), await readCsvFile(c));
    if (!result.ok) {
      return c.json(
        { code: 'CSV_IMPORT_FAILED' as const, message: 'CSV にエラーがあります', details: result.errors },
        400,
      );
    }
    const { ok: _ok, ...summary } = result;
    return c.json(summary);
  })
  .post('/users/deactivate', validate('json', deactivateUsersSchema), async (c) =>
    c.json(await deactivateUsers(c.get('db'), c.req.valid('json').userIds)))
  .post('/users/deactivate/import', csvBodyLimit, async (c) => {
    const result = await importUserDeactivations(c.get('db'), await readCsvFile(c));
    if (!result.ok) {
      return c.json(
        { code: 'CSV_IMPORT_FAILED' as const, message: 'CSV にエラーがあります', details: result.errors },
        400,
      );
    }
    const { ok: _ok, ...summary } = result;
    return c.json(summary);
  })
  .patch('/users/:id', validate('json', updateUserByAdminSchema), async (c) => {
    requireUuidParam(c.req.param('id'), 'ユーザーが見つかりません');
    const updated = await updateUserByAdmin(c.get('db'), c.req.param('id'), c.req.valid('json'));
    return c.json(updated);
  })
  .post('/users/import', csvBodyLimit, async (c) => {
    const result = await importUserOrg(c.get('db'), await readCsvFile(c));
    if (!result.ok) {
      return c.json(
        { code: 'CSV_IMPORT_FAILED' as const, message: 'CSV にエラーがあります', details: result.errors },
        400,
      );
    }
    const { ok: _ok, ...summary } = result;
    return c.json(summary);
  })
  .delete('/users/:id', async (c) => {
    requireUuidParam(c.req.param('id'), 'ユーザーが見つかりません');
    await deletePendingUser(c.get('db'), c.req.param('id'));
    return c.body(null, 204);
  })
  .post('/users/:id/unclaim', async (c) => {
    requireUuidParam(c.req.param('id'), 'ユーザーが見つかりません');
    return c.json(await unclaimUser(c.get('db'), c.req.param('id')));
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
