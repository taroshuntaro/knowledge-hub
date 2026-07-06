import { Hono } from 'hono';
import { z } from 'zod';
import { createCommentSchema, listQuerySchema, updateCommentSchema } from '@knowledge-hub/shared';
import { AppError } from '../errors';
import { requireAuth } from '../middleware/session';
import { validate } from '../middleware/validate';
import { createComment, deleteComment, listComments, updateComment } from '../services/comment-service';
import type { AppEnv } from '../types';

function requireValidArticleId(id: string): void {
  // 不正な UUID 形式は DB エラー（500）ではなく NOT_FOUND として扱う
  if (!z.string().uuid().safeParse(id).success) {
    throw new AppError('NOT_FOUND', '記事が見つかりません', 404);
  }
}

function requireValidCommentId(id: string): void {
  if (!z.string().uuid().safeParse(id).success) {
    throw new AppError('NOT_FOUND', 'コメントが見つかりません', 404);
  }
}

// /api/articles/:id/comments に配線する（articleRoutes とは別インスタンス）
export const articleCommentRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get('/:id/comments', validate('query', listQuerySchema), async (c) => {
    requireValidArticleId(c.req.param('id'));
    return c.json(await listComments(c.get('db'), c.req.param('id'), c.req.valid('query')));
  })
  .post('/:id/comments', validate('json', createCommentSchema), async (c) => {
    requireValidArticleId(c.req.param('id'));
    const created = await createComment(c.get('db'), c.req.param('id'), c.get('user'), c.req.valid('json'));
    return c.json(created);
  });

// /api/comments/:commentId に配線する
export const commentRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .patch('/:commentId', validate('json', updateCommentSchema), async (c) => {
    requireValidCommentId(c.req.param('commentId'));
    const updated = await updateComment(c.get('db'), c.req.param('commentId'), c.get('user'), c.req.valid('json'));
    return c.json(updated);
  })
  .delete('/:commentId', async (c) => {
    requireValidCommentId(c.req.param('commentId'));
    await deleteComment(c.get('db'), c.req.param('commentId'), c.get('user'));
    return c.body(null, 204);
  });
