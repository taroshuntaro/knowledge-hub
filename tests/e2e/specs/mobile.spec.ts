import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 } });

test('モバイル: ドロワーを開いてナビ、遷移で自動クローズ、横スクロールなし', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'メニューを開く' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  // exact: true でないと、サイドバーに並ぶカテゴリ名（例: 「E2E検索カテゴリ-…」）が
  // 「検索」を部分一致で拾い strict-mode 違反になる。ナビの「検索」リンクだけを狙う。
  await drawer.getByRole('link', { name: '検索', exact: true }).click();
  await expect(page).toHaveURL(/\/search/);
  await expect(page.getByRole('dialog')).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
