import { expect, type Page } from '@playwright/test';

// サーバーの origin チェック（APP_URL 一致）を通すため、mutation には必ず origin ヘッダを付ける。
const ORIGIN = { origin: 'http://localhost:54173' };

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
