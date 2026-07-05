import { Hono } from 'hono';
import { listQuerySchema } from '@knowledge-hub/shared';
import { requireAuth } from '../middleware/session';
import { validate } from '../middleware/validate';
import { listByTag } from '../services/article-service';
import { listPopularTags } from '../services/tag-service';
import type { AppEnv } from '../types';

export const tagRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get('/popular', async (c) => c.json(await listPopularTags(c.get('db'))))
  .get('/:name/articles', validate('query', listQuerySchema), async (c) =>
    c.json(await listByTag(c.get('db'), c.req.param('name'), c.req.valid('query'))),
  );
