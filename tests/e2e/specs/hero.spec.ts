import { expect, test } from '@playwright/test';
import { pngPixel, unique } from '../helpers/data';
import { createCategoryViaApi } from '../helpers/api';

test('ヒーロー画像: アップロード → プレビュー → 公開 → 詳細ヒーロー → 一覧サムネ', async ({ page }) => {
  const category = unique('E2Eヒーローカテゴリ');
  await createCategoryViaApi(page, category);
  const title = unique('E2E ヒーロー記事');

  await page.goto('/articles/new');
  await page.getByPlaceholder('タイトルを入力').fill(title);

  // 実 PNG をアップロード（MinIO 実往復 + magic-byte 検証を通す）
  await page.getByLabel('ヒーロー画像を選択').setInputFiles({
    name: 'hero.png',
    mimeType: 'image/png',
    buffer: pngPixel,
  });
  // エディタ内プレビュー（HeroImage の前景 img）
  await expect(page.getByRole('img', { name: 'ヒーロー画像' })).toBeVisible({ timeout: 15_000 });

  // 公開
  await page.getByRole('button', { name: '公開する' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/カテゴリ/).selectOption({ label: category });
  await dialog.getByRole('button', { name: '公開する' }).click();
  await expect(page).toHaveURL(/\/articles\/[0-9a-f-]{36}$/);

  // 詳細のヒーロー（HeroImage 前景 img は alt=記事タイトル）
  await expect(page.getByRole('img', { name: title })).toBeVisible();

  // フィードのカードに 4:3 サムネ（/api/uploads/ を指す img）
  await page.goto('/');
  const card = page.locator('article').filter({ hasText: title });
  await expect(card.locator('img[src^="/api/uploads/"]').first()).toBeVisible();
});
