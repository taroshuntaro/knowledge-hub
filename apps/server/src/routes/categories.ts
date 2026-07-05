import { Hono } from 'hono';
import {
  categoryCreateSchema, categoryDeleteSchema, categoryUpdateSchema, listQuerySchema,
} from '@knowledge-hub/shared';
import { requireCan } from '../middleware/admin';
import { requireAuth } from '../middleware/session';
import { validate } from '../middleware/validate';
import { listByCategory } from '../services/article-service';
import {
  createCategory, deleteCategory, listCategoryTree, updateCategory,
} from '../services/category-service';
import type { AppEnv } from '../types';

export const categoryRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get('/', async (c) => c.json(await listCategoryTree(c.get('db'))))
  .get('/:id/articles', validate('query', listQuerySchema), async (c) =>
    c.json(await listByCategory(c.get('db'), c.req.param('id'), c.req.valid('query'))),
  )
  .post('/', requireCan('category:manage'), validate('json', categoryCreateSchema), async (c) =>
    c.json(await createCategory(c.get('db'), c.req.valid('json'))),
  )
  .patch('/:id', requireCan('category:manage'), validate('json', categoryUpdateSchema), async (c) =>
    c.json(await updateCategory(c.get('db'), c.req.param('id'), c.req.valid('json'))),
  )
  .delete('/:id', requireCan('category:manage'), validate('json', categoryDeleteSchema), async (c) => {
    await deleteCategory(c.get('db'), c.req.param('id'), c.req.valid('json').reassignToId ?? null);
    return c.body(null, 204);
  });
