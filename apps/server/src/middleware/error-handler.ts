import type { ErrorHandler } from 'hono';
import { AppError } from '../errors';
import { logger } from '../logger';
import type { AppEnv } from '../types';

export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof AppError) {
    return c.json({ code: err.code, message: err.message }, err.status);
  }
  logger.error({ err }, 'unhandled error');
  return c.json({ code: 'INTERNAL', message: 'サーバーエラーが発生しました' }, 500);
};
