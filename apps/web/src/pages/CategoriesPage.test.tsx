import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCategories = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    api: {
      categories: { $get: (...args: unknown[]) => getCategories(...args) },
    },
  },
}));

import { CategoriesPage } from './CategoriesPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/categories']}>
        <Routes>
          <Route path="/categories" element={<CategoriesPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CategoriesPage', () => {
  beforeEach(() => {
    getCategories.mockReset();
  });

  it('親カテゴリと子カテゴリへのリンクを表示する', async () => {
    getCategories.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ([
        {
          id: 'c1', name: 'エンジニアリング', parentId: null, sortOrder: 0, children: [
            { id: 'c1a', name: 'バックエンド', parentId: 'c1', sortOrder: 0, children: [] },
          ],
        },
        { id: 'c2', name: 'デザイン', parentId: null, sortOrder: 1, children: [] },
      ]),
    });

    renderPage();

    expect(await screen.findByRole('link', { name: 'エンジニアリング' })).toHaveAttribute('href', '/categories/c1');
    expect(screen.getByRole('link', { name: 'バックエンド' })).toHaveAttribute('href', '/categories/c1a');
    expect(screen.getByRole('link', { name: 'デザイン' })).toHaveAttribute('href', '/categories/c2');
  });

  it('カテゴリが 0 件のとき EmptyState を表示する', async () => {
    getCategories.mockResolvedValue({ ok: true, status: 200, json: async () => [] });

    renderPage();

    expect(await screen.findByText('カテゴリがありません')).toBeInTheDocument();
  });
});
