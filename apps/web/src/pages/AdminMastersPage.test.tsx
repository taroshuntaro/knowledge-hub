import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const postDepartment = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
vi.mock('../api/client', () => ({
  api: {
    api: {
      admin: {
        departments: {
          $get: vi.fn().mockResolvedValue({
            ok: true,
            json: async () => [
              { id: 'd1', name: '開発部', sortOrder: 0 },
              { id: 'd2', name: '営業部', sortOrder: 1 },
            ],
          }),
          $post: (...args: unknown[]) => postDepartment(...args),
          ':id': { $patch: vi.fn(), $delete: vi.fn() },
        },
        positions: {
          $get: vi.fn().mockResolvedValue({
            ok: true,
            json: async () => [{ id: 'p1', name: '部長', sortOrder: 0 }],
          }),
          $post: vi.fn(),
          ':id': { $patch: vi.fn(), $delete: vi.fn() },
        },
      },
    },
  },
}));

import { AdminMastersPage } from './AdminMastersPage';

describe('AdminMastersPage', () => {
  it('所属・役職の一覧を表示し、追加フォームから作成できる', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AdminMastersPage />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('開発部')).toBeInTheDocument();
    expect(await screen.findByText('部長')).toBeInTheDocument();

    const section = screen.getByRole('region', { name: '所属' });
    await userEvent.type(within(section).getByLabelText('名称'), '人事部');
    await userEvent.click(within(section).getByRole('button', { name: '追加' }));
    expect(postDepartment).toHaveBeenCalledWith({ json: { name: '人事部' } });
  });
});
