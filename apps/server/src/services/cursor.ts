import { z } from 'zod';
import { AppError } from '../errors';

// カーソルは `${ISO または空}|${行UUID}` を base64url した文字列。全リスト系サービスで共有。
// 空 sortKey は article/search の publishedAt が null の行に対応する。
export function encodeCursor(sortKey: Date | null, id: string): string {
  return Buffer.from(`${sortKey?.toISOString() ?? ''}|${id}`).toString('base64url');
}

const uuidSchema = z.string().uuid();

// 不正なカーソル（base64 化けで '|' 欠落 / id が UUID でない / sortKey が空でも ISO でもない）は
// DB エラー（500）ではなく VALIDATION(400) にする。Buffer.from(_, 'base64url') は寛容で throw しないため、
// 復号後の構造を明示的に検証する。
export function decodeCursor(cursor: string): { sortKey: string; id: string } {
  const decoded = Buffer.from(cursor, 'base64url').toString();
  const sep = decoded.indexOf('|');
  if (sep === -1) throw new AppError('VALIDATION', '不正なカーソルです', 400);
  const sortKey = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);
  if (!uuidSchema.safeParse(id).success) throw new AppError('VALIDATION', '不正なカーソルです', 400);
  if (sortKey !== '' && Number.isNaN(Date.parse(sortKey))) {
    throw new AppError('VALIDATION', '不正なカーソルです', 400);
  }
  return { sortKey, id };
}
