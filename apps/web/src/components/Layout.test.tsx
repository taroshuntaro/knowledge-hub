import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./Sidebar', () => ({ Sidebar: () => <nav aria-label="メインナビ">nav</nav> }));
vi.mock('./NotificationBell', () => ({ NotificationBell: () => <div data-testid="bell" /> }));

import { Layout } from './Layout';

function renderLayout() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <Routes><Route element={<Layout />}><Route path="/" element={<div>ホーム本文</div>} /></Route></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Layout', () => {
  it('本文（Outlet）とナビを描画する', () => {
    renderLayout();
    expect(screen.getByText('ホーム本文')).toBeInTheDocument();
    expect(screen.getAllByLabelText('メインナビ').length).toBeGreaterThan(0);
  });

  it('モバイルのメニューボタンでドロワーが開閉する（aria-expanded）', async () => {
    renderLayout();
    const toggle = screen.getByRole('button', { name: 'メニューを開く' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    // 開状態では scrim にも「メニューを閉じる」の accessible name が付くため、
    // aria-expanded を持つトグル自体は data-testid で一意に特定する。
    expect(screen.getByTestId('drawer-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  it('Esc でドロワーが閉じる', async () => {
    renderLayout();
    await userEvent.click(screen.getByRole('button', { name: 'メニューを開く' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'メニューを開く' })).toHaveAttribute('aria-expanded', 'false');
  });
});
