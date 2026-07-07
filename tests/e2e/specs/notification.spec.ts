import { expect, test } from '@playwright/test';
import { unique } from '../helpers/data';
import { createCategoryViaApi, createPublishedArticleViaApi } from '../helpers/api';

test('member のコメントで admin に通知（バッジ → 一覧 → 既読 → 遷移）', async ({ browser, page }) => {
  // admin が記事を用意
  const categoryId = await createCategoryViaApi(page, unique('E2E通知'));
  const title = unique('E2E 通知記事');
  const articleId = await createPublishedArticleViaApi(page, { title, bodyMd: '通知テスト。', categoryId });

  // member がコメント（通知イベント発生）
  const memberContext = await browser.newContext({ baseURL: 'http://localhost:54173', storageState: '.auth/member.json' });
  const member = await memberContext.newPage();
  await member.goto(`/articles/${articleId}`);
  await member.getByLabel('コメント').fill('通知を飛ばすコメント');
  await member.getByRole('button', { name: 'コメントする' }).click();
  await expect(member.getByText('通知を飛ばすコメント')).toBeVisible();
  await memberContext.close();

  // admin 側: ベルに未読バッジ（ページ読み込みでカウント取得）
  await page.goto('/');
  // バッジはデスクトップ（サイドバー）とモバイル（ヘッダー）の 2 箇所に描画されるため first で限定
  await expect(page.getByLabel(/未読 \d+ 件/).first()).toBeVisible({ timeout: 15_000 });

  // 通知一覧に行が出る
  await page.goto('/notifications');
  await expect(page.getByText(title).first()).toBeVisible();

  // すべて既読 → バッジ消滅
  await page.getByRole('button', { name: 'すべて既読にする' }).click();
  await expect(page.getByLabel(/未読 \d+ 件/)).toHaveCount(0);

  // 通知行のクリックで記事へ遷移
  await page.getByText(title).first().click();
  await expect(page).toHaveURL(new RegExp(`/articles/${articleId}`));
});
