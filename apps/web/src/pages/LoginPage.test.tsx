import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const postMock = vi.fn();
const methodsMock = vi.fn();
vi.mock('../api/client', () => ({
  api: {
    api: {
      auth: {
        login: { $post: (...a: unknown[]) => postMock(...a) },
        methods: { $get: (...a: unknown[]) => methodsMock(...a) },
      },
    },
  },
}));

import { LoginPage } from './LoginPage';

function renderPage(initialEntries: string[] = ['/login']) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={initialEntries}>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    methodsMock.mockReset();
    methodsMock.mockResolvedValue({ ok: true, json: async () => ({ password: true, oidc: false }) });
  });

  it('ネットワーク例外でもエラーメッセージを表示する（M-5）', async () => {
    postMock.mockRejectedValue(new TypeError('fetch failed'));
    renderPage();
    await screen.findByLabelText('メールアドレス');
    await userEvent.type(screen.getByLabelText('メールアドレス'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('パスワード'), 'my-password-123');
    await userEvent.click(screen.getByRole('button', { name: 'ログイン' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/通信に失敗/);
  });

  it('入力値で login API を呼ぶ', async () => {
    postMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    renderPage();
    await screen.findByLabelText('メールアドレス');
    await userEvent.type(screen.getByLabelText('メールアドレス'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('パスワード'), 'my-password-123');
    await userEvent.click(screen.getByRole('button', { name: 'ログイン' }));
    expect(postMock).toHaveBeenCalledWith({
      json: { email: 'a@example.com', password: 'my-password-123' },
    });
  });

  it('失敗時にエラーメッセージを表示する', async () => {
    postMock.mockResolvedValue({
      ok: false,
      json: async () => ({ code: 'INVALID_CREDENTIALS', message: 'メールアドレスまたはパスワードが正しくありません' }),
    });
    renderPage();
    await screen.findByLabelText('メールアドレス');
    await userEvent.type(screen.getByLabelText('メールアドレス'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('パスワード'), 'wrong-password-1');
    await userEvent.click(screen.getByRole('button', { name: 'ログイン' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('正しくありません');
  });

  it('oidc 有効なら「SSO でログイン」リンクが /api/auth/oidc/login を指す', async () => {
    methodsMock.mockResolvedValue({ ok: true, json: async () => ({ password: true, oidc: true }) });
    renderPage();
    const link = await screen.findByRole('link', { name: 'SSO でログイン' });
    expect(link).toHaveAttribute('href', '/api/auth/oidc/login');
  });

  it('password: false ならメール/パスワードフォームを描画しない', async () => {
    methodsMock.mockResolvedValue({ ok: true, json: async () => ({ password: false, oidc: true }) });
    renderPage();
    await screen.findByRole('link', { name: 'SSO でログイン' });
    expect(screen.queryByLabelText('メールアドレス')).toBeNull();
    expect(screen.queryByText('パスワードをお忘れですか？')).toBeNull();
  });

  it('?error=oidc_domain でドメイン不許可メッセージを表示する', async () => {
    renderPage(['/login?error=oidc_domain']);
    expect(await screen.findByRole('alert')).toHaveTextContent('このメールドメインは許可されていません');
  });

  it('?error=not_provisioned で未登録メッセージを表示する', async () => {
    renderPage(['/login?error=not_provisioned']);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'このメールアドレスは登録されていません。管理者にお問い合わせください',
    );
  });

  it('password 有効なら /claim へのリンクを表示する', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: '初めてご利用の方（登録コードをお持ちの方）' });
    expect(link).toHaveAttribute('href', '/claim');
  });

  it('password: false なら /claim へのリンクを表示しない', async () => {
    methodsMock.mockResolvedValue({ ok: true, json: async () => ({ password: false, oidc: true }) });
    renderPage();
    await screen.findByRole('link', { name: 'SSO でログイン' });
    expect(screen.queryByRole('link', { name: '初めてご利用の方（登録コードをお持ちの方）' })).toBeNull();
  });
});
