import { expect, test } from '@playwright/test';
import { unique } from '../helpers/data';

test('カテゴリ作成 → 記事作成 → 必須ガード → 公開 → 詳細 → フィード', async ({ page }) => {
  const category = unique('E2Eカテゴリ');
  const title = unique('E2E 記事');

  // 1) admin がカテゴリ管理 UI から作成
  await page.goto('/admin/categories');
  await page.getByLabel('名称').fill(category);
  await page.getByRole('button', { name: '追加' }).click();
  // 作成直後はサイドバー・親カテゴリ select・一覧の 3 箇所に出るため一覧に限定
  await expect(page.getByRole('list').getByText(category)).toBeVisible();

  // 2) 新規記事: タイトル → 自動保存インジケータ
  await page.goto('/articles/new');
  await page.getByPlaceholder('タイトルを入力').fill(title);
  // アクションバーの保存インジケータ（キャンバス側の「保存しました」と二重表示のため exact で限定）
  await expect(page.getByText('保存済み', { exact: true })).toBeVisible({ timeout: 15_000 });

  // 3) 本文（リッチエディタ = ProseMirror）
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('E2E 本文テキスト。');
  // タイプ直後（RichEditor の 500ms 直列化デバウンス内）に公開まで進む。
  // 保存/公開前の richFlush が無いと本文が欠落する（実バグの回帰テスト）。
  await expect(page.locator('.ProseMirror')).toContainText('E2E 本文テキスト。');

  // 4) 公開パネル: カテゴリ必須ガード → 選択で解除 → 公開
  await page.getByRole('button', { name: '公開する' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: '公開する' })).toBeDisabled();
  await expect(dialog.getByText(/カテゴリの選択が必要/)).toBeVisible();
  await dialog.getByLabel(/カテゴリ/).selectOption({ label: category });
  await expect(dialog.getByRole('button', { name: '公開する' })).toBeEnabled();
  await dialog.getByRole('button', { name: '公開する' }).click();

  // 5) 記事詳細へ遷移（/articles/new に誤一致しないよう uuid 末尾アンカー）
  await expect(page).toHaveURL(/\/articles\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('E2E 本文テキスト。')).toBeVisible();

  // 6) フィード掲載
  await page.goto('/');
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
});
