import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
const getUserArticles = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    api: {
      users: {
        ':id': {
          $get: (...args: unknown[]) => getUser(...args),
          articles: { $get: (...args: unknown[]) => getUserArticles(...args) },
        },
      },
    },
  },
}));

import { ProfilePage } from './ProfilePage';

function renderPage(id = 'u1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/users/${id}`]}>
        <Routes>
          <Route path="/users/:id" element={<ProfilePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProfilePage', () => {
  beforeEach(() => {
    getUser.mockReset();
    getUserArticles.mockReset();
  });

  it('displayName と bio を表示する', async () => {
    getUser.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'u1', displayName: '太郎', bio: '自己紹介です', avatarUrl: null, department: null, position: null, hireYear: null }),
    });
    getUserArticles.mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [], nextCursor: null }) });

    renderPage();

    expect(await screen.findByRole('heading', { name: '太郎' })).toBeInTheDocument();
    expect(screen.getByText('自己紹介です')).toBeInTheDocument();
  });

  it('avatarUrl が無い場合はイニシャルプレートを表示する', async () => {
    getUser.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'u1', displayName: '花子', bio: '', avatarUrl: null, department: null, position: null, hireYear: null }),
    });
    getUserArticles.mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [], nextCursor: null }) });

    renderPage();

    expect(await screen.findByText('花')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('執筆記事一覧を表示する', async () => {
    getUser.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'u1', displayName: '太郎', bio: '', avatarUrl: null, department: null, position: null, hireYear: null }),
    });
    getUserArticles.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{
          id: 'a1', title: '記事タイトル', excerpt: '抜粋', authorId: 'u1', authorName: '太郎',
          authorAvatarUrl: null, categoryId: null, categoryName: null, heroImage: null,
          tags: [], reactionCount: 0, commentCount: 0,
          pinnedAt: null, publishedAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z',
        }],
        nextCursor: null,
      }),
    });

    renderPage();

    expect(await screen.findByRole('link', { name: '記事タイトル' })).toHaveAttribute('href', '/articles/a1');
  });

  it('所属・役職・入社年を表示する', async () => {
    getUser.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'u1', displayName: '太郎', bio: '自己紹介です', avatarUrl: null, department: { id: 'd1', name: '開発部' }, position: { id: 'p1', name: '部長' }, hireYear: 2018 }),
    });
    getUserArticles.mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [], nextCursor: null }) });

    renderPage();

    expect(await screen.findByText('開発部 / 部長 ・ 2018 年入社')).toBeInTheDocument();
  });
});
