import { z } from 'zod';
import { AppError } from '../errors';

const uuid = z.string().uuid();

// 不正な UUID 形式は DB エラー（22P02 → 500）ではなく NOT_FOUND として扱う
export function requireUuidParam(value: string, notFoundMessage: string): void {
  if (!uuid.safeParse(value).success) {
    throw new AppError('NOT_FOUND', notFoundMessage, 404);
  }
}
