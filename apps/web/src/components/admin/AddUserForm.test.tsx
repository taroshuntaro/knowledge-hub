import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const postUser = vi.fn();

vi.mock('../../api/client', () => ({
  api: {
    api: {
      admin: {
        users: {
          $post: (...args: unknown[]) => postUser(...args),
        },
        departments: {
          $get: vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'd1', name: '開発部', sortOrder: 0 }] }),
        },
        positions: {
          $get: vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'p1', name: '部長', sortOrder: 0 }] }),
        },
      },
    },
  },
}));

import { AddUserForm } from './AddUserForm';

function renderForm() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AddUserForm />
    </QueryClientProvider>,
  );
}

describe('AddUserForm', () => {
  beforeEach(() => {
    postUser.mockReset();
  });

  it('email と表示名を入力して送信すると POST /users が呼ばれ、成功メッセージが出る', async () => {
    postUser.mockResolvedValue({ ok: true, json: async () => ({ id: 'u1' }) });
    renderForm();

    await userEvent.type(screen.getByLabelText('メール'), 'new@example.com');
    await userEvent.type(screen.getByLabelText('表示名'), '新人太郎');
    await userEvent.click(screen.getByRole('button', { name: '追加' }));

    expect(postUser).toHaveBeenCalledWith({
      json: {
        email: 'new@example.com',
        displayName: '新人太郎',
        departmentId: null,
        positionId: null,
        hireYear: null,
      },
    });
    expect(await screen.findByText(/追加しました/)).toBeInTheDocument();
  });
});
