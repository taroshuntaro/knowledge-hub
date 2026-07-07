import { expect, test } from '@playwright/test';

const KC_DISCOVERY = 'http://localhost:8080/realms/knowledge-hub/.well-known/openid-configuration';

// ローカル限定: dev Keycloak（docker compose --profile idp up -d）起動時のみ実行。
test('SSO ログイン: Keycloak → JIT → member 到達', async ({ page }) => {
  const alive = await fetch(KC_DISCOVERY).then((r) => r.ok).catch(() => false);
  test.skip(!alive, 'Keycloak（--profile idp, :8080）未起動のためスキップ');

  await page.goto('/login');
  await page.getByRole('link', { name: 'SSO でログイン' }).click();
  // Keycloak のログイン画面（標準テーマの id）
  await page.locator('#username').fill('sso-taro');
  await page.locator('#password').fill('sso-dev-password');
  await page.locator('#kc-login').click();
  // コールバック → JIT → フィードへ
  await expect(page).toHaveURL('http://localhost:54173/');
  await expect(page.getByRole('button', { name: 'Taro SSO' })).toBeVisible(); // サイドバーの表示名
});
