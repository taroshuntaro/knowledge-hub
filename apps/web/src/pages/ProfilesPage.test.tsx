import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../api/client', () => ({
  api: {
    api: {
      profiles: {
        $get: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            users: [
              { id: '1', displayName: '佐藤花子', avatarUrl: null, bio: '',
                department: { id: 'd1', name: '開発部' }, position: { id: 'p1', name: '部長' }, hireYear: 2015 },
              { id: '2', displayName: '鈴木一郎', avatarUrl: null, bio: '',
                department: { id: 'd2', name: '営業部' }, position: { id: 'p2', name: 'メンバー' }, hireYear: 2021 },
              { id: '3', displayName: '高橋未設定', avatarUrl: null, bio: '',
                department: null, position: null, hireYear: null },
            ],
            departments: [
              { id: 'd1', name: '開発部', sortOrder: 0 },
              { id: 'd2', name: '営業部', sortOrder: 1 },
            ],
            positions: [
              { id: 'p1', name: '部長', sortOrder: 0 },
              { id: 'p2', name: 'メンバー', sortOrder: 1 },
            ],
          }),
        }),
      },
    },
  },
}));

import { ProfilesPage } from './ProfilesPage';

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><ProfilesPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProfilesPage', () => {
  it('全員をカード表示し、件数を出す', async () => {
    renderPage();
    expect(await screen.findByText('佐藤花子')).toBeInTheDocument();
    expect(screen.getByText('鈴木一郎')).toBeInTheDocument();
    expect(screen.getByText('3 人')).toBeInTheDocument();
  });

  it('名前で検索できる', async () => {
    renderPage();
    await screen.findByText('佐藤花子');
    await userEvent.type(screen.getByRole('searchbox', { name: '名前で検索' }), '鈴木');
    expect(screen.queryByText('佐藤花子')).not.toBeInTheDocument();
    expect(screen.getByText('鈴木一郎')).toBeInTheDocument();
  });

  it('所属で絞り込める（未設定ユーザーは出ない）', async () => {
    renderPage();
    await screen.findByText('佐藤花子');
    await userEvent.selectOptions(screen.getByLabelText('所属'), 'd1');
    expect(screen.getByText('佐藤花子')).toBeInTheDocument();
    expect(screen.queryByText('鈴木一郎')).not.toBeInTheDocument();
    expect(screen.queryByText('高橋未設定')).not.toBeInTheDocument();
  });

  it('役職順の並び替えは sortOrder 順、未設定は末尾', async () => {
    renderPage();
    await screen.findByText('佐藤花子');
    await userEvent.selectOptions(screen.getByLabelText('並び替え'), 'position');
    const names = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(names).toEqual(['佐藤花子', '鈴木一郎', '高橋未設定']);
  });

  it('入社年の降順で並び替えられる', async () => {
    renderPage();
    await screen.findByText('佐藤花子');
    await userEvent.selectOptions(screen.getByLabelText('並び替え'), 'hireYearDesc');
    const names = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(names).toEqual(['鈴木一郎', '佐藤花子', '高橋未設定']);
  });
});
