import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { Menu, X, PenLine } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { NotificationBell } from './NotificationBell';
import { Button } from '@/components/ui/button';

export function Layout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // ルート遷移でドロワーを閉じる
  useEffect(() => { setOpen(false); }, [location.pathname]);
  // Esc で閉じる
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="min-h-screen md:flex">
      {/* デスクトップ: 固定サイドバー列 */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 border-r bg-card md:block">
        <Sidebar />
      </aside>

      {/* モバイル: 上部バー */}
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur md:hidden">
        <Button
          type="button" variant="ghost" size="icon"
          data-testid="drawer-toggle"
          aria-label={open ? 'メニューを閉じる' : 'メニューを開く'}
          aria-expanded={open}
          aria-controls="mobile-drawer"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </Button>
        <Link to="/" className="text-[15px] font-extrabold tracking-tight">knowledge<span className="text-ring">·</span>hub</Link>
        <div className="flex-1" />
        <NotificationBell />
        <Button asChild size="icon" aria-label="記事を書く"><Link to="/articles/new"><PenLine className="size-4" /></Link></Button>
      </header>

      {/* モバイル: ドロワー（同一 Sidebar）＋ scrim */}
      {open && (
        <div className="fixed inset-0 z-30 md:hidden">
          <button
            type="button" aria-label="メニューを閉じる"
            className="absolute inset-0 bg-foreground/30"
            onClick={() => setOpen(false)}
          />
          <div id="mobile-drawer" className="absolute inset-y-0 left-0 w-72 border-r bg-card shadow-lg">
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
