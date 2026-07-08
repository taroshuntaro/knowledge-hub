import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requireAuth } from '../middleware/session';
import { getUpload, saveUpload } from '../services/upload-service';
import { AppError } from '../errors';
import type { AppEnv } from '../types';
import { requireUuidParam } from './guards';

export const uploadRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .post(
    '/',
    bodyLimit({
      maxSize: 11 * 1024 * 1024, // multipart のオーバーヘッド込みで 10MB 画像を通す
      onError: (c) => c.json({ code: 'VALIDATION', message: 'ファイルサイズが大きすぎます（上限10MB）' }, 413),
    }),
    async (c) => {
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
    },
  )
  .get('/:id', async (c) => {
    requireUuidParam(c.req.param('id'), '画像が見つかりません');
    const user = c.get('user');
    const found = await getUpload(c.get('db'), c.get('storage'), c.req.param('id'), {
      id: user.id,
      role: user.role,
    });
    if (!found) throw new AppError('NOT_FOUND', '画像が見つかりません', 404);
    c.header('Content-Type', found.contentType);
    c.header('Cache-Control', 'private, max-age=86400');
    return c.body(new Uint8Array(found.body));
  });
