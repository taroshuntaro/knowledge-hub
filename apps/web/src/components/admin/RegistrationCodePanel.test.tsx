import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const getCode = vi.fn();
const postCode = vi.fn();
const deleteCode = vi.fn();

vi.mock('../../api/client', () => ({
  api: {
    api: {
      admin: {
        'registration-code': {
          $get: (...args: unknown[]) => getCode(...args),
          $post: (...args: unknown[]) => postCode(...args),
          $delete: (...args: unknown[]) => deleteCode(...args),
        },
      },
    },
  },
}));

import { RegistrationCodePanel } from './RegistrationCodePanel';

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <RegistrationCodePanel />
    </QueryClientProvider>,
  );
}

describe('RegistrationCodePanel', () => {
  beforeEach(() => {
    getCode.mockReset();
    postCode.mockReset();
    deleteCode.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('有効なコードがない場合はその旨を表示する', async () => {
    getCode.mockResolvedValue({ ok: true, json: async () => null });
    renderPanel();
    expect(await screen.findByText('有効なコードはありません')).toBeInTheDocument();
  });

  it('発行すると平文コードが1回だけ表示され、再表示できない旨の文言が出る', async () => {
    getCode.mockResolvedValue({ ok: true, json: async () => null });
    postCode.mockResolvedValue({
      ok: true,
      json: async () => ({ code: 'ABCD-EFGH-JKMN-PQRS', expiresAt: '2026-09-01T00:00:00Z' }),
    });
    renderPanel();
    await screen.findByText('有効なコードはありません');

    await userEvent.click(screen.getByRole('button', { name: '発行' }));

    expect(await screen.findByDisplayValue('ABCD-EFGH-JKMN-PQRS')).toBeInTheDocument();
    expect(screen.getByText(/このコードは再表示できません/)).toBeInTheDocument();
    expect(postCode).toHaveBeenCalledWith({ json: { expiresInDays: 30 } });
  });

  it('メタ情報がある場合は有効期限を表示し、失効ボタンで確認の上 DELETE を呼ぶ', async () => {
    getCode.mockResolvedValue({
      ok: true,
      json: async () => ({ createdAt: '2026-08-01T00:00:00Z', expiresAt: '2026-08-31T00:00:00Z' }),
    });
    deleteCode.mockResolvedValue({ ok: true });
    renderPanel();

    expect(await screen.findByText(/2026年8月31日/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '失効' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(deleteCode).toHaveBeenCalled();
  });
});
