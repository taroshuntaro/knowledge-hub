import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const patchUser = vi.fn().mockResolvedValue({ ok: true });
const postImport = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ updated: 2, createdDepartments: ['人事部'], createdPositions: [] }),
});
vi.mock('../api/client', () => ({
  api: {
    api: {
      admin: {
        users: {
          $get: vi.fn().mockResolvedValue({
            ok: true,
            json: async () => [
              { id: '1', email: 'a@example.com', displayName: '管理者', role: 'admin', authProvider: 'password', isActive: true, createdAt: '2026-07-04T00:00:00Z', avatarUrl: null, departmentId: 'd1', positionId: null, hireYear: 2015 },
              { id: '2', email: 'b@example.com', displayName: '太郎', role: 'member', authProvider: 'password', isActive: false, createdAt: '2026-07-04T00:00:00Z', avatarUrl: null, departmentId: null, positionId: null, hireYear: null },
            ],
          }),
          invitations: { $post: vi.fn() },
          import: { $post: (...args: unknown[]) => postImport(...args) },
          ':id': { $patch: (...args: unknown[]) => patchUser(...args) },
        },
        departments: {
          $get: vi.fn().mockResolvedValue({
            ok: true, json: async () => [{ id: 'd1', name: '開発部', sortOrder: 0 }],
          }),
          $post: vi.fn(), ':id': { $patch: vi.fn(), $delete: vi.fn() },
        },
        positions: {
          $get: vi.fn().mockResolvedValue({
            ok: true, json: async () => [{ id: 'p1', name: '部長', sortOrder: 0 }],
          }),
          $post: vi.fn(), ':id': { $patch: vi.fn(), $delete: vi.fn() },
        },
      },
    },
  },
}));

import { AdminUsersPage } from './AdminUsersPage';

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AdminUsersPage />
    </QueryClientProvider>,
  );
}

describe('AdminUsersPage', () => {
  it('ユーザー一覧を表示し、無効ユーザーにはラベルが付く', async () => {
    renderPage();
    expect(await screen.findByText('a@example.com')).toBeInTheDocument();
    expect(await screen.findByText('無効')).toBeInTheDocument();

    const deactivateButton = await screen.findByRole('button', { name: '無効化' });
    expect(deactivateButton).toHaveClass('border-destructive', 'text-destructive');

    const activateButton = await screen.findByRole('button', { name: '有効化' });
    expect(activateButton).not.toHaveClass('border-destructive');
  });

  it('所属セレクトの変更で PATCH が飛ぶ（未選択は null）', async () => {
    renderPage();
    await screen.findByText('a@example.com');
    const select = screen.getByLabelText('管理者 の所属');
    expect(select).toHaveValue('d1');
    await userEvent.selectOptions(select, '');
    expect(patchUser).toHaveBeenCalledWith({ param: { id: '1' }, json: { departmentId: null } });
  });

  it('CSV アップロードの成功サマリを表示する', async () => {
    renderPage();
    await screen.findByText('a@example.com');
    const file = new File(['email,department,position,hire_year\n'], 'org.csv', { type: 'text/csv' });
    await userEvent.upload(screen.getByLabelText('CSV ファイル'), file);
    await userEvent.click(screen.getByRole('button', { name: 'インポート' }));
    expect(await screen.findByText(/2 人を更新/)).toBeInTheDocument();
    expect(screen.getByText(/人事部/)).toBeInTheDocument();
  });
});
