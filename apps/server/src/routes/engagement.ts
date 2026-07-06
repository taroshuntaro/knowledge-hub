import { Hono } from 'hono';
import { z } from 'zod';
import { listQuerySchema, reactionSchema, REACTION_EMOJIS } from '@knowledge-hub/shared';
import { AppError } from '../errors';
import { requireAuth } from '../middleware/session';
import { validate } from '../middleware/validate';
import {
  addBookmark, addReaction, getEngagement, listBookmarks, removeBookmark, removeReaction,
} from '../services/engagement-service';
import type { AppEnv } from '../types';

function requireValidArticleId(id: string): void {
  // 不正な UUID 形式は DB エラー（500）ではなく NOT_FOUND として扱う
  if (!z.string().uuid().safeParse(id).success) {
    throw new AppError('NOT_FOUND', '記事が見つかりません', 404);
  }
}

// /api/articles/:id/... に配線する（articleRoutes とは別インスタンス）
export const articleEngagementRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get('/:id/engagement', async (c) => {
    requireValidArticleId(c.req.param('id'));
    return c.json(await getEngagement(c.get('db'), c.get('user').id, c.req.param('id')));
  })
  .post('/:id/reactions', validate('json', reactionSchema), async (c) => {
    requireValidArticleId(c.req.param('id'));
    await addReaction(c.get('db'), c.get('user').id, c.req.param('id'), c.req.valid('json').emoji);
    return c.json(await getEngagement(c.get('db'), c.get('user').id, c.req.param('id')));
  })
  .delete('/:id/reactions/:emoji', async (c) => {
    requireValidArticleId(c.req.param('id'));
    const emoji = decodeURIComponent(c.req.param('emoji'));
    if (!(REACTION_EMOJIS as readonly string[]).includes(emoji)) {
      throw new AppError('VALIDATION', '不正な絵文字です', 400);
    }
    await removeReaction(c.get('db'), c.get('user').id, c.req.param('id'), emoji);
    return c.body(null, 204);
  })
  .post('/:id/bookmark', async (c) => {
    requireValidArticleId(c.req.param('id'));
    await addBookmark(c.get('db'), c.get('user').id, c.req.param('id'));
    return c.body(null, 204);
  })
  .delete('/:id/bookmark', async (c) => {
    requireValidArticleId(c.req.param('id'));
    await removeBookmark(c.get('db'), c.get('user').id, c.req.param('id'));
    return c.body(null, 204);
  });

// /api/me/... に配線する
export const meRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get('/bookmarks', validate('query', listQuerySchema), async (c) =>
    c.json(await listBookmarks(c.get('db'), c.get('user').id, c.req.valid('query'))),
  );
