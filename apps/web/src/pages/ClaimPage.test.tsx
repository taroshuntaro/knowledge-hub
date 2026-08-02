import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const postMock = vi.fn();
const navigateMock = vi.fn();
vi.mock('../api/client', () => ({
  api: {
    api: {
      auth: {
        claim: { $post: (...a: unknown[]) => postMock(...a) },
      },
    },
  },
}));
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => navigateMock };
});

import { ClaimPage } from './ClaimPage';

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/claim']}>
      <ClaimPage />
    </MemoryRouter>,
  );
}

describe('ClaimPage', () => {
  beforeEach(() => {
    postMock.mockReset();
    navigateMock.mockReset();
  });

  it('入力値で claim API を呼び、成功で / へ遷移する', async () => {
    postMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    renderPage();
    await userEvent.type(screen.getByLabelText('メールアドレス'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('登録コード'), 'ABC123');
    await userEvent.type(screen.getByLabelText('パスワード（12文字以上）'), 'my-password-123');
    await userEvent.click(screen.getByRole('button', { name: '登録する' }));

    expect(postMock).toHaveBeenCalledWith({
      json: { email: 'a@example.com', code: 'ABC123', password: 'my-password-123' },
    });
    expect(navigateMock).toHaveBeenCalledWith('/');
  });

  it('失敗時はサーバーのメッセージを role=alert で表示する', async () => {
    postMock.mockResolvedValue({
      ok: false,
      json: async () => ({ code: 'CLAIM_INVALID', message: '登録コードまたはメールアドレスが正しくありません' }),
    });
    renderPage();
    await userEvent.type(screen.getByLabelText('メールアドレス'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('登録コード'), 'WRONG');
    await userEvent.type(screen.getByLabelText('パスワード（12文字以上）'), 'my-password-123');
    await userEvent.click(screen.getByRole('button', { name: '登録する' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('登録コードまたはメールアドレスが正しくありません');
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('ネットワーク例外でもエラーメッセージを表示する', async () => {
    postMock.mockRejectedValue(new TypeError('fetch failed'));
    renderPage();
    await userEvent.type(screen.getByLabelText('メールアドレス'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('登録コード'), 'ABC123');
    await userEvent.type(screen.getByLabelText('パスワード（12文字以上）'), 'my-password-123');
    await userEvent.click(screen.getByRole('button', { name: '登録する' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/通信に失敗/);
  });
});
