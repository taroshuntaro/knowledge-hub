import { expect, test } from '@playwright/test';
import { ADMIN } from '../helpers/data';

const BASE = 'http://localhost:54173';
const KC_DISCOVERY = 'http://localhost:8080/realms/knowledge-hub/.well-known/openid-configuration';
const SSO_MEMBER = { email: 'sso-taro@example.com', displayName: 'Taro SSO' };

// ローカル限定: dev Keycloak（docker compose --profile idp up -d）起動時のみ実行。
// この project は setup に依存しない（storageState なしの素の状態で SSO 導線を検証するため）ので、
// 事前作成は admin ログイン込みで自前の request コンテキストで行う。
test('SSO ログイン: Keycloak → pending クレーム → member 到達', async ({ page, request }) => {
  const alive = await fetch(KC_DISCOVERY).then((r) => r.ok).catch(() => false);
  test.skip(!alive, 'Keycloak（--profile idp, :8080）未起動のためスキップ');

  // JIT は廃止済みのため、SSO ログインが成立するには事前に pending 行が必要。
  // admin としてログインし、sso-taro@example.com を事前作成（201: 新規 / 409 EMAIL_TAKEN: 作成済み、いずれも可）。
  const loginRes = await request.post('/api/auth/login', {
    data: { email: ADMIN.email, password: ADMIN.password },
    headers: { origin: BASE },
  });
  expect(loginRes.ok(), 'admin ログイン').toBeTruthy();
  const createRes = await request.post('/api/admin/users', {
    data: { email: SSO_MEMBER.email, displayName: SSO_MEMBER.displayName },
    headers: { origin: BASE },
  });
  if (createRes.status() !== 201) {
    expect(createRes.status(), 'sso member の事前作成').toBe(409);
  }

  await page.goto('/login');
  await page.getByRole('link', { name: 'SSO でログイン' }).click();
  // Keycloak のログイン画面（標準テーマの id）
  await page.locator('#username').fill('sso-taro');
  await page.locator('#password').fill('sso-dev-password');
  await page.locator('#kc-login').click();
  // コールバック → pending クレーム → フィードへ
  await expect(page).toHaveURL(`${BASE}/`);
  await expect(page.getByRole('button', { name: 'Taro SSO' })).toBeVisible(); // サイドバーの表示名
});

// 負テスト（pending 行なしの email での SSO 拒否）には realm に 2 人目の Keycloak ユーザーが必要。
// docker/keycloak/realm.json には sso-taro のみが定義されており、追加インフラを用意しない方針のため、
// このケースは apps/server/src/routes/auth-oidc.test.ts（OIDC_NOT_PROVISIONED → /login?error=not_provisioned）で
// サービス/ルートレベルとしてカバー済みとし、E2E では省略する。
