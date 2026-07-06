import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getBookmarks = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    api: {
      me: {
        bookmarks: { $get: (...args: unknown[]) => getBookmarks(...args) },
      },
    },
  },
}));

import { BookmarksPage } from './BookmarksPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <BookmarksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function article(id: string, title: string) {
  return {
    id, title, excerpt: '', authorId: 'u1', authorName: '著者',
    categoryId: null, pinnedAt: null, publishedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('BookmarksPage', () => {
  beforeEach(() => {
    getBookmarks.mockReset();
  });

  it('ブックマーク一覧が描画される', async () => {
    getBookmarks.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [article('a1', '記事1'), article('a2', '記事2')], nextCursor: null }),
    });

    renderPage();

    expect(await screen.findByText('記事1')).toBeInTheDocument();
    expect(screen.getByText('記事2')).toBeInTheDocument();
  });

  it('0 件のとき EmptyState 文言が表示される', async () => {
    getBookmarks.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [], nextCursor: null }),
    });

    renderPage();

    expect(await screen.findByText('ブックマークした記事はまだありません。')).toBeInTheDocument();
  });
});
