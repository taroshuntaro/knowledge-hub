import { expect, test } from '@playwright/test';
import { unique } from '../helpers/data';

test('マスタ作成 → ユーザーへ割当 → メンバー一覧で絞り込み → プロフィール表示', async ({ page }) => {
  const department = unique('E2E開発部');
  const position = unique('E2E部長');

  // 1) admin がマスタを作成
  await page.goto('/admin/masters');
  const depSection = page.getByRole('region', { name: '所属' });
  await depSection.getByLabel('名称').fill(department);
  await depSection.getByRole('button', { name: '追加' }).click();
  await expect(depSection.getByText(department)).toBeVisible();

  const posSection = page.getByRole('region', { name: '役職' });
  await posSection.getByLabel('名称').fill(position);
  await posSection.getByRole('button', { name: '追加' }).click();
  await expect(posSection.getByText(position)).toBeVisible();

  // 2) ユーザー管理で自分（管理者）に割当
  await page.goto('/admin');
  const depSelect = page.locator('select[aria-label$="の所属"]').first();
  const posSelect = page.locator('select[aria-label$="の役職"]').first();
  const yearInput = page.locator('input[aria-label$="の入社年"]').first();

  const patchDone = () =>
    page.waitForResponse(
      (res) =>
        res.url().includes('/api/admin/users/') &&
        res.request().method() === 'PATCH' &&
        res.ok(),
    );

  let waiting = patchDone();
  await depSelect.selectOption({ label: department });
  await waiting;

  waiting = patchDone();
  await posSelect.selectOption({ label: position });
  await waiting;

  waiting = patchDone();
  await yearInput.fill('2019');
  await yearInput.blur();
  await waiting;

  // 3) メンバー一覧: 所属で絞り込み
  await page.goto('/members');
  await page.getByLabel('所属').selectOption({ label: department });
  // サイドバーにも listitem があるため main 内に限定する
  const card = page.getByRole('main').getByRole('listitem').first();
  await expect(card).toContainText(department);
  await expect(card).toContainText('2019 年入社');

  // 4) カードからプロフィールへ
  await card.getByRole('link').click();
  await expect(page).toHaveURL(/\/users\/[0-9a-f-]{36}$/);
  await expect(page.getByText(new RegExp(`${department} / ${position}`))).toBeVisible();
});
