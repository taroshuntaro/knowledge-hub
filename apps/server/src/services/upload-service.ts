import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { uploads } from '../db/schema';
import { AppError } from '../errors';
import type { Db, Storage } from '../types';

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_SIZE = 10 * 1024 * 1024;
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export async function saveUpload(
  db: Db,
  storage: Storage,
  uploaderId: string,
  file: { buffer: Buffer; mimeType: string; size: number },
): Promise<{ id: string; url: string }> {
  if (!ALLOWED.has(file.mimeType)) throw new AppError('VALIDATION', '画像のみアップロードできます', 400);
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
