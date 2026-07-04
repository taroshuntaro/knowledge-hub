import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../api/client', () => ({
  api: {
    api: {
      admin: {
        users: {
          $get: vi.fn().mockResolvedValue({
            ok: true,
            json: async () => [
              { id: '1', email: 'a@example.com', displayName: '管理者', role: 'admin', authProvider: 'password', isActive: true, createdAt: '2026-07-04T00:00:00Z' },
              { id: '2', email: 'b@example.com', displayName: '太郎', role: 'member', authProvider: 'password', isActive: false, createdAt: '2026-07-04T00:00:00Z' },
            ],
          }),
          invitations: { $post: vi.fn() },
          ':id': { $patch: vi.fn() },
        },
      },
    },
  },
}));

import { AdminUsersPage } from './AdminUsersPage';

describe('AdminUsersPage', () => {
  it('ユーザー一覧を表示し、無効ユーザーにはラベルが付く', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AdminUsersPage />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('a@example.com')).toBeInTheDocument();
    expect(await screen.findByText('無効')).toBeInTheDocument();
  });
});
