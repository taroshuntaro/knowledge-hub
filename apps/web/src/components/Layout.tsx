import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { Dialog, VisuallyHidden } from 'radix-ui';
import { Menu, PenLine } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { NotificationBell } from './NotificationBell';
import { Button } from '@/components/ui/button';

export function Layout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // ルート遷移でドロワーを閉じる
  useEffect(() => { setOpen(false); }, [location.pathname]);

  return (
    <div className="min-h-screen md:flex">
      {/* デスクトップ: 固定サイドバー列 */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 border-r bg-card md:block">
        <Sidebar />
      </aside>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        {/* モバイル: 上部バー */}
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur md:hidden">
          <Dialog.Trigger asChild>
            <Button
              type="button" variant="ghost" size="icon"
              data-testid="drawer-toggle"
              aria-label="メニューを開く"
            >
              <Menu className="size-5" />
            </Button>
          </Dialog.Trigger>
          <Link to="/" className="text-[15px] font-extrabold tracking-tight">knowledge<span className="text-ring">·</span>hub</Link>
          <div className="flex-1" />
          <NotificationBell />
          <Button asChild size="icon" aria-label="記事を書く"><Link to="/articles/new"><PenLine className="size-4" /></Link></Button>
        </header>

        {/* モバイル: ドロワー（同一 Sidebar） */}
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-30 bg-foreground/30 md:hidden" />
          <Dialog.Content
            className="fixed inset-y-0 left-0 z-40 w-72 border-r bg-card shadow-lg md:hidden"
            aria-label="メインメニュー"
          >
            <VisuallyHidden.Root><Dialog.Title>メニュー</Dialog.Title></VisuallyHidden.Root>
            <Sidebar onNavigate={() => setOpen(false)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
