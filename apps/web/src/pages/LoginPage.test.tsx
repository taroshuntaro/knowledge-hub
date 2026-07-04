import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

const postMock = vi.fn();
vi.mock('../api/client', () => ({
  api: { api: { auth: { login: { $post: (...a: unknown[]) => postMock(...a) } } } },
}));

import { LoginPage } from './LoginPage';

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LoginPage', () => {
  it('入力値で login API を呼ぶ', async () => {
    postMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    renderPage();
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
    await userEvent.type(screen.getByLabelText('メールアドレス'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('パスワード'), 'wrong-password-1');
    await userEvent.click(screen.getByRole('button', { name: 'ログイン' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('正しくありません');
  });
});
