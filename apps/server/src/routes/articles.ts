import { Hono } from 'hono';
import { z } from 'zod';
import { createArticleSchema, listQuerySchema, updateArticleSchema } from '@knowledge-hub/shared';
import { requireAuth } from '../middleware/session';
import { validate } from '../middleware/validate';
import {
  createArticle, getArticleForViewer, listFeed, listMine, listPickup,
  publishArticle, purgeArticle, restoreArticle, setPinned, softDeleteArticle,
  updateArticle, unpublishArticle,
} from '../services/article-service';
import type { AppEnv } from '../types';
import { uuidParam } from './guards';

const NOT_FOUND_MESSAGE = '記事が見つかりません';

const mineQuerySchema = listQuerySchema.extend({
  tab: z.enum(['draft', 'published', 'trash']).default('draft'),
});

const validArticleId = uuidParam('id', NOT_FOUND_MESSAGE);

export const articleRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .post('/', validate('json', createArticleSchema), async (c) =>
    c.json(await createArticle(c.get('db'), c.get('user').id, c.req.valid('json'))),
  )
  .get('/', validate('query', listQuerySchema), async (c) =>
    c.json(await listFeed(c.get('db'), c.req.valid('query'))),
  )
  .get('/pickup', async (c) => c.json(await listPickup(c.get('db'))))
  .get('/mine', validate('query', mineQuerySchema), async (c) => {
    const { tab, ...page } = c.req.valid('query');
    return c.json(await listMine(c.get('db'), c.get('user').id, tab, page));
  })
  .get('/:id', validArticleId, async (c) =>
    c.json(await getArticleForViewer(c.get('db'), c.req.param('id'), c.get('user'))),
  )
  .patch('/:id', validArticleId, validate('json', updateArticleSchema), async (c) =>
    c.json(await updateArticle(c.get('db'), c.req.param('id'), c.get('user'), c.req.valid('json'))),
  )
  .post('/:id/publish', validArticleId, async (c) =>
    c.json(await publishArticle(c.get('db'), c.req.param('id'), c.get('user'))),
  )
  .post('/:id/unpublish', validArticleId, async (c) =>
    c.json(await unpublishArticle(c.get('db'), c.req.param('id'), c.get('user'))),
  )
  .delete('/:id', validArticleId, async (c) => {
    await softDeleteArticle(c.get('db'), c.req.param('id'), c.get('user'));
    return c.body(null, 204);
  })
  .post('/:id/restore', validArticleId, async (c) => {
    await restoreArticle(c.get('db'), c.req.param('id'), c.get('user'));
    return c.body(null, 204);
  })
  .delete('/:id/purge', validArticleId, async (c) => {
    await purgeArticle(c.get('db'), c.req.param('id'), c.get('user'));
    return c.body(null, 204);
  })
  .post('/:id/pin', validArticleId, async (c) =>
    c.json(await setPinned(c.get('db'), c.req.param('id'), c.get('user'), true)),
  )
  .post('/:id/unpin', validArticleId, async (c) =>
    c.json(await setPinned(c.get('db'), c.req.param('id'), c.get('user'), false)),
  );
