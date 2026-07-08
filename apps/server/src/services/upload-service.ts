import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { articles, uploads, users } from '../db/schema';
import { AppError } from '../errors';
import type { Db, Storage } from '../types';
import { publishedArticleWhere } from './article-visibility';

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

type UploadViewer = { id: string; role: 'member' | 'admin' };

// アップロード画像を閲覧してよいかを判定する。未公開ドラフトのヒーロー画像などが
// 無関係な認証ユーザーに配信されるのを防ぐ（アップロード主体・admin・公開文脈のみ許可）。
async function canViewUpload(
  db: Db,
  upload: typeof uploads.$inferSelect,
  viewer: UploadViewer,
): Promise<boolean> {
  // 1. アップロード主体本人・管理者は常に閲覧可（自分のドラフト画像の編集プレビュー等）
  if (viewer.role === 'admin' || upload.uploaderId === viewer.id) return true;
  const urlPath = `/api/uploads/${upload.id}`;
  const publiclyVisible = publishedArticleWhere();
  // 2. 公開記事のヒーロー画像
  const hero = await db.query.articles.findFirst({
    columns: { id: true },
    where: and(eq(articles.heroImageUploadId, upload.id), publiclyVisible),
  });
  if (hero) return true;
  // 3. いずれかのユーザーのアバター（プロフィール等で公開表示される）
  const avatar = await db.query.users.findFirst({
    columns: { id: true },
    where: eq(users.avatarUrl, urlPath),
  });
  if (avatar) return true;
  // 4. 公開記事の本文に埋め込まれた画像（id は UUID 検証済みで LIKE メタ文字を含まない）
  const inBody = await db.query.articles.findFirst({
    columns: { id: true },
    where: and(publiclyVisible, sql`${articles.bodyMd} like ${`%${urlPath}%`}`),
  });
  return Boolean(inBody);
}

export async function getUpload(
  db: Db,
  storage: Storage,
  id: string,
  viewer: UploadViewer,
): Promise<{ body: Buffer; contentType: string } | null> {
  const row = await db.query.uploads.findFirst({ where: eq(uploads.id, id) });
  // 権限がない場合も存在しない場合と同じ null（呼び出し側で 404）にして
  // 画像 id の存在有無を漏らさない。
  if (!row || !(await canViewUpload(db, row, viewer))) return null;
  return storage.get(row.storageKey);
}
