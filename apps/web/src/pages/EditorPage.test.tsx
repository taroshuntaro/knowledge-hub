import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

const postMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'a1', updatedAt: '2026-07-05T00:00:00Z' }) });
vi.mock('../api/client', () => ({
  api: {
    api: {
      articles: { $post: (...a: unknown[]) => postMock(...a) },
      categories: { $get: vi.fn().mockResolvedValue({ ok: true, json: async () => [] }) },
    },
  },
}));

import { EditorPage } from './EditorPage';

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/articles/new']}>
        <EditorPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EditorPage', () => {
  it('タイトル入力で下書きを作成する（POST 呼び出し）', async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText('タイトル'), 'あたらしい記事');
    await userEvent.click(screen.getByRole('button', { name: '下書き保存' }));
    expect(postMock).toHaveBeenCalled();
  });
});
