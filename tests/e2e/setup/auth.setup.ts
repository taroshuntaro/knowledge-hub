import { expect, test as setup } from '@playwright/test';
import { ADMIN, MEMBER } from '../helpers/data';

const BASE = 'http://localhost:54173';

setup('admin ログインと member クレーム（storageState 準備）', async ({ page, browser }) => {
  // --- admin: パスワードログイン → storageState 保存 ---
  await page.goto('/login');
  await page.getByLabel('メールアドレス').fill(ADMIN.email);
  await page.getByLabel('パスワード').fill(ADMIN.password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL('/');
  await page.context().storageState({ path: '.auth/admin.json' });

  // --- member: 既存ならログイン、なければ事前作成 + 登録コードクレーム（クレームフローの検証を兼ねる） ---
  const memberContext = await browser.newContext({ baseURL: BASE });
  const probe = await memberContext.request.post('/api/auth/login', {
    data: { email: MEMBER.email, password: MEMBER.password },
    headers: { origin: BASE },
  });
  if (!probe.ok()) {
    const codeRes = await page.request.post('/api/admin/registration-code', {
      data: { expiresInDays: 7 },
    });
    expect(codeRes.status(), '登録コードの発行').toBe(201);
    const { code } = (await codeRes.json()) as { code: string };

    const createRes = await page.request.post('/api/admin/users', {
      data: { email: MEMBER.email, displayName: MEMBER.name },
    });
    // 201: 新規事前作成 / 409 EMAIL_TAKEN: 既に事前作成済み（いずれもクレーム可能）
    if (createRes.status() !== 201) {
      expect(createRes.status(), 'member の事前作成').toBe(409);
      const body = (await createRes.json()) as { code?: string };
      expect(body.code).toBe('EMAIL_TAKEN');
    }

    const memberPage = await memberContext.newPage();
    await memberPage.goto('/claim');
    await memberPage.getByLabel('メールアドレス').fill(MEMBER.email);
    await memberPage.getByLabel('登録コード').fill(code);
    await memberPage.getByLabel('パスワード（12文字以上）').fill(MEMBER.password);
    await memberPage.getByRole('button', { name: '登録する' }).click();
    await expect(memberPage).toHaveURL('/');
    await memberPage.close();
  }
  await memberContext.storageState({ path: '.auth/member.json' });
  await memberContext.close();
});
