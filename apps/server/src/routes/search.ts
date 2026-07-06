import { Hono } from 'hono';
import { searchQuerySchema } from '@knowledge-hub/shared';
import { requireAuth } from '../middleware/session';
import { validate } from '../middleware/validate';
import type { AppEnv } from '../types';

export const searchRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get('/', validate('query', searchQuerySchema), async (c) =>
    c.json(await c.get('search').search(c.get('db'), c.req.valid('query'))),
  );
