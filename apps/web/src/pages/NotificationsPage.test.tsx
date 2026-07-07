import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getList = vi.fn();
const getUnreadCount = vi.fn();
const postReadAll = vi.fn();
const postRead = vi.fn();
const navigateSpy = vi.fn();

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => navigateSpy };
});

vi.mock('../api/client', () => ({
  api: {
    api: {
      notifications: {
        $get: (...args: unknown[]) => getList(...args),
        'unread-count': { $get: (...args: unknown[]) => getUnreadCount(...args) },
        'read-all': { $post: (...args: unknown[]) => postReadAll(...args) },
        ':notificationId': { read: { $post: (...args: unknown[]) => postRead(...args) } },
      },
    },
  },
}));

import { NotificationsPage } from './NotificationsPage';

const items = [
  {
    id: 'n1', type: 'mention', actorId: 'u2', actorName: '花子',
    articleId: 'a1', articleTitle: '記事A', commentId: null,
    readAt: null, createdAt: '2026-07-07T00:00:00.000Z',
  },
  {
    id: 'n2', type: 'reaction', actorId: 'u3', actorName: '次郎',
    articleId: 'a2', articleTitle: '記事B', commentId: null,
    readAt: '2026-07-06T00:00:00.000Z', createdAt: '2026-07-06T00:00:00.000Z',
  },
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NotificationsPage', () => {
  beforeEach(() => {
    getList.mockReset();
    getUnreadCount.mockReset();
    getUnreadCount.mockResolvedValue({ ok: true, json: async () => ({ count: 0 }) });
    postReadAll.mockReset();
    postRead.mockReset();
    navigateSpy.mockReset();
  });

  it('通知を一覧表示する', async () => {
    getList.mockResolvedValue({ ok: true, json: async () => ({ items, nextCursor: null }) });
    renderPage();
    expect(await screen.findByText('花子さんが「記事A」であなたをメンションしました')).toBeInTheDocument();
    expect(screen.getByText('次郎さんが「記事B」にリアクションしました')).toBeInTheDocument();
  });

  it('空のときは EmptyState を表示する', async () => {
    getList.mockResolvedValue({ ok: true, json: async () => ({ items: [], nextCursor: null }) });
    renderPage();
    expect(await screen.findByText('通知はまだありません')).toBeInTheDocument();
  });

  it('「すべて既読にする」で read-all API が呼ばれる', async () => {
    getList.mockResolvedValue({ ok: true, json: async () => ({ items, nextCursor: null }) });
    getUnreadCount.mockResolvedValue({ ok: true, json: async () => ({ count: 1 }) });
    postReadAll.mockResolvedValue({ ok: true, status: 204 });
    renderPage();
    await screen.findByText('花子さんが「記事A」であなたをメンションしました');
    await userEvent.click(await screen.findByRole('button', { name: 'すべて既読にする' }));
    expect(postReadAll).toHaveBeenCalled();
  });

  it('未読通知のクリックで既読 API が呼ばれる', async () => {
    getList.mockResolvedValue({ ok: true, json: async () => ({ items, nextCursor: null }) });
    postRead.mockResolvedValue({ ok: true, status: 204 });
    renderPage();
    await userEvent.click(await screen.findByText('花子さんが「記事A」であなたをメンションしました'));
    expect(postRead).toHaveBeenCalledWith({ param: { notificationId: 'n1' } });
  });

  it('既読 API が失敗しても記事へ遷移する', async () => {
    getList.mockResolvedValue({ ok: true, json: async () => ({ items, nextCursor: null }) });
    postRead.mockRejectedValue(new Error('network error'));
    renderPage();
    await userEvent.click(await screen.findByText('花子さんが「記事A」であなたをメンションしました'));
    expect(postRead).toHaveBeenCalledWith({ param: { notificationId: 'n1' } });
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/articles/a1'));
  });

  it('読み込み済みページが全既読でも未読件数があればボタンを表示する', async () => {
    getList.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [items[1]], nextCursor: null }),
    });
    getUnreadCount.mockResolvedValue({ ok: true, json: async () => ({ count: 3 }) });
    renderPage();
    await screen.findByText('次郎さんが「記事B」にリアクションしました');
    expect(await screen.findByRole('button', { name: 'すべて既読にする' })).toBeInTheDocument();
  });

  it('未読件数が 0 のときはボタンを表示しない', async () => {
    getList.mockResolvedValue({ ok: true, json: async () => ({ items: [items[1]], nextCursor: null }) });
    getUnreadCount.mockResolvedValue({ ok: true, json: async () => ({ count: 0 }) });
    renderPage();
    await screen.findByText('次郎さんが「記事B」にリアクションしました');
    expect(screen.queryByRole('button', { name: 'すべて既読にする' })).not.toBeInTheDocument();
  });
});
