import { expect, test } from '@playwright/test';
import { unique } from '../helpers/data';
import { createCategoryViaApi, createPublishedArticleViaApi } from '../helpers/api';

test('コメント → 返信 → リアクション → ブックマーク → ブックマーク一覧', async ({ browser, page }) => {
  // admin が記事を用意
  const categoryId = await createCategoryViaApi(page, unique('E2Eエンゲージ'));
  const title = unique('E2E エンゲージ記事');
  const articleId = await createPublishedArticleViaApi(page, { title, bodyMd: '議論の種。', categoryId });

  // member がコメント
  const memberContext = await browser.newContext({ baseURL: 'http://localhost:54173', storageState: '.auth/member.json' });
  const member = await memberContext.newPage();
  await member.goto(`/articles/${articleId}`);
  await member.getByLabel('コメント').fill('E2E コメントです');
  await member.getByRole('button', { name: 'コメントする' }).click();
  await expect(member.getByText('E2E コメントです')).toBeVisible();

  // admin が返信
  await page.goto(`/articles/${articleId}`);
  await expect(page.getByText('E2E コメントです')).toBeVisible();
  await page.getByRole('button', { name: '返信', exact: true }).first().click();
  await page.getByLabel('コメント').last().fill('E2E 返信です');
  await page.getByRole('button', { name: '返信する' }).click();
  await expect(page.getByText('E2E 返信です')).toBeVisible();

  // member がリアクション（最初の絵文字ボタンが 0 → 1）
  const reactions = member.getByRole('group', { name: 'リアクション' });
  await reactions.getByRole('button').first().click();
  await expect(reactions.getByRole('button').first()).toHaveText(/1/);

  // member がブックマーク → 一覧に載る
  await member.getByRole('button', { name: 'ブックマーク', exact: true }).click();
  await expect(member.getByRole('button', { name: 'ブックマーク済み' })).toBeVisible();
  await member.goto('/me/bookmarks');
  await expect(member.getByRole('heading', { name: title })).toBeVisible();

  await memberContext.close();
});
