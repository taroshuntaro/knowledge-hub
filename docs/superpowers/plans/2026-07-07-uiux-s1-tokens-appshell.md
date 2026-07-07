# UI/UX 刷新 S1: デザイントークン（インディゴ）＋アプリシェル Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ブランド主役色をインディゴに差し替え、アプリシェルを左サイドバー型（モバイルはハンバーガー→ドロワー）に刷新する。機能・データ・API は変更しない。

**Architecture:** 色は `apps/web/src/index.css` のトークンのみ変更（生色は component に書かない原則を維持）。ナビは新設 `Sidebar` コンポーネントに集約し、`Layout` はレスポンシブなシェル（デスクトップ=固定サイドバー、モバイル=上部バー＋スライドドロワー）として作り直す。既存の `useMe`/`ThemeToggle`/`NotificationBell`/`api` を流用する。

**Tech Stack:** React 19 / React Router v7 / TanStack Query / Tailwind v4（`@theme`）/ shadcn/ui（button, dropdown-menu, separator, skeleton）/ lucide-react / Vitest + Testing Library。

**Spec:** `docs/superpowers/specs/2026-07-07-ui-ux-overhaul-design.md` の §3（トークン）・§4（アプリシェル）・§10(S1) が対象（矛盾があればスペックが正）。

## Global Constraints

- **色はトークンが唯一の源泉**。component に生 hex/oklch を直書きしない（カテゴリ色も index.css のクラスに定義し、helper はクラス名を返す）。
- **暖色ニュートラル（紙・墨）は維持**。変更するのは `--primary` `--primary-foreground`(必要時) `--accent` `--accent-foreground` `--ring` と、追加のカテゴリ色クラスのみ。
- **フォントはシステムサンセリフのみ**（外部 CDN 禁止）。
- **AA 必須**: トークン変更後、`pnpm --filter @knowledge-hub/web check:contrast` がライト/ダーク両方 green（全ペア >= 4.5）。FAIL する色は採用しない。
- 機能・API 契約・ルーティング・権限判定は変更しない（`管理` グループは `me.role === 'admin'` のみ表示）。
- コミットは英語 Conventional Commits（subject 小文字・50 字程度・末尾ピリオドなし）。
- TDD: 失敗テスト → RED 確認 → 実装 → GREEN。web テストは `vi.mock('../api/client', ...)` ＋ `MemoryRouter` ＋ `QueryClientProvider` の既存流儀を踏襲。
- 完了時に **web 全テスト green＋`pnpm --filter @knowledge-hub/web build` クリーン＋`pnpm -r typecheck` クリーン**。

## ファイル構成

- Modify: `apps/web/src/index.css` — インディゴトークン（light/dark）＋カテゴリ色クラス。
- Create: `apps/web/src/lib/category-color.ts` — `category.id` → カテゴリ色クラス名（決定論的）。
- Create: `apps/web/src/lib/category-color.test.ts`。
- Create: `apps/web/src/components/Sidebar.tsx` — ナビ本体（閲覧/カテゴリ/作成/管理/アカウント）。
- Create: `apps/web/src/components/Sidebar.test.tsx`。
- Modify: `apps/web/src/components/Layout.tsx` — サイドバー＋モバイルドロワーのシェルに刷新。
- Create: `apps/web/src/components/Layout.test.tsx`。

---

### Task 1: インディゴトークン ＋ カテゴリ色パレット（AA 再検証）

**Files:**
- Modify: `apps/web/src/index.css`（`:root` と `.dark` のトークン、末尾にカテゴリ色クラス）

**Interfaces:**
- Produces: CSS クラス `cat-dot-0`〜`cat-dot-5`（背景色のみ・装飾用、AA 対象外）。Task 2 の `category-color.ts` が名前で参照する。

このタスクの「テスト」は `check:contrast`（機械検証）。値は下記を初期値とし、FAIL があれば L をわずかに動かして全ペア >= 4.5 にする。

- [ ] **Step 1: 現状の contrast が green なことを確認（ベースライン）**

Run: `pnpm --filter @knowledge-hub/web check:contrast`
Expected: 全ペア `ok`（変更前の基準）。

- [ ] **Step 2: `:root`（ライト）の主役色をインディゴに変更**

`apps/web/src/index.css` の `:root` 内、該当トークンを置換（他の暖色ニュートラルは触らない）:

```css
  /* primary はインディゴ。ボタン・リンクの主役色（白文字で AA） */
  --primary: oklch(0.45 0.15 264);
  --primary-foreground: oklch(0.985 0.005 84);
  /* accent はインディゴの淡い地 + 濃インディゴ文字。ピックアップ枠・アクティブナビ等に使う */
  --accent: oklch(0.93 0.045 264);
  --accent-foreground: oklch(0.42 0.15 264);
  /* ring はインディゴ。フォーカスとカード hover */
  --ring: oklch(0.58 0.15 264);
```

- [ ] **Step 3: `.dark` の主役色をインディゴに変更**

