import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bookmark, FolderTree, Home, PenLine, Search, Settings, Users, LogOut, ChevronRight,
} from 'lucide-react';
import { api } from '../api/client';
import { useMe } from '../auth/useMe';
import { categoryColorClass } from '../lib/category-color';
import { NotificationBell } from './NotificationBell';
import { ThemeToggle } from './ThemeToggle';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type CategoryNode = { id: string; name: string; parentId: string | null; sortOrder: number; children: CategoryNode[] };

const navLink =
  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground';

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const res = await api.api.categories.$get();
      if (!res.ok) throw new Error('failed');
      return (await res.json()) as CategoryNode[];
    },
    staleTime: 300_000,
  });

  async function onLogout() {
    await api.api.auth.logout.$post();
    await queryClient.clear();
    navigate('/login');
  }

  const Item = ({ to, icon: Icon, label }: { to: string; icon: typeof Home; label: string }) => (
    <Link to={to} className={navLink} onClick={onNavigate}>
      <Icon className="size-4 shrink-0" aria-hidden />
      <span>{label}</span>
    </Link>
  );
  const Group = ({ children }: { children: string }) => (
    <p className="mt-4 mb-1 px-2.5 text-[11px] font-bold tracking-wide text-muted-foreground/80">{children}</p>
  );

  return (
    <div className="flex h-full flex-col gap-0.5 overflow-y-auto p-3">
      <div className="flex items-center justify-between px-1.5 pb-2">
        <Link to="/" className="text-[15px] font-extrabold tracking-tight" onClick={onNavigate}>
          knowledge<span className="text-ring">·</span>hub
        </Link>
        <div className="flex items-center gap-0.5">
          <NotificationBell />
          <ThemeToggle />
        </div>
      </div>

      <Button asChild size="sm" className="mb-2 justify-start gap-2">
        <Link to="/articles/new" onClick={onNavigate}><PenLine className="size-4" aria-hidden />記事を書く</Link>
      </Button>

      <Item to="/" icon={Home} label="フィード" />
      <Item to="/search" icon={Search} label="検索" />
      <Item to="/me/bookmarks" icon={Bookmark} label="ブックマーク" />

      <Group>カテゴリ</Group>
      {(categories ?? []).map((c) => (
        <div key={c.id}>
          <Link to={`/categories/${c.id}`} className={navLink} onClick={onNavigate}>
            <span className={`size-2 shrink-0 rounded-sm ${categoryColorClass(c.id)}`} aria-hidden />
            <span>{c.name}</span>
          </Link>
          {c.children.map((child) => (
            <Link key={child.id} to={`/categories/${child.id}`} className={`${navLink} pl-7`} onClick={onNavigate}>
              <span className={`size-2 shrink-0 rounded-sm ${categoryColorClass(child.id)}`} aria-hidden />
              <span>{child.name}</span>
            </Link>
          ))}
        </div>
      ))}
      <Link to="/categories" className={`${navLink} text-ring`} onClick={onNavigate}>
        <ChevronRight className="size-4 shrink-0" aria-hidden /><span>すべてのカテゴリ</span>
      </Link>

      <Group>作成</Group>
      <Item to="/articles/new" icon={PenLine} label="記事を書く" />
      <Item to="/me/articles" icon={PenLine} label="マイ記事" />

      {me?.role === 'admin' && (
        <>
          <Group>管理</Group>
          <Item to="/admin/categories" icon={FolderTree} label="カテゴリ管理" />
          <Item to="/admin" icon={Users} label="ユーザー" />
        </>
      )}

      <div className="mt-auto border-t pt-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="w-full justify-start gap-2 px-2.5" aria-label="アカウント">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-accent-foreground">
                {me?.displayName?.slice(0, 1) ?? '?'}
              </span>
              <span className="truncate text-sm">{me?.displayName ?? 'アカウント'}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem asChild>
              <Link to="/settings" onClick={onNavigate}><Settings className="mr-2 size-4" aria-hidden />設定</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onLogout}><LogOut className="mr-2 size-4" aria-hidden />ログアウト</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
