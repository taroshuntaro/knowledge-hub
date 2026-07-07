import { z } from 'zod';
import { AppError } from '../errors';

// カーソルは `${ISO または空}|${行UUID}` を base64url した文字列。全リスト系サービスで共有。
// 引数の型は `Date | null` のまま（呼び出し元が articles.publishedAt: Date | null をそのまま渡すため）だが、
// 実運用ではどの生成元も NOT NULL な日時列（publishedAt / createdAt / updatedAt）しか渡さないため、
// 空 sortKey が実際に生成されることはない。decodeCursor は空 sortKey を不正なカーソルとして拒否する。
export function encodeCursor(sortKey: Date | null, id: string): string {
  return Buffer.from(`${sortKey?.toISOString() ?? ''}|${id}`).toString('base64url');
}

const uuidSchema = z.string().uuid();

// 不正なカーソル（base64 化けで '|' 欠落 / id が UUID でない / sortKey が空を含め ISO でない）は
// DB エラー（500）ではなく VALIDATION(400) にする。Buffer.from(_, 'base64url') は寛容で throw しないため、
// 復号後の構造を明示的に検証する。Date.parse('') は NaN なので空文字も自動的に拒否される。
export function decodeCursor(cursor: string): { sortKey: string; id: string } {
  const decoded = Buffer.from(cursor, 'base64url').toString();
  const sep = decoded.indexOf('|');
  if (sep === -1) throw new AppError('VALIDATION', '不正なカーソルです', 400);
  const sortKey = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);
  if (!uuidSchema.safeParse(id).success) throw new AppError('VALIDATION', '不正なカーソルです', 400);
  if (Number.isNaN(Date.parse(sortKey))) {
    throw new AppError('VALIDATION', '不正なカーソルです', 400);
  }
  return { sortKey, id };
}
