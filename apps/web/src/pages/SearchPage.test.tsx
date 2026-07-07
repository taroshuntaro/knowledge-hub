import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('キーワード入力欄からの検索で API が呼ばれ、結果が表示される', async () => {
    const user = userEvent.setup();
    getSearch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{
          id: 'a2', title: '入力検索結果', snippet: '抜粋', authorId: 'u1', authorName: '太郎',
          categoryId: null, publishedAt: '2026-07-05T00:00:00Z', updatedAt: '2026-07-05T00:00:00Z',
        }],
        nextCursor: null,
      }),
    });

    renderPage('/search');

    expect(await screen.findByText('キーワードを入力してください')).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'キーワード' }), 'yyy');
    await user.click(screen.getByRole('button', { name: '検索' }));

    expect(await screen.findByRole('link', { name: /入力検索結果/ })).toHaveAttribute('href', '/articles/a2');
    expect(getSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ q: 'yyy' }) }),
    );
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

  it('/search?q=xxx&authorId=... で検索 API が authorId 付きで呼ばれる', async () => {
    getSearch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [], nextCursor: null }),
    });

    renderPage('/search?q=xxx&authorId=11111111-1111-1111-1111-111111111111');

    await screen.findByText('『xxx』に一致する記事はありません');
    expect(getSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          q: 'xxx',
          authorId: '11111111-1111-1111-1111-111111111111',
        }),
      }),
    );
  });

  it('authorId のみが異なる検索は queryKey が別になり、キャッシュを共有せず再フェッチされる', async () => {
    getSearch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [], nextCursor: null }),
    });

    // 同一の queryClient を共有した状態で、authorId だけが異なる URL を別マウントで描画する。
    // queryKey に authorId が含まれていればキャッシュがヒットせず、必ず 2 回 API が呼ばれる。
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function renderWithSharedClient(path: string) {
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

    const first = renderWithSharedClient('/search?q=xxx');
    await screen.findByText('『xxx』に一致する記事はありません');
    expect(getSearch).toHaveBeenCalledTimes(1);
    first.unmount();

    renderWithSharedClient('/search?q=xxx&authorId=22222222-2222-2222-2222-222222222222');
    await screen.findByText('『xxx』に一致する記事はありません');

    // authorId 違いは別 queryKey のため、キャッシュヒットせず再度 API が呼ばれる
    expect(getSearch).toHaveBeenCalledTimes(2);
    expect(getSearch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          q: 'xxx',
          authorId: '22222222-2222-2222-2222-222222222222',
        }),
      }),
    );
  });
});
