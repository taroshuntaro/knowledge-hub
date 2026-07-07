import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getList = vi.fn();
const getUnread = vi.fn();
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
        'unread-count': { $get: (...args: unknown[]) => getUnread(...args) },
        'read-all': { $post: vi.fn() },
        ':notificationId': { read: { $post: (...args: unknown[]) => postRead(...args) } },
      },
    },
  },
}));

import { NotificationBell } from './NotificationBell';

const item = {
  id: 'n1', type: 'comment', actorId: 'u2', actorName: '花子',
  articleId: 'a1', articleTitle: 'テスト記事', commentId: 'c1',
  readAt: null, createdAt: '2026-07-07T00:00:00.000Z',
};

function renderBell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NotificationBell', () => {
  beforeEach(() => {
    getList.mockReset();
    getUnread.mockReset();
    postRead.mockReset();
    navigateSpy.mockReset();
  });

  it('未読数バッジを表示する', async () => {
    getUnread.mockResolvedValue({ ok: true, json: async () => ({ count: 3 }) });
    renderBell();
    expect(await screen.findByText('3')).toBeInTheDocument();
  });

  it('未読 0 ならバッジを出さない', async () => {
    getUnread.mockResolvedValue({ ok: true, json: async () => ({ count: 0 }) });
    renderBell();
    expect(await screen.findByRole('button', { name: '通知' })).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('開くと直近の通知が表示され、クリックで既読 API が呼ばれる', async () => {
    getUnread.mockResolvedValue({ ok: true, json: async () => ({ count: 1 }) });
    getList.mockResolvedValue({ ok: true, json: async () => ({ items: [item], nextCursor: null }) });
    postRead.mockResolvedValue({ ok: true, status: 204 });
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: '通知' }));
    const entry = await screen.findByText('花子さんが「テスト記事」にコメントしました');
    await userEvent.click(entry);
    expect(postRead).toHaveBeenCalledWith({ param: { notificationId: 'n1' } });
  });

  it('既読 API が失敗しても記事へ遷移する', async () => {
    getUnread.mockResolvedValue({ ok: true, json: async () => ({ count: 1 }) });
    getList.mockResolvedValue({ ok: true, json: async () => ({ items: [item], nextCursor: null }) });
    postRead.mockRejectedValue(new Error('network error'));
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: '通知' }));
    const entry = await screen.findByText('花子さんが「テスト記事」にコメントしました');
    await userEvent.click(entry);
    expect(postRead).toHaveBeenCalledWith({ param: { notificationId: 'n1' } });
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/articles/a1'));
  });
});
