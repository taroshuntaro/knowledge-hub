import { useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useMe } from '../auth/useMe';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemeToggle } from '@/components/ThemeToggle';
import { NotificationBell } from './NotificationBell';

export function Layout() {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState('');

  async function onLogout() {
    await api.api.auth.logout.$post();
    await queryClient.invalidateQueries({ queryKey: ['me'] });
    navigate('/login');
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        {/* h-14 固定だと 375px で nav の折返しがはみ出すため min-h-14 にしている */}
        <div className="mx-auto flex min-h-14 max-w-5xl items-center justify-between gap-4 px-4 py-2">
          <Link to="/" className="text-lg font-bold tracking-tight">knowledge-hub</Link>
          <nav className="flex flex-wrap items-center gap-1 text-sm">
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                const q = searchInput.trim();
                if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
              }}
            >
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="記事を検索"
                aria-label="記事を検索"
                className="h-8 w-36 lg:w-56"
              />
            </form>
            <Link to="/articles/new" className="rounded-md px-3 py-2 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">記事を書く</Link>
            <Link to="/me/articles" className="rounded-md px-3 py-2 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">マイ記事</Link>
            <Link to="/me/bookmarks" className="rounded-md px-3 py-2 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">ブックマーク</Link>
            {me?.role === 'admin' && <Link to="/admin/categories" className="rounded-md px-3 py-2 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">カテゴリ</Link>}
            {me?.role === 'admin' && <Link to="/admin" className="rounded-md px-3 py-2 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">管理</Link>}
            <Link to="/settings" className="rounded-md px-3 py-2 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">設定</Link>
            <span className="hidden px-2 text-muted-foreground sm:inline">{me?.displayName}</span>
            <NotificationBell />
            <ThemeToggle />
            <Button type="button" variant="outline" size="sm" onClick={onLogout}>ログアウト</Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
