import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const me = {
  id: 'u1',
  email: 'a@example.com',
  displayName: '著者',
  role: 'member',
  avatarUrl: null,
  bio: '',
};

const article = {
  id: 'a1',
  authorId: 'u1',
  authorName: '著者',
  authorAvatarUrl: null,
  categoryId: 'c1',
  categoryName: null,
  heroImage: null,
  title: 'テスト記事',
  bodyMd: '# 本文',
  status: 'published',
  pinnedAt: null,
  publishedAt: '2026-07-01T00:00:00Z',
  deletedAt: null,
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z',
  tags: [],
};

const getArticle = vi.fn();
const deleteArticle = vi.fn();
const restoreArticle = vi.fn();
const purgeArticle = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    api: {
      auth: { me: { $get: () => Promise.resolve({ ok: true, status: 200, json: async () => me }) } },
      articles: {
        ':id': {
          $get: (...args: unknown[]) => getArticle(...args),
          $delete: (...args: unknown[]) => deleteArticle(...args),
          pin: { $post: vi.fn() },
          unpin: { $post: vi.fn() },
          restore: { $post: (...args: unknown[]) => restoreArticle(...args) },
          purge: { $delete: (...args: unknown[]) => purgeArticle(...args) },
        },
      },
    },
  },
}));

import { ArticleDetailPage } from './ArticleDetailPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/articles/a1']}>
        <Routes>
          <Route path="/articles/:id" element={<ArticleDetailPage />} />
          <Route path="/me/articles" element={<p>マイ記事一覧</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ArticleDetailPage', () => {
  beforeEach(() => {
    getArticle.mockReset();
    deleteArticle.mockReset();
    restoreArticle.mockReset();
    purgeArticle.mockReset();
  });

  const trashed = { ...article, status: 'draft', deletedAt: '2026-07-02T00:00:00Z' };

  it('ゴミ箱記事では編集/ゴミ箱へを出さず、復元/完全削除を出す', async () => {
    getArticle.mockResolvedValue({ ok: true, status: 200, json: async () => trashed });
    renderPage();

    expect(await screen.findByRole('button', { name: '復元' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '完全に削除' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '編集' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ゴミ箱へ' })).not.toBeInTheDocument();
  });

  it('復元ボタンで restore エンドポイントを呼ぶ', async () => {
    getArticle.mockResolvedValue({ ok: true, status: 200, json: async () => trashed });
    restoreArticle.mockResolvedValue({ ok: true });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: '復元' }));
    await waitFor(() => expect(restoreArticle).toHaveBeenCalledWith({ param: { id: 'a1' } }));
  });

  it('完全削除は確認後に purge エンドポイントを呼びマイ記事へ遷移する', async () => {
    getArticle.mockResolvedValue({ ok: true, status: 200, json: async () => trashed });
    purgeArticle.mockResolvedValue({ ok: true });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      renderPage();
      await userEvent.click(await screen.findByRole('button', { name: '完全に削除' }));
      await waitFor(() => expect(purgeArticle).toHaveBeenCalledWith({ param: { id: 'a1' } }));
      expect(await screen.findByText('マイ記事一覧')).toBeInTheDocument();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('削除失敗時はページに留まり、エラーメッセージを表示する', async () => {
    getArticle.mockResolvedValue({ ok: true, status: 200, json: async () => article });
    deleteArticle.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ code: 'FORBIDDEN', message: 'この記事を操作する権限がありません' }),
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'ゴミ箱へ' }));

    expect(await screen.findByText('この記事を操作する権限がありません')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'テスト記事' })).toBeInTheDocument();
    expect(screen.queryByText('マイ記事一覧')).not.toBeInTheDocument();
  });

  it('削除がネットワーク例外でもエラーメッセージを表示してページに留まる（M-5）', async () => {
    getArticle.mockResolvedValue({ ok: true, status: 200, json: async () => article });
    deleteArticle.mockRejectedValue(new TypeError('fetch failed'));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'ゴミ箱へ' }));

    expect(await screen.findByText(/通信に失敗/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'テスト記事' })).toBeInTheDocument();
  });

  it('取得エラー時は not-found ではなくエラーメッセージを表示する', async () => {
    getArticle.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ code: 'INTERNAL', message: 'server error' }),
    });
    renderPage();

    expect(await screen.findByText('読み込みに失敗しました。')).toBeInTheDocument();
    expect(screen.queryByText('記事が見つかりません。')).not.toBeInTheDocument();
  });

  it('ヒーロー・戻る導線・カテゴリ・タグ・著者・アクションを表示する', async () => {
    getArticle.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ...article,
        heroImage: '/api/uploads/up1',
        categoryName: 'デザイン',
        authorAvatarUrl: null,
        tags: ['a'],
        publishedAt: '2026-07-05T12:00:00Z',
      }),
    });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'テスト記事' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /フィードに戻る/ })).toBeInTheDocument();
    expect(screen.getByText('デザイン')).toBeInTheDocument();
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', '/api/uploads/up1');
    expect(screen.getByText('2026年7月5日')).toBeInTheDocument();
  });

  it('ゴミ箱へは destructive ボタン（テキストリンクでない）', async () => {
    getArticle.mockResolvedValue({ ok: true, status: 200, json: async () => article });
    renderPage();

    const trashButton = await screen.findByRole('button', { name: 'ゴミ箱へ' });
    expect(trashButton).toHaveClass('border-destructive');
  });

  it('ヒーロー画像が未設定なら img を表示しない', async () => {
    getArticle.mockResolvedValue({ ok: true, status: 200, json: async () => article });
    renderPage();

    await screen.findByRole('heading', { name: 'テスト記事' });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('下書き記事ではコメント欄・リアクション・ブックマークを表示しない', async () => {
    getArticle.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...article, status: 'draft' }),
    });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'テスト記事' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'コメント' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'コメントする' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'リアクション' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ブックマーク/ })).not.toBeInTheDocument();
  });
});