`.dark` 内、該当トークンを置換:

```css
  /* ダークは墨チャコール地に明るめインディゴ。primary は暗文字で AA */
  --primary: oklch(0.62 0.15 264);
  --primary-foreground: oklch(0.18 0.02 265);
  --accent: oklch(0.32 0.06 264);
  --accent-foreground: oklch(0.82 0.09 264);
  --ring: oklch(0.68 0.13 264);
```

- [ ] **Step 4: カテゴリ色クラスを追加**

`apps/web/src/index.css` の末尾（`@layer base` の外）に追加。装飾用の小さな色ドット/フォールバックタイル背景（AA 非対象）。ライト/ダークで `.dark` により明度を上げる:

```css
/* カテゴリ識別色（装飾のみ・AA 対象外）。category-color.ts が id からクラスを決定論的に選ぶ */
.cat-dot-0 { background-color: oklch(0.55 0.13 264); }
.cat-dot-1 { background-color: oklch(0.60 0.11 60); }
.cat-dot-2 { background-color: oklch(0.58 0.10 160); }
.cat-dot-3 { background-color: oklch(0.58 0.13 320); }
.cat-dot-4 { background-color: oklch(0.60 0.11 30); }
.cat-dot-5 { background-color: oklch(0.55 0.10 200); }
.dark .cat-dot-0 { background-color: oklch(0.68 0.13 264); }
.dark .cat-dot-1 { background-color: oklch(0.72 0.11 60); }
.dark .cat-dot-2 { background-color: oklch(0.70 0.10 160); }
.dark .cat-dot-3 { background-color: oklch(0.70 0.13 320); }
.dark .cat-dot-4 { background-color: oklch(0.72 0.11 30); }
.dark .cat-dot-5 { background-color: oklch(0.68 0.10 200); }
```

- [ ] **Step 5: contrast を再検証（GREEN）**

Run: `pnpm --filter @knowledge-hub/web check:contrast`
Expected: ライト/ダーク両方 全ペア `ok`。`FAIL [light] primary-foreground on primary` 等が出たら、その pair に絡む L を 0.01〜0.03 動かして再実行（primary は暗く、accent-foreground は濃く／accent は淡く）。全 green になるまで繰り返す。

- [ ] **Step 6: 既存 web テストと build が壊れていないこと**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web build`
Expected: 既存テスト全 PASS（トークン変更はテストに影響しない）、build クリーン。

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/index.css
git commit -m "feat(web): switch brand tokens to indigo and add category colors"
```

---

### Task 2: カテゴリ色ヘルパー ＋ Sidebar コンポーネント

**Files:**
- Create: `apps/web/src/lib/category-color.ts`
- Create: `apps/web/src/lib/category-color.test.ts`
- Create: `apps/web/src/components/Sidebar.tsx`
- Create: `apps/web/src/components/Sidebar.test.tsx`

**Interfaces:**
- Consumes: Task 1 の `cat-dot-0`〜`cat-dot-5` クラス。既存 `useMe()`（`{ id, displayName, role, avatarUrl, ... } | null`）、`ThemeToggle`、`NotificationBell`、`api`（`api.api.categories.$get()` が `CategoryNode[]` を返す。`CategoryNode = { id: string; name: string; parentId: string | null; sortOrder: number; children: CategoryNode[] }`）。
- Produces: `export function Sidebar(props: { onNavigate?: () => void }): JSX.Element`（`onNavigate` はモバイルドロワーが遷移時に閉じるためのコールバック。各 `Link` の onClick で呼ぶ）。`export function categoryColorClass(id: string): string`。

- [ ] **Step 1: category-color の失敗テストを書く**

`apps/web/src/lib/category-color.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { categoryColorClass } from './category-color';

describe('categoryColorClass', () => {
  it('cat-dot-0〜5 のいずれかを返す', () => {
    expect(categoryColorClass('any-id')).toMatch(/^cat-dot-[0-5]$/);
  });
  it('同じ id では常に同じクラス（決定論的）', () => {
    expect(categoryColorClass('abc')).toBe(categoryColorClass('abc'));
  });
  it('異なる id で分散する（少なくとも 2 種類に割れる）', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const set = new Set(ids.map(categoryColorClass));
    expect(set.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: RED 確認**

Run: `cd apps/web && npx vitest run src/lib/category-color.test.ts`
Expected: FAIL（module 不存在）。

- [ ] **Step 3: category-color.ts を実装**

```ts
// category.id を決定論的にカテゴリ色クラス（cat-dot-0〜5）へ写像する。
// 生色は index.css のクラス側に持ち、ここではクラス名だけを扱う。
const PALETTE_SIZE = 6;

