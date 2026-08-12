import { expect, type APIRequestContext, type Page } from '@playwright/test';

// サーバーの origin チェック（APP_URL 一致）を通すため、mutation には必ず origin ヘッダを付ける。
const ORIGIN = { origin: 'http://localhost:54173' };

/**
 * pending ユーザーを冪等に事前作成する（201: 新規 / 409 EMAIL_TAKEN: 作成済み、いずれも可）。
 * admin セッションを持つ request コンテキスト（page.request か request fixture）で呼ぶこと。
 */
export async function ensurePendingUser(
  request: APIRequestContext,
  user: { email: string; displayName: string },
): Promise<void> {
  const res = await request.post('/api/admin/users', { data: user, headers: ORIGIN });
  if (res.status() !== 201) {
    expect(res.status(), `${user.email} の事前作成`).toBe(409);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe('EMAIL_TAKEN');
  }
}

/** admin セッション（page の cookie）でカテゴリを API 作成し id を返す */
export async function createCategoryViaApi(page: Page, name: string): Promise<string> {
  const res = await page.request.post('/api/categories', { data: { name }, headers: ORIGIN });
  expect(res.ok(), `createCategory: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { id: string };
  return body.id;
}

/** 記事を作成して公開し、記事 id を返す（page の cookie のユーザーが著者になる） */
export async function createPublishedArticleViaApi(
  page: Page,
  input: { title: string; bodyMd: string; categoryId: string },
): Promise<string> {
  const created = await page.request.post('/api/articles', {
    data: { title: input.title, bodyMd: input.bodyMd, categoryId: input.categoryId, heroImageUploadId: null, tags: [] },
    headers: ORIGIN,
  });
  expect(created.ok(), `createArticle: ${created.status()}`).toBeTruthy();
  const { id } = (await created.json()) as { id: string };
  const published = await page.request.post(`/api/articles/${id}/publish`, { headers: ORIGIN });
  expect(published.ok(), `publish: ${published.status()}`).toBeTruthy();
  return id;
}
