import { Hono } from 'hono';
import { listQuerySchema, reactionSchema, REACTION_EMOJIS } from '@knowledge-hub/shared';
import { AppError } from '../errors';
import { requireAuth } from '../middleware/session';
import { validate } from '../middleware/validate';
import {
  addBookmark, addReaction, getEngagement, listBookmarks, removeBookmark, removeReaction,
} from '../services/engagement-service';
import type { AppEnv } from '../types';
import { requireUuidParam } from './guards';

// /api/articles/:id/... に配線する（articleRoutes とは別インスタンス）
export const articleEngagementRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get('/:id/engagement', async (c) => {
    requireUuidParam(c.req.param('id'), '記事が見つかりません');
    return c.json(await getEngagement(c.get('db'), c.get('user').id, c.req.param('id')));
  })
  .post('/:id/reactions', validate('json', reactionSchema), async (c) => {
    requireUuidParam(c.req.param('id'), '記事が見つかりません');
    await addReaction(c.get('db'), c.get('user').id, c.req.param('id'), c.req.valid('json').emoji);
    return c.json(await getEngagement(c.get('db'), c.get('user').id, c.req.param('id')));
  })
  .delete('/:id/reactions/:emoji', async (c) => {
    requireUuidParam(c.req.param('id'), '記事が見つかりません');
    const emoji = decodeURIComponent(c.req.param('emoji'));
    if (!(REACTION_EMOJIS as readonly string[]).includes(emoji)) {
      throw new AppError('VALIDATION', '不正な絵文字です', 400);
    }
    await removeReaction(c.get('db'), c.get('user').id, c.req.param('id'), emoji);
    return c.body(null, 204);
  })
  .post('/:id/bookmark', async (c) => {
    requireUuidParam(c.req.param('id'), '記事が見つかりません');
    await addBookmark(c.get('db'), c.get('user').id, c.req.param('id'));
    return c.body(null, 204);
  })
  .delete('/:id/bookmark', async (c) => {
    requireUuidParam(c.req.param('id'), '記事が見つかりません');
    await removeBookmark(c.get('db'), c.get('user').id, c.req.param('id'));
    return c.body(null, 204);
  });

// /api/me/... に配線する
export const meRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get('/bookmarks', validate('query', listQuerySchema), async (c) =>
    c.json(await listBookmarks(c.get('db'), c.get('user').id, c.req.valid('query'))),
  );
