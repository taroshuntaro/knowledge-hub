import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMine = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    api: {
      articles: {
        mine: { $get: (...args: unknown[]) => getMine(...args) },
      },
    },
  },
}));

import { MyArticlesPage } from './MyArticlesPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MyArticlesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MyArticlesPage', () => {
  beforeEach(() => {
    getMine.mockReset();
  });

  it('取得が非 2xx のときエラーメッセージを表示し、空表示にはしない', async () => {
    getMine.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ code: 'UNAUTHORIZED', message: 'login required' }),
    });
    renderPage();

    expect(await screen.findByText('読み込みに失敗しました。')).toBeInTheDocument();
    expect(screen.queryByText('記事がありません。')).not.toBeInTheDocument();
  });
});
