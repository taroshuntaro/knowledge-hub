import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMe = vi.fn();
const getCategories = vi.fn();
const logout = vi.fn();

vi.mock('../api/client', () => ({
  api: { api: {
    auth: { me: { $get: (...a: unknown[]) => getMe(...a) }, logout: { $post: (...a: unknown[]) => logout(...a) } },
    categories: { $get: (...a: unknown[]) => getCategories(...a) },
  } },
}));
vi.mock('./NotificationBell', () => ({ NotificationBell: () => <div data-testid="bell" /> }));

import { Sidebar } from './Sidebar';

function renderSidebar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter><Sidebar /></MemoryRouter></QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getMe.mockResolvedValue({ status: 200, ok: true, json: async () => ({ id: 'u1', displayName: '管理者', role: 'admin', avatarUrl: null, bio: '', email: 'a@b.c', authProvider: 'password' }) });
  getCategories.mockResolvedValue({ ok: true, json: async () => ([
    { id: 'c1', name: 'エンジニアリング', parentId: null, sortOrder: 0, children: [
      { id: 'c1a', name: 'バックエンド', parentId: 'c1', sortOrder: 0, children: [] },
    ] },
    { id: 'c2', name: 'デザイン', parentId: null, sortOrder: 1, children: [] },
  ]) });
});

describe('Sidebar', () => {
  it('主要な閲覧・作成ナビを表示する', async () => {
    renderSidebar();
    expect(await screen.findByRole('link', { name: 'フィード' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '記事を書く' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'マイ記事' })).toBeInTheDocument();
  });

  it('カテゴリを 2 階層で表示する', async () => {
    renderSidebar();
    expect(await screen.findByRole('link', { name: 'エンジニアリング' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'バックエンド' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'デザイン' })).toBeInTheDocument();
  });

  it('admin には管理ナビを表示する', async () => {
    renderSidebar();
    expect(await screen.findByRole('link', { name: 'ユーザー' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'カテゴリ管理' })).toBeInTheDocument();
  });

  it('member には管理ナビを表示しない', async () => {
    getMe.mockResolvedValue({ status: 200, ok: true, json: async () => ({ id: 'u2', displayName: '新人', role: 'member', avatarUrl: null, bio: '', email: 'm@b.c', authProvider: 'password' }) });
    renderSidebar();
    expect(await screen.findByRole('link', { name: 'フィード' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'ユーザー' })).not.toBeInTheDocument();
  });

  it('アカウントメニューからログアウトできる', async () => {
    logout.mockResolvedValue({ ok: true });
    renderSidebar();
    await screen.findByRole('link', { name: 'フィード' });
    await userEvent.click(screen.getByRole('button', { name: /アカウント|管理者/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'ログアウト' }));
    expect(logout).toHaveBeenCalled();
  });
});
