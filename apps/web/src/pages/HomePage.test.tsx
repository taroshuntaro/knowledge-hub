import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getFeed = vi.fn();
const getPickup = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    api: {
      articles: {
        $get: (...args: unknown[]) => getFeed(...args),
        pickup: { $get: (...args: unknown[]) => getPickup(...args) },
      },
    },
  },
}));

import { HomePage } from './HomePage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('HomePage', () => {
  beforeEach(() => {
    getFeed.mockReset();
    getPickup.mockReset();
  });

  it('フィード取得が非 2xx のときエラーメッセージを表示し、空表示にはしない', async () => {
    getPickup.mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    getFeed.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ code: 'UNAUTHORIZED', message: 'login required' }),
    });
    renderPage();

    expect(await screen.findByText('読み込みに失敗しました。')).toBeInTheDocument();
    expect(screen.queryByText('記事がありません。')).not.toBeInTheDocument();
  });

  it('フィード記事を一覧表示する', async () => {
    getPickup.mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    getFeed.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{
          id: 'a1', title: '記事タイトル', excerpt: '要約', authorId: 'u1', authorName: '太郎',
          categoryId: null, pinnedAt: null, publishedAt: '2026-07-05T00:00:00Z', updatedAt: '2026-07-05T00:00:00Z',
        }],
        nextCursor: null,
      }),
    });
    renderPage();

    expect(await screen.findByRole('link', { name: /記事タイトル/ })).toHaveAttribute('href', '/articles/a1');
    expect(screen.queryByText('読み込みに失敗しました。')).not.toBeInTheDocument();
  });
});
