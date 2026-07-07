import { expect, test as setup } from '@playwright/test';
import { ADMIN, MEMBER } from '../helpers/data';
import { clearMailbox, latestMessageText } from '../helpers/mailpit';

setup('admin ログインと member 招待（storageState 準備）', async ({ page, browser }) => {
  // --- admin: パスワードログイン → storageState 保存 ---
  await page.goto('/login');
  await page.getByLabel('メールアドレス').fill(ADMIN.email);
  await page.getByLabel('パスワード').fill(ADMIN.password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL('/');
  await page.context().storageState({ path: '.auth/admin.json' });

  // --- member: 既存ならログイン、なければ招待フローで作成（招待フローの検証を兼ねる） ---
  const memberContext = await browser.newContext({ baseURL: 'http://localhost:54173' });
  const probe = await memberContext.request.post('/api/auth/login', {
    data: { email: MEMBER.email, password: MEMBER.password },
    headers: { origin: 'http://localhost:54173' },
  });
  if (!probe.ok()) {
    await clearMailbox();
    // admin が招待を送る
    await page.goto('/admin');
    await page.getByLabel('招待するメールアドレス').fill(MEMBER.email);
    await page.getByRole('button', { name: '招待を送る' }).click();
    // Mailpit REST で招待リンクを取得
    const text = await latestMessageText(MEMBER.email);
    const inviteUrl = text.match(/http:\/\/localhost:54173\/invite\/[\w.-]+/)?.[0];
    expect(inviteUrl, `招待メールにリンクが見つからない: ${text}`).toBeTruthy();
    // member 側コンテキストで受諾 → 自動ログイン
    const memberPage = await memberContext.newPage();
    await memberPage.goto(inviteUrl!);
    await memberPage.getByLabel('表示名').fill(MEMBER.name);
    await memberPage.getByLabel('パスワード（12文字以上）').fill(MEMBER.password);
    await memberPage.getByRole('button', { name: '登録する' }).click();
    await expect(memberPage).toHaveURL('/');
    await memberPage.close();
  }
  await memberContext.storageState({ path: '.auth/member.json' });
  await memberContext.close();
});
