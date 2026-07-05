import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { uploads } from '../db/schema';
import { AppError } from '../errors';
import type { Db, Storage } from '../types';

const MAX_SIZE = 10 * 1024 * 1024;
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

// 先頭バイト（マジックナンバー）が申告 MIME と一致するか検証する。
// クライアント申告の Content-Type だけを信用しないための防御。
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAGIC_CHECKS: Record<string, (b: Buffer) => boolean> = {
  'image/png': (b) => b.length >= 8 && b.subarray(0, 8).equals(PNG_MAGIC),
  'image/jpeg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/gif': (b) => {
    const head = b.subarray(0, 6).toString('latin1');
    return head === 'GIF87a' || head === 'GIF89a';
  },
  'image/webp': (b) =>
    b.length >= 12 &&
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP',
};

export async function saveUpload(
  db: Db,
  storage: Storage,
  uploaderId: string,
  file: { buffer: Buffer; mimeType: string; size: number },
): Promise<{ id: string; url: string }> {
  const magicCheck = MAGIC_CHECKS[file.mimeType];
  if (!magicCheck) throw new AppError('VALIDATION', '画像のみアップロードできます', 400);
  if (!magicCheck(file.buffer)) {
    throw new AppError('VALIDATION', 'ファイルの内容が画像形式と一致しません', 400);
  }
  if (file.size > MAX_SIZE) throw new AppError('VALIDATION', 'ファイルサイズが大きすぎます（上限10MB）', 400);
  const id = randomUUID();
  const key = `uploads/${id}.${EXT[file.mimeType]}`;
  await storage.put(key, file.buffer, file.mimeType);
  await db.insert(uploads).values({ id, uploaderId, storageKey: key, mimeType: file.mimeType, size: file.size });
  return { id, url: `/api/uploads/${id}` };
}

export async function getUpload(
  db: Db,
  storage: Storage,
  id: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  const row = await db.query.uploads.findFirst({ where: eq(uploads.id, id) });
  if (!row) return null;
  return storage.get(row.storageKey);
}
