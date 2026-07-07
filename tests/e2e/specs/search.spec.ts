import { expect, test } from '@playwright/test';
import { unique } from '../helpers/data';
import { createCategoryViaApi, createPublishedArticleViaApi } from '../helpers/api';

test('検索: 公開記事はヒットし、下書き固有語は漏れない', async ({ page }) => {
  const categoryId = await createCategoryViaApi(page, unique('E2E検索カテゴリ'));
  const publishedWord = `pubword${Date.now()}`;
  const draftWord = `draftword${Date.now()}`;

  // 公開記事
  await createPublishedArticleViaApi(page, {
    title: unique('E2E 検索記事'),
    bodyMd: `検索用の固有語 ${publishedWord} を含む本文。`,
    categoryId,
  });
  // 下書き（公開しない）: API で作成のみ
  const draft = await page.request.post('/api/articles', {
    data: { title: unique('E2E 下書き'), bodyMd: `下書き固有語 ${draftWord}。`, categoryId, heroImageUploadId: null, tags: [] },
    headers: { origin: 'http://localhost:54173' },
  });
  expect(draft.ok()).toBeTruthy();

  // ヒットする
  await page.goto('/search');
  await page.getByLabel('キーワード').fill(publishedWord);
  await page.getByRole('button', { name: '検索' }).click();
  await expect(page.getByText(new RegExp(publishedWord)).first()).toBeVisible();

  // 下書きは漏れない（draftWord が画面のどこにも出ない）
  await page.getByLabel('キーワード').fill(draftWord);
  await page.getByRole('button', { name: '検索' }).click();
  // 結果描画の完了を待ってからゼロ件を確認（キーワード入力欄の値は getByText に掛からない）
  await expect(page.getByText(new RegExp(draftWord))).toHaveCount(0);
  await expect(page.locator('article')).toHaveCount(0);
});
