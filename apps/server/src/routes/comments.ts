import { Hono } from 'hono';
import { createCommentSchema, listQuerySchema, updateCommentSchema } from '@knowledge-hub/shared';
import { requireAuth } from '../middleware/session';
import { validate } from '../middleware/validate';
import { createComment, deleteComment, listComments, updateComment } from '../services/comment-service';
import type { AppEnv } from '../types';
import { requireUuidParam } from './guards';

// /api/articles/:id/comments に配線する（articleRoutes とは別インスタンス）
export const articleCommentRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get('/:id/comments', validate('query', listQuerySchema), async (c) => {
    requireUuidParam(c.req.param('id'), '記事が見つかりません');
    return c.json(await listComments(c.get('db'), c.req.param('id'), c.req.valid('query')));
  })
  .post('/:id/comments', validate('json', createCommentSchema), async (c) => {
    requireUuidParam(c.req.param('id'), '記事が見つかりません');
    const created = await createComment(c.get('db'), c.req.param('id'), c.get('user'), c.req.valid('json'));
    return c.json(created);
  });

// /api/comments/:commentId に配線する
export const commentRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .patch('/:commentId', validate('json', updateCommentSchema), async (c) => {
    requireUuidParam(c.req.param('commentId'), 'コメントが見つかりません');
    const updated = await updateComment(c.get('db'), c.req.param('commentId'), c.get('user'), c.req.valid('json'));
    return c.json(updated);
  })
  .delete('/:commentId', async (c) => {
    requireUuidParam(c.req.param('commentId'), 'コメントが見つかりません');
    await deleteComment(c.get('db'), c.req.param('commentId'), c.get('user'));
    return c.body(null, 204);
  });
