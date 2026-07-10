import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { AppError } from '../errors';

const uuid = z.string().uuid();

// 不正な UUID 形式は DB エラー（22P02 → 500）ではなく NOT_FOUND として扱う
export function requireUuidParam(value: string, notFoundMessage: string): void {
  if (!uuid.safeParse(value).success) {
    throw new AppError('NOT_FOUND', notFoundMessage, 404);
  }
}

/** requireUuidParam の per-route ミドルウェア版。ハンドラ前段に挟んで使う。 */
export function uuidParam(name: string, notFoundMessage: string): MiddlewareHandler {
  return async (c, next) => {
    requireUuidParam(c.req.param(name) ?? '', notFoundMessage);
    await next();
  };
}
