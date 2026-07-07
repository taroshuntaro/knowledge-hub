import { expect, test } from '@playwright/test';
import { ADMIN } from '../helpers/data';

// ログイン UI 自体を検証するため、保存済みセッションは使わない
test.use({ storageState: { cookies: [], origins: [] } });

test('誤ったパスワードで role=alert のエラーが出て /login に留まる', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('メールアドレス').fill(ADMIN.email);
  await page.getByLabel('パスワード').fill('wrong-password-123');
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('ログイン成功でフィードへ、ログアウトで /login へ戻る', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('メールアドレス').fill(ADMIN.email);
  await page.getByLabel('パスワード').fill(ADMIN.password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL('/');
  // サイドバー下部のアカウントメニュー（トリガーは表示名）
  await page.getByRole('button', { name: ADMIN.name }).click();
  await page.getByRole('menuitem', { name: 'ログアウト' }).click();
  await expect(page).toHaveURL(/\/login/);
});
