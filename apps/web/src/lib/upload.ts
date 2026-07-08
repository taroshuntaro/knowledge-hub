import { errorMessage } from './api-error';

/** DataTransfer/ClipboardData の files から最初の画像ファイルを取り出す（無ければ null）。 */
export function firstImageFile(list: FileList | null | undefined): File | null {
  if (!list) return null;
  return Array.from(list).find((f) => f.type.startsWith('image/')) ?? null;
}

/** 画像を POST /api/uploads に送り、本文に挿入する URL を返す */
export async function uploadImage(file: File): Promise<{ url: string }> {
  return uploadImageWithId(file);
}

/**
 * 画像を POST /api/uploads に送り、id と url の両方を返す。
 * ヒーロー画像のように id（heroImageUploadId）が必要な用途で使う。
 */
export async function uploadImageWithId(file: File): Promise<{ id: string; url: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/uploads', { method: 'POST', body: form, credentials: 'same-origin' });
  if (!res.ok) {
    throw new Error(await errorMessage(res, '画像のアップロードに失敗しました'));
  }
  return (await res.json()) as { id: string; url: string };
}
