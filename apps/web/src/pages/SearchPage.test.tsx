import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSearch = vi.fn();
const getCategories = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    api: {
      search: { $get: (...args: unknown[]) => getSearch(...args) },
      categories: { $get: (...args: unknown[]) => getCategories(...args) },
    },
  },
}));

import { SearchPage } from './SearchPage';

function renderPage(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/search" element={<SearchPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SearchPage', () => {
  beforeEach(() => {
    getSearch.mockReset();
    getCategories.mockReset();
    getCategories.mockResolvedValue({ ok: true, status: 200, json: async () => [] });
  });

  it('/search?q=xxx で検索 API が q 付きで呼ばれ、結果タイトルが表示される', async () => {
    getSearch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{
          id: 'a1', title: '検索結果タイトル', snippet: '抜粋', authorId: 'u1', authorName: '太郎',
          categoryId: null, publishedAt: '2026-07-05T00:00:00Z', updatedAt: '2026-07-05T00:00:00Z',
        }],
        nextCursor: null,
      }),
    });

    renderPage('/search?q=xxx');

    expect(await screen.findByRole('link', { name: /検索結果タイトル/ })).toHaveAttribute('href', '/articles/a1');
    expect(getSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ q: 'xxx' }) }),
    );
  });

  it('結果 0 件のとき EmptyState 文言を表示する', async () => {
    getSearch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [], nextCursor: null }),
    });

    renderPage('/search?q=xxx');

    expect(await screen.findByText('『xxx』に一致する記事はありません')).toBeInTheDocument();
  });

  it('q なしのとき案内文言を表示し、検索 API は呼ばれない', async () => {
    renderPage('/search');

    expect(await screen.findByText('キーワードを入力してください')).toBeInTheDocument();
    expect(getSearch).not.toHaveBeenCalled();
  });
});
