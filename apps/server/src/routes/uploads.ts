import { Hono } from 'hono';
import { requireAuth } from '../middleware/session';
import { getUpload, saveUpload } from '../services/upload-service';
import { AppError } from '../errors';
import type { AppEnv } from '../types';

export const uploadRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .post('/', async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) throw new AppError('VALIDATION', 'ファイルが指定されていません', 400);
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await saveUpload(c.get('db'), c.get('storage'), c.get('user').id, {
      buffer,
      mimeType: file.type,
      size: buffer.length,
    });
    return c.json(result);
  })
  .get('/:id', async (c) => {
    const found = await getUpload(c.get('db'), c.get('storage'), c.req.param('id'));
    if (!found) throw new AppError('NOT_FOUND', '画像が見つかりません', 404);
    c.header('Content-Type', found.contentType);
    c.header('Cache-Control', 'private, max-age=86400');
    return c.body(new Uint8Array(found.body));
  });