export function categoryColorClass(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) % 1_000_000_007;
  }
  return `cat-dot-${hash % PALETTE_SIZE}`;
}
```

- [ ] **Step 4: GREEN 確認**

Run: `npx vitest run src/lib/category-color.test.ts`
Expected: PASS。

- [ ] **Step 5: Sidebar の失敗テストを書く**

`apps/web/src/components/Sidebar.test.tsx`（`NotificationBell` はここでは本質でないのでモック）:

```tsx
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
    expect(screen.getByRole('link', { name: '記事を書く' })).toBeInTheDocument();
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
```

- [ ] **Step 6: RED 確認**

Run: `npx vitest run src/components/Sidebar.test.tsx`
Expected: FAIL（`Sidebar` 不存在）。

- [ ] **Step 7: Sidebar.tsx を実装**

```tsx
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
```

注: 「記事を書く」は上部 primary ボタンとナビ項目の 2 箇所に出る（テストは両方 `link name: '記事を書く'` を許容するため `getAllByRole` を使わずとも `getByRole` が複数一致で失敗する場合は、Step 5 のテストを `getAllByRole('link', { name: '記事を書く' }).length >= 1` に調整する）。実装後 Step 8 で確認し、複数一致でテストが割れるなら**テスト側**を `getAllByRole` に修正する（実装の重複はデザイン意図なので残す）。

- [ ] **Step 8: GREEN 確認**

Run: `npx vitest run src/components/Sidebar.test.tsx`
Expected: PASS。複数一致エラーが出たら上記注のとおりテストを `getAllByRole` に調整して再実行。

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/category-color.ts apps/web/src/lib/category-color.test.ts apps/web/src/components/Sidebar.tsx apps/web/src/components/Sidebar.test.tsx
git commit -m "feat(web): add sidebar navigation with categories and account menu"
```

---

### Task 3: Layout をサイドバーシェル＋モバイルドロワーに刷新

**Files:**
- Modify: `apps/web/src/components/Layout.tsx`
- Create: `apps/web/src/components/Layout.test.tsx`

**Interfaces:**
- Consumes: Task 2 の `Sidebar`。既存 `Outlet`（react-router）。
- Produces: `export function Layout(): JSX.Element`（App.tsx から従来どおり参照。シグネチャ不変）。

デスクトップ（md+）は固定サイドバー＋本文。モバイル（<md）は上部バー（☰／ワードマーク／＋書く）＋スライドドロワー（同一 `Sidebar`）。ドロワーは state `open`、Esc で閉じる、ルート遷移で閉じる、scrim クリックで閉じる。`Sidebar` は 1 インスタンスのみ描画し、CSS でデスクトップは静的列・モバイルは固定スライドにする。

- [ ] **Step 1: 失敗テストを書く**

`apps/web/src/components/Layout.test.tsx`（`Sidebar` はドロワー挙動の検証に集中するためモックし、中に識別可能な nav を置く）:

```tsx
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
    expect(screen.getByRole('button', { name: 'メニューを閉じる' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('Esc でドロワーが閉じる', async () => {
    renderLayout();
    await userEvent.click(screen.getByRole('button', { name: 'メニューを開く' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'メニューを開く' })).toHaveAttribute('aria-expanded', 'false');
  });
});
```

- [ ] **Step 2: RED 確認**

Run: `npx vitest run src/components/Layout.test.tsx`
Expected: FAIL（現行 Layout にメニューボタンがない）。

- [ ] **Step 3: Layout.tsx を実装**

```tsx
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
```

注: モバイルの「メニューを閉じる」ラベルはトグルボタンと scrim ボタンの 2 箇所に付く。Step 1 のテストは Esc 後に「メニューを開く」ボタン（＝トグルが閉状態）を確認するので一意。ドロワー開状態の aria-expanded は**トグルボタン**（`role button name メニューを閉じる` のうち scrim も同名だが、`aria-expanded` を持つのはトグルのみ）を対象にする。テストで複数一致するなら、トグルに `data-testid="drawer-toggle"` を付け、テストを `getByTestId` に変更してよい（実装優先）。

- [ ] **Step 4: GREEN 確認**

Run: `npx vitest run src/components/Layout.test.tsx`
Expected: PASS。複数一致が出たら上記注のとおりトグルへ `data-testid="drawer-toggle"` を付与しテストを調整。

- [ ] **Step 5: web 全体の回帰確認**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web build && pnpm -r typecheck`
Expected: 全 PASS・build/typecheck クリーン。既存ページテストはページ単体描画のため影響しないはず。もし Layout を描画する既存テストが FAIL したら、そのテストの nav 期待を新シェルに合わせて更新する（機能は不変）。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/Layout.tsx apps/web/src/components/Layout.test.tsx
git commit -m "feat(web): rebuild app shell with sidebar and mobile drawer"
```

---

## 完了条件

- 全タスク後、最終 whole-branch レビュー → `pnpm run verify` exit 0（typecheck＋テスト＋contrast＋build＋audit）。
- コントローラーによる実ブラウザ確認（マージ判断前・任意）: デスクトップでサイドバー表示・カテゴリ 2 階層・アカウントメニュー、モバイルでハンバーガー→ドロワー開閉・Esc/scrim で閉じる、ライト/ダーク両方でインディゴが適用されている。
