import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const postMock = vi.fn();
const getMock = vi.fn();
const publishMock = vi.fn();
const navigateMock = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    api: {
      articles: {
        $post: (...a: unknown[]) => postMock(...a),
        ':id': {
          $get: (...a: unknown[]) => getMock(...a),
          publish: { $post: (...a: unknown[]) => publishMock(...a) },
        },
      },
      categories: { $get: vi.fn().mockResolvedValue({ ok: true, json: async () => [] }) },
    },
  },
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => navigateMock };
});

import { EditorPage } from './EditorPage';

function renderNew() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/articles/new']}>
        <Routes>
          <Route path="/articles/new" element={<EditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderEdit(id: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/articles/${id}/edit`]}>
        <Routes>
          <Route path="/articles/:id/edit" element={<EditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EditorPage', () => {
  beforeEach(() => {
    postMock.mockReset();
    getMock.mockReset();
    publishMock.mockReset();
    navigateMock.mockReset();
  });

  it('タイトル入力で下書きを作成する（POST 呼び出し）', async () => {
    postMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'a1', updatedAt: '2026-07-05T00:00:00Z' }) });
    renderNew();
    await userEvent.type(screen.getByLabelText('タイトル'), 'あたらしい記事');
    await userEvent.click(screen.getByRole('button', { name: '下書き保存' }));
    expect(postMock).toHaveBeenCalled();
  });

  it('新規記事を公開すると、保存で得た id で公開 API を呼ぶ（自動保存を待たずに）', async () => {
    postMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'a1', updatedAt: '2026-07-05T00:00:00Z' }) });
    publishMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    renderNew();
    await userEvent.type(screen.getByLabelText('タイトル'), 'あたらしい記事');
    await userEvent.click(screen.getByRole('button', { name: '公開する' }));
    expect(publishMock).toHaveBeenCalledWith({ param: { id: 'a1' } });
    expect(navigateMock).toHaveBeenCalledWith('/articles/a1');
  });

  it('既存記事の読み込みに失敗したらエラー表示し、エディタフォームは出さない', async () => {
    getMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    renderEdit('a1');
    expect(await screen.findByRole('alert')).toHaveTextContent('記事の読み込みに失敗しました');
    expect(screen.queryByLabelText('タイトル')).not.toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });
});
