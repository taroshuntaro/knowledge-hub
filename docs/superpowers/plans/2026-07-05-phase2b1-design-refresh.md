# Phase 2b-1: デザイン基盤 + 全画面刷新 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** shadcn/ui + Tailwind CSS v4 のデザインシステム（トークン・ライト/ダーク両テーマ）を導入し、全 8 画面を機能変更ゼロで刷新する。

**Architecture:** デザイントークン（CSS 変数）を唯一の色の源泉とし、shadcn/ui コンポーネント（コード所有）と Tailwind ユーティリティで全画面を再構成する。ロジック・API 呼び出し・ルーティングは一切変更しない。テーマは `.dark` クラス方式で、`index.html` のインラインスクリプトで FOUC を防ぐ。

**Tech Stack:** Tailwind CSS v4（`@tailwindcss/vite`）、shadcn/ui（new-york style / CSS variables）、@tailwindcss/typography、lucide-react、culori（コントラスト検証スクリプト用 devDep）

**Spec:** `docs/superpowers/specs/2026-07-05-phase2b-design-refresh-editor-design.md`

## Global Constraints

- **機能変更ゼロ**: API 呼び出し・ルーティング・状態管理・ユーザー可視の文言（ラベル・ボタン名・エラー文）は一切変更しない。既存テストは無修正で green を維持する（`getByLabelText`/`getByRole` が壊れる変更は禁止）。
- **トークンが唯一の色の源泉**: コンポーネントに生の色コード（`#xxx` / `oklch(...)` 等）を直書きしない。`bg-background` `text-muted-foreground` 等のセマンティックユーティリティのみ使う。**例外**: shadcn CLI が生成する `components/ui/` 配下は生成コードのままでよい。
- **フォントはシステムスタックのみ**: 外部 CDN からの Web フォント読み込みは禁止。
- **コントラストはライト/ダーク両テーマで WCAG AA**（本文 4.5:1 以上）。`pnpm --filter @knowledge-hub/web check:contrast` で機械検証する。
- **375px 幅でレイアウトが崩れない**こと（横スクロールが発生しない）。
- マージ時点で旧 `styles.css` と旧クラス名（`auth-form` 等）を残さない。
- native `<select>`（CategorySelect / AdminCategoriesPage）は Radix Select に置き換えず、クラスでスタイルする（テスト・挙動維持のため）。
- 各タスク完了時に `pnpm --filter @knowledge-hub/web test` と `pnpm --filter @knowledge-hub/web typecheck` が green であること。

## File Structure

```
apps/web/
  index.html                     # 変更: FOUC 防止スクリプト
  vite.config.ts                 # 変更: tailwind プラグイン + @/ エイリアス
  tsconfig.json                  # 変更: paths 追加
  package.json                   # 変更: 依存追加 + check:contrast スクリプト
  components.json                # 新規: shadcn 設定
  scripts/check-contrast.mjs     # 新規: AA コントラスト検証
  src/
    index.css                    # 新規: トークン + Tailwind（styles.css の後継）
    styles.css                   # Task 10 で削除
    lib/utils.ts                 # 新規: cn()
    lib/theme.ts                 # 新規: テーマ切替ロジック
    lib/theme.test.ts            # 新規
    components/ui/*              # 新規: shadcn 生成物
    components/ThemeToggle.tsx   # 新規
    components/Loading.tsx       # 新規: ローディング共通
    components/EmptyState.tsx    # 新規: 空状態共通
    components/AuthShell.tsx     # 新規: 認証系画面の外枠
    （既存の components/pages は className 刷新のみ）
```

## モデル・スキル指定

- **Task 4（デザイン基盤の確定）は実装サブエージェントに frontend-design スキルの使用を必須とし、セッション最上位モデルで dispatch する**（創作タスクのため）。
- その他のタスクは通常どおり（2a と同じ sonnet）。

---

### Task 1: Tailwind v4 とパスエイリアスの基盤導入

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/tsconfig.json`
- Create: `apps/web/src/index.css`
- Modify: `apps/web/src/main.tsx`

**Interfaces:**
- Produces: `@/` エイリアス（`src/` を指す）、`src/index.css` のトークンスキャフォールド（shadcn ニュートラル既定値。Task 4 が値を最終化する）、`bg-background` 等のセマンティックユーティリティ

- [ ] **Step 1: 依存を追加**

```bash
cd /path/to/knowledge-hub
pnpm --filter @knowledge-hub/web add tailwindcss @tailwindcss/vite @tailwindcss/typography
```

- [ ] **Step 2: vite.config.ts にプラグインとエイリアスを追加**

```ts
import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: { proxy: { '/api': 'http://localhost:3000' } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

- [ ] **Step 3: tsconfig.json に paths を追加**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 4: src/index.css を作成（トークンスキャフォールド）**

値は shadcn ニュートラル既定。**Task 4 が frontend-design で値を最終化する**（構造はここで確定）。

```css
@import 'tailwindcss';
@plugin '@tailwindcss/typography';

@custom-variant dark (&:is(.dark *));

:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  /* destructive は白文字で AA (4.5) を満たすよう red-700 相当まで深くしている */
  --destructive: oklch(0.505 0.213 27.518);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --radius: 0.625rem;
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  /* ダーク側も白文字で AA を満たす深さを維持する */
  --destructive: oklch(0.505 0.213 27.518);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
}

@theme inline {
  --font-sans: 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Noto Sans JP', system-ui, sans-serif;
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

@layer base {
  * {
    border-color: var(--color-border);
  }
  body {
    background-color: var(--color-background);
    color: var(--color-foreground);
    font-family: var(--font-sans);
  }
}

/* 記事本文（prose）をトークンに連動させる。.dark でも変数が切り替わるので prose-invert 不要 */
.prose {
  --tw-prose-body: var(--foreground);
  --tw-prose-headings: var(--foreground);
  --tw-prose-lead: var(--muted-foreground);
  --tw-prose-links: var(--primary);
  --tw-prose-bold: var(--foreground);
  --tw-prose-counters: var(--muted-foreground);
  --tw-prose-bullets: var(--muted-foreground);
  --tw-prose-hr: var(--border);
  --tw-prose-quotes: var(--foreground);
  --tw-prose-quote-borders: var(--border);
  --tw-prose-captions: var(--muted-foreground);
  --tw-prose-code: var(--foreground);
  --tw-prose-pre-code: var(--card-foreground);
  --tw-prose-pre-bg: var(--card);
  --tw-prose-th-borders: var(--border);
  --tw-prose-td-borders: var(--border);
}
```

- [ ] **Step 5: main.tsx で index.css を読み込む（styles.css は移行完了まで残す）**

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 6: 検証**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck && pnpm --filter @knowledge-hub/web build`
Expected: 既存テスト全 green、typecheck / build クリーン

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "build(web): add tailwind v4 with token scaffold and @/ alias"
```

---

### Task 2: shadcn/ui 基盤の導入

**Files:**
- Create: `apps/web/components.json`
- Create: `apps/web/src/lib/utils.ts`
- Create: `apps/web/src/components/ui/`（CLI 生成: button, input, label, card, badge, separator, skeleton, table, textarea）
- Modify: `apps/web/package.json`（CLI が依存を追加）

**Interfaces:**
- Consumes: Task 1 の `@/` エイリアスとトークン
- Produces: `cn(...inputs)`（`@/lib/utils`）、`Button`（variant: default/ghost/outline/destructive, size: default/sm/icon）、`Input`、`Label`、`Card`/`CardHeader`/`CardTitle`/`CardContent`、`Badge`（variant: default/secondary/outline）、`Separator`、`Skeleton`、`Table` 系、`Textarea`（すべて `@/components/ui/*`）

- [ ] **Step 1: components.json を作成**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

- [ ] **Step 2: ユーティリティ依存と cn() を作成**

```bash
pnpm --filter @knowledge-hub/web add class-variance-authority clsx tailwind-merge lucide-react
```

`apps/web/src/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 3: コンポーネントを CLI で生成**

```bash
cd apps/web
pnpm dlx shadcn@latest add button input label card badge separator skeleton table textarea --yes
```

Expected: `src/components/ui/` に 9 ファイル生成。CLI が対話を要求して失敗する場合は `--overwrite` を付けて再実行。

- [ ] **Step 4: 検証**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck`
Expected: 既存テスト全 green（ui/ 配下は未使用でも型が通ること）

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): add shadcn/ui base components"
```

---

### Task 3: テーマ切替基盤（TDD）

**Files:**
- Create: `apps/web/src/lib/theme.ts`
- Create: `apps/web/src/lib/theme.test.ts`
- Create: `apps/web/src/components/ThemeToggle.tsx`
- Modify: `apps/web/index.html`

**Interfaces:**
- Consumes: Task 2 の `Button`
- Produces: `applyTheme(t: 'light' | 'dark'): void`、`getInitialTheme(): 'light' | 'dark'`、`useTheme(): 'light' | 'dark'`（リアクティブ。Task 8 の CodeMirror が使用）、`<ThemeToggle />`（Task 4 の Layout が使用）

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/lib/theme.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, getInitialTheme } from './theme';

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('applyTheme(dark) は .dark を付与し localStorage に保存する', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('applyTheme(light) は .dark を外す', () => {
    applyTheme('dark');
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('getInitialTheme は localStorage を最優先する', () => {
    localStorage.setItem('theme', 'dark');
    expect(getInitialTheme()).toBe('dark');
  });

  it('getInitialTheme は localStorage が無ければ prefers-color-scheme に従う', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    expect(getInitialTheme()).toBe('dark');
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @knowledge-hub/web test -- src/lib/theme.test.ts`
Expected: FAIL（`theme.ts` が存在しない）

- [ ] **Step 3: theme.ts を実装**

```ts
import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';
const EVENT = 'themechange';

export function getInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  localStorage.setItem(STORAGE_KEY, theme);
  window.dispatchEvent(new Event(EVENT));
}

function currentTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(EVENT, callback);
  return () => window.removeEventListener(EVENT, callback);
}

/** 現在のテーマをリアクティブに返す（ThemeToggle での切替に追従する） */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, currentTheme);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @knowledge-hub/web test -- src/lib/theme.test.ts`
Expected: PASS（4 件）

- [ ] **Step 5: ThemeToggle を作成**

`apps/web/src/components/ThemeToggle.tsx`:

```tsx
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { applyTheme, useTheme } from '@/lib/theme';

export function ThemeToggle() {
  const theme = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={next === 'dark' ? 'ダークテーマに切り替え' : 'ライトテーマに切り替え'}
      onClick={() => applyTheme(next)}
    >
      {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
```

- [ ] **Step 6: index.html に FOUC 防止スクリプトを追加**

`<title>` の直後（`main.tsx` 読み込みより前）に挿入:

```html
<script>
  (function () {
    try {
      var t = localStorage.getItem('theme');
      if (!t) t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      if (t === 'dark') document.documentElement.classList.add('dark');
    } catch (e) {}
  })();
</script>
```

- [ ] **Step 7: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck`
Expected: 全 green

```bash
git add apps/web
git commit -m "feat(web): add light/dark theme toggle with fouc-safe init"
```

---

### Task 4: デザイン基盤の確定（frontend-design・最上位モデル）

**Files:**
- Modify: `apps/web/src/index.css`（`:root` / `.dark` のトークン値を最終化）
- Create: `apps/web/scripts/check-contrast.mjs`
- Modify: `apps/web/package.json`（culori devDep + `check:contrast` スクリプト）
- Modify: `apps/web/src/components/Layout.tsx`
- Modify: `apps/web/src/components/ArticleCard.tsx`
- Modify: `apps/web/src/components/ArticleList.tsx`
- Create: `apps/web/src/components/Loading.tsx`
- Create: `apps/web/src/components/EmptyState.tsx`
- Modify: `apps/web/src/pages/HomePage.tsx`
- Modify: `apps/web/src/auth/RequireAuth.tsx`

**Interfaces:**
- Consumes: Task 1 のトークン構造、Task 2 の ui コンポーネント、Task 3 の `<ThemeToggle />`
- Produces: 最終トークン値（全後続タスクの見た目の源泉）、`<Loading />`（props なし）、`<EmptyState message={string} />`（Task 7 が使用）、刷新済み `ArticleCard`/`ArticleList`

> **このタスクは frontend-design スキルを必ず使用すること。** デザインの方向性はスペック（エディトリアル基調 + 温かみのある 1 アクセントカラー、システムフォントのみ、AA コントラスト）に従う。以下のコードは構造の確定版・トークン値は**候補**であり、frontend-design での検討結果で上書きしてよい（構造・クラス名は変えない）。

- [ ] **Step 1: コントラスト検証スクリプトを作成**

```bash
pnpm --filter @knowledge-hub/web add -D culori
```

`apps/web/scripts/check-contrast.mjs`:

```js
// index.css のトークンから WCAG AA コントラストを機械検証する
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse, wcagContrast } from 'culori';

const css = readFileSync(fileURLToPath(new URL('../src/index.css', import.meta.url)), 'utf8');

function extractVars(selector) {
  const re = new RegExp(`${selector}\\s*\\{([^}]*)\\}`);
  const body = css.match(re)?.[1] ?? '';
  const vars = {};
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

const themes = { light: extractVars(':root'), dark: extractVars('\\.dark') };
// [前景, 背景, 最低比] — 本文・ボタン文字はすべて AA (4.5)
const pairs = [
  ['foreground', 'background', 4.5],
  ['muted-foreground', 'background', 4.5],
  ['card-foreground', 'card', 4.5],
  ['muted-foreground', 'card', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['secondary-foreground', 'secondary', 4.5],
  ['accent-foreground', 'accent', 4.5],
  ['destructive-foreground', 'destructive', 4.5],
];

let failed = false;
for (const [name, vars] of Object.entries(themes)) {
  for (const [fg, bg, min] of pairs) {
    const f = parse(vars[fg]);
    const b = parse(vars[bg]);
    if (!f || !b) {
      console.error(`${name}: --${fg} / --${bg} をパースできません`);
      failed = true;
      continue;
    }
    const ratio = wcagContrast(f, b);
    const ok = ratio >= min;
    if (!ok) failed = true;
    console.log(`${ok ? 'ok  ' : 'FAIL'} [${name}] ${fg} on ${bg}: ${ratio.toFixed(2)} (>= ${min})`);
  }
}
process.exit(failed ? 1 : 0);
```

`apps/web/package.json` の scripts に追加:

```json
"check:contrast": "node scripts/check-contrast.mjs"
```

- [ ] **Step 2: スクリプトがスキャフォールド値で動くことを確認**

Run: `pnpm --filter @knowledge-hub/web check:contrast`
Expected: 全ペア出力（スキャフォールドはニュートラルなので全 ok のはず）

- [ ] **Step 3: frontend-design スキルでトークン値を最終化**

frontend-design スキルを読み、スペックの制約下で `:root` / `.dark` の値を決定して `index.css` を更新する。候補（このまま採用しても、方向性を保って調整してもよい）:

- ライト: 背景は温かみのあるオフホワイト（例 `oklch(0.985 0.004 85)`）、前景はウォームな墨色（例 `oklch(0.24 0.012 60)`）、primary は濃いインク色、accent は控えめなテラコッタ系（例 `oklch(0.93 0.035 45)` 地 + 濃い前景）
- ダーク: 背景 `oklch(0.185 0.01 60)` 前後の温かみのある暗色、コントラスト AA を維持
- `--radius: 0.625rem` 程度（カードの丸み = 親しみ要素）

- [ ] **Step 4: コントラスト検証が通ることを確認**

Run: `pnpm --filter @knowledge-hub/web check:contrast`
Expected: exit 0・全ペア ok（1 つでも FAIL なら Step 3 に戻る）

- [ ] **Step 5: 共通コンポーネントを作成**

`apps/web/src/components/Loading.tsx`:

```tsx
import { Skeleton } from '@/components/ui/skeleton';

export function Loading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <p className="sr-only">読み込み中…</p>
    </div>
  );
}
```

`apps/web/src/components/EmptyState.tsx`:

```tsx
import { FileText } from 'lucide-react';

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-muted-foreground">
      <FileText className="size-8" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}
```

- [ ] **Step 6: Layout を刷新**

ロジック（useMe / onLogout / リンク構成）は不変。JSX を置き換える:

```tsx
import { Link, Outlet, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useMe } from '../auth/useMe';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ThemeToggle';

export function Layout() {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function onLogout() {
    await api.api.auth.logout.$post();
    await queryClient.invalidateQueries({ queryKey: ['me'] });
    navigate('/login');
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
          <Link to="/" className="text-lg font-bold tracking-tight">knowledge-hub</Link>
          <nav className="flex flex-wrap items-center gap-1 text-sm">
            <Link to="/articles/new" className="rounded-md px-3 py-2 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">記事を書く</Link>
            <Link to="/me/articles" className="rounded-md px-3 py-2 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">マイ記事</Link>
            {me?.role === 'admin' && <Link to="/admin/categories" className="rounded-md px-3 py-2 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">カテゴリ</Link>}
            {me?.role === 'admin' && <Link to="/admin" className="rounded-md px-3 py-2 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">管理</Link>}
            <Link to="/settings" className="rounded-md px-3 py-2 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">設定</Link>
            <span className="hidden px-2 text-muted-foreground sm:inline">{me?.displayName}</span>
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
```

- [ ] **Step 7: ArticleCard / ArticleList / RequireAuth を刷新**

`ArticleCard.tsx`（型・props 不変）:

```tsx
import { Link } from 'react-router';

export type ArticleItem = {
  id: string; title: string; excerpt: string; authorId: string; authorName: string;
  categoryId: string | null; pinnedAt: string | null; publishedAt: string | null; updatedAt: string;
};

export function ArticleCard({ item }: { item: ArticleItem }) {
  return (
    <article className="group rounded-xl border bg-card p-5 text-card-foreground transition-colors hover:border-ring/40">
      <h3 className="text-lg font-semibold leading-snug">
        <Link to={`/articles/${item.id}`} className="hover:underline">{item.title}</Link>
      </h3>
      {item.excerpt && <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{item.excerpt}</p>}
      <p className="mt-3 text-xs text-muted-foreground">{item.authorName}</p>
    </article>
  );
}
```

`ArticleList.tsx`（props 不変。空状態を EmptyState へ）:

```tsx
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
import { ArticleCard, type ArticleItem } from './ArticleCard';

export function ArticleList({
  items, hasMore, onLoadMore, emptyText = '記事がありません。',
}: {
  items: ArticleItem[];
  hasMore: boolean;
  onLoadMore: () => void;
  emptyText?: string;
}) {
  if (items.length === 0) return <EmptyState message={emptyText} />;
  return (
    <div className="flex flex-col gap-3">
      {items.map((it) => <ArticleCard key={it.id} item={it} />)}
      {hasMore && (
        <Button type="button" variant="outline" className="self-center" onClick={onLoadMore}>もっと見る</Button>
      )}
    </div>
  );
}
```

`RequireAuth.tsx` の loading 行のみ差し替え:

```tsx
if (isLoading) return <p className="p-8 text-center text-muted-foreground">読み込み中…</p>;
```

- [ ] **Step 8: HomePage を刷新**

ロジック（useQuery / useInfiniteQuery）は不変。JSX を置き換える:

```tsx
  if (feed.isError || pickup.isError) return <p className="text-destructive">読み込みに失敗しました。</p>;

  return (
    <div className="space-y-10">
      {(pickup.data ?? []).length > 0 && (
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-xl font-bold tracking-tight">
            <Pin className="size-5 text-accent-foreground" aria-hidden="true" />
            ピックアップ
          </h2>
          <div className="flex flex-col gap-3">
            {pickup.data!.map((it) => <ArticleCard key={it.id} item={it} />)}
          </div>
        </section>
      )}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight">新着</h2>
          <Link to="/articles/new" className="text-sm font-medium text-primary hover:underline">記事を書く</Link>
        </div>
        <ArticleList items={items} hasMore={!!feed.hasNextPage} onLoadMore={() => feed.fetchNextPage()} />
      </section>
    </div>
  );
```

import に `import { Pin } from 'lucide-react';` を追加。`className="primary-link"` の Link は上記のとおり「新着」ヘッダー横に移す（リンク先・文言は不変）。

- [ ] **Step 9: 検証**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck && pnpm --filter @knowledge-hub/web check:contrast && pnpm --filter @knowledge-hub/web build`
Expected: すべて green / ok

- [ ] **Step 10: Commit**

```bash
git add apps/web
git commit -m "feat(web): finalize design tokens and refresh layout, feed and cards"
```

---

### Task 5: 認証系 4 画面の刷新

**Files:**
- Create: `apps/web/src/components/AuthShell.tsx`
- Modify: `apps/web/src/pages/LoginPage.tsx`
- Modify: `apps/web/src/pages/InvitePage.tsx`
- Modify: `apps/web/src/pages/PasswordResetRequestPage.tsx`
- Modify: `apps/web/src/pages/PasswordResetConfirmPage.tsx`

**Interfaces:**
- Consumes: Task 2 の `Card`/`Input`/`Label`/`Button`
- Produces: `<AuthShell title={string}>{children}</AuthShell>`

**重要:** フォームのロジック・ラベル文言・`role="alert"` は不変。`getByLabelText` を維持するため、`<Label htmlFor>` と `<Input id>` を必ず対応させる。

- [ ] **Step 1: AuthShell を作成**

```tsx
import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{title}</CardTitle>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 2: LoginPage の JSX を差し替え**

ロジック（onSubmit / state）は不変:

```tsx
  return (
    <AuthShell title="knowledge-hub">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="login-email">メールアドレス</Label>
          <Input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="login-password">パスワード</Label>
          <Input id="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit">ログイン</Button>
        <Link to="/password-reset" className="text-center text-sm text-muted-foreground hover:text-foreground hover:underline">
          パスワードをお忘れですか？
        </Link>
      </form>
    </AuthShell>
  );
```

- [ ] **Step 3: InvitePage / PasswordResetRequestPage / PasswordResetConfirmPage を同じパターンで差し替え**

各ページ、`<main className="auth-page"><form className="auth-form">` 構造を `AuthShell` + 上記フィールドパターンに置き換える。

- InvitePage: `title="アカウント登録"`、フィールド = 表示名（`id="invite-name"`）/ パスワード（12文字以上）（`id="invite-password"`）、ボタン「登録する」
- PasswordResetRequestPage: `title="パスワード再設定"`、フィールド = メールアドレス（`id="reset-email"`）、ボタン「再設定リンクを送る」。送信完了時の分岐は `<AuthShell title="パスワード再設定"><p className="text-sm leading-relaxed text-muted-foreground">登録されているメールアドレスであれば、再設定用のリンクを送信しました。メールをご確認ください。</p></AuthShell>`
- PasswordResetConfirmPage: `title="新しいパスワード"`、フィールド = パスワード（12文字以上）（`id="new-password"`）、ボタン「パスワードを設定」

いずれも `required` / `minLength` / `maxLength` 属性、エラー表示の `role="alert"` を現状どおり維持する。

- [ ] **Step 4: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck`
Expected: 全 green（LoginPage.test の `getByLabelText('メールアドレス')` 等が通ること）

```bash
git add apps/web
git commit -m "feat(web): refresh auth screens with authshell and shadcn forms"
```

---

### Task 6: 記事詳細と prose

**Files:**
- Modify: `apps/web/src/lib/markdown.tsx`
- Modify: `apps/web/src/pages/ArticleDetailPage.tsx`

**Interfaces:**
- Consumes: Task 1 の prose トークン連動、Task 2 の `Badge`/`Button`/`Separator`、Task 4 の `Loading`

- [ ] **Step 1: Markdown コンポーネントを prose 化**

```tsx
export function Markdown({ source }: { source: string }) {
  return (
    <div className="prose max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 2: ArticleDetailPage の JSX を差し替え**

ロジック（togglePin / moveToTrash / canEdit / canPin / errorMessage）は不変:

```tsx
  if (isLoading) return <Loading />;
  if (isError) return <p className="text-destructive">読み込みに失敗しました。</p>;
  if (!article) return <p className="text-muted-foreground">記事が見つかりません。</p>;
```

```tsx
  return (
    <article className="mx-auto max-w-[42rem]">
      <div className="flex gap-2">
        {article.status === 'draft' && <Badge variant="secondary">下書き</Badge>}
        {article.deletedAt && <Badge variant="outline">削除済み</Badge>}
      </div>
      <h1 className="mt-3 text-3xl font-bold leading-snug tracking-tight">{article.title}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {article.authorName}
        {article.tags.length > 0 && (
          <span className="ml-2 inline-flex flex-wrap gap-1.5">
            {article.tags.map((t) => (
              <Link key={t} to={`/tags/${encodeURIComponent(t)}`} className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
                #{t}
              </Link>
            ))}
          </span>
        )}
      </p>
      <div className="mt-4 flex items-center gap-2">
        {canEdit && (
          <Button asChild variant="outline" size="sm">
            <Link to={`/articles/${id}/edit`}>編集</Link>
          </Button>
        )}
        {canPin && <Button type="button" variant="outline" size="sm" onClick={togglePin}>{article.pinnedAt ? 'ピン解除' : 'ピン留め'}</Button>}
        {canEdit && <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={moveToTrash}>ゴミ箱へ</Button>}
      </div>
      {actionError && <p role="status" className="mt-2 text-sm text-destructive">{actionError}</p>}
      <Separator className="my-6" />
      <Markdown source={article.bodyMd} />
    </article>
  );
```

必要な import（`Badge` `Button` `Separator` `Loading`）を追加。元のタグリンク・文言・`role="status"` は不変。

- [ ] **Step 3: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck`
Expected: 全 green（ArticleDetailPage.test が通ること）

```bash
git add apps/web
git commit -m "feat(web): refresh article detail with prose typography"
```

---

### Task 7: 一覧系画面（マイ記事・カテゴリ・タグ）

**Files:**
- Modify: `apps/web/src/pages/MyArticlesPage.tsx`
- Modify: `apps/web/src/pages/CategoryPage.tsx`
- Modify: `apps/web/src/pages/TagPage.tsx`

**Interfaces:**
- Consumes: Task 4 の `ArticleList`（刷新済み・props 不変）

**重要:** マイ記事のタブは `aria-pressed` 付き `<button>` のまま（Radix Tabs にしない。テスト・挙動維持）。

- [ ] **Step 1: MyArticlesPage のタブと見出しを刷新**

ロジック（TABS / useState / useInfiniteQuery）は不変。JSX:

```tsx
  return (
    <section>
      <h2 className="mb-4 text-xl font-bold tracking-tight">マイ記事</h2>
      <nav className="mb-4 inline-flex rounded-lg bg-muted p-1" aria-label="記事の絞り込み">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
          >
            {t.label}
          </button>
        ))}
      </nav>
      <ArticleList items={items} hasMore={!!q.hasNextPage} onLoadMore={() => q.fetchNextPage()} emptyText="記事がありません。" />
    </section>
  );
```

エラー分岐は `<p className="text-destructive">読み込みに失敗しました。</p>` に差し替え。

- [ ] **Step 2: CategoryPage / TagPage の見出しを刷新**

両ページともロジック不変。見出しとエラー分岐のみ:

```tsx
      <h2 className="mb-4 text-xl font-bold tracking-tight">カテゴリ</h2>
```

TagPage は `<h2 className="mb-4 text-xl font-bold tracking-tight">#{name}</h2>`。エラー分岐は `text-destructive`。

- [ ] **Step 3: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck`
Expected: 全 green（MyArticlesPage.test のタブ操作が通ること）

```bash
git add apps/web
git commit -m "feat(web): refresh my-articles, category and tag list screens"
```

---

### Task 8: エディタ画面の刷新

**Files:**
- Modify: `apps/web/src/pages/EditorPage.tsx`
- Modify: `apps/web/src/components/CategorySelect.tsx`
- Modify: `apps/web/src/components/TagInput.tsx`

**Interfaces:**
- Consumes: Task 2 の `Input`/`Label`/`Button`、Task 3 の `useTheme`

**重要:** 自動保存・楽観ロック・publish のロジックは 1 行も変えない。CodeMirror はテーマ切替に追従させる（`useTheme()` → `theme` prop）。native select は維持。

- [ ] **Step 1: CategorySelect を刷新（native select のまま）**

ロジック不変。`<select>` にクラスを付与:

```tsx
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
```

- [ ] **Step 2: TagInput を刷新**

ロジック（add / 削除）不変:

```tsx
  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
              {t}
              <button
                type="button"
                aria-label={`${t} を削除`}
                onClick={() => onChange(value.filter((x) => x !== t))}
                className="rounded-full text-muted-foreground transition-colors hover:text-foreground"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        placeholder="タグを入力して Enter"
      />
    </div>
  );
```

- [ ] **Step 3: EditorPage の JSX を差し替え**

ロジック（save / publish / 自動保存 useEffect / loadFailed）不変。`const theme = useTheme();` を追加し、JSX:

```tsx
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="grid gap-1.5">
        <Label htmlFor="editor-title">タイトル</Label>
        <Input id="editor-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="editor-category">カテゴリ</Label>
        <CategorySelect id="editor-category" value={categoryId} onChange={setCategoryId} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="editor-tags">タグ</Label>
        <TagInput id="editor-tags" value={tags} onChange={setTags} />
      </div>
      <div className="overflow-hidden rounded-lg border">
        <CodeMirror value={bodyMd} height="480px" theme={theme} extensions={[markdown()]} onChange={setBodyMd} />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {status && <p role="status" className="text-sm text-muted-foreground">{status}</p>}
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={save}>下書き保存</Button>
        <Button type="button" onClick={publish}>公開する</Button>
      </div>
    </section>
  );
```

`getByLabelText` 維持のため、CategorySelect / TagInput に `id?: string` prop を追加して内部の `<select>` / `<Input>` に渡す（props 追加のみ、挙動不変）:

```tsx
export function CategorySelect({ value, onChange, id }: { value: string | null; onChange: (v: string | null) => void; id?: string }) {
```

```tsx
export function TagInput({ value, onChange, id }: { value: string[]; onChange: (v: string[]) => void; id?: string }) {
```

（`id` はそれぞれ `<select id={id}>` / `<Input id={id}>` に渡す）

loadFailed 分岐は `<p role="alert" className="text-destructive">記事の読み込みに失敗しました。</p>`。

- [ ] **Step 4: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck`
Expected: 全 green（EditorPage.test の自動保存・公開フローが通ること）

```bash
git add apps/web
git commit -m "feat(web): refresh editor screen with theme-aware codemirror"
```

---

### Task 9: 管理系 + 設定画面の刷新

**Files:**
- Modify: `apps/web/src/pages/AdminUsersPage.tsx`
- Modify: `apps/web/src/pages/AdminCategoriesPage.tsx`
- Modify: `apps/web/src/pages/SettingsPage.tsx`

**Interfaces:**
- Consumes: Task 2 の `Table` 系 / `Card` / `Input` / `Label` / `Button` / `Textarea` / `Badge`

**重要:** mutation・`alert()`・`role="status"` は不変。shadcn 標準コンポーネントの素組みでよい（デザイン工数を抑える）。

- [ ] **Step 1: AdminUsersPage を刷新**

招待フォームを `Card` に、一覧を shadcn `Table`（`Table`/`TableHeader`/`TableRow`/`TableHead`/`TableBody`/`TableCell`）に置き換える。ロール・状態表示は `Badge`（admin=default, member=secondary / 有効=secondary, 無効=outline）。操作ボタンは `Button variant="outline" size="sm"`。フォームは Task 5 と同じ `Label htmlFor` + `Input id` パターン（`id="invite-email"`）。見出しは `<h2 className="mb-4 text-xl font-bold tracking-tight">ユーザー管理</h2>`。

- [ ] **Step 2: AdminCategoriesPage を刷新**

作成フォームを `Card` 内の `Label`/`Input`/native select（Task 8 Step 1 と同じクラス）に。ツリー表示は:

```tsx
      <ul className="mt-6 space-y-2">
        {(tree ?? []).map((p) => (
          <li key={p.id} className="rounded-lg border bg-card px-4 py-3">
            <span className="font-medium">{p.name}</span>
            {p.children.length > 0 && (
              <ul className="mt-2 space-y-1 border-l pl-4">
                {p.children.map((c) => <li key={c.id} className="text-sm text-muted-foreground">{c.name}</li>)}
              </ul>
            )}
          </li>
        ))}
      </ul>
```

- [ ] **Step 3: SettingsPage を刷新**

プロフィール / パスワード変更の 2 フォームをそれぞれ `Card`（`CardHeader` に h3 相当の `CardTitle`）に。自己紹介は `Textarea`。フィールドは `Label htmlFor` + `Input id`（`id="settings-name"` / `id="settings-bio"` / `id="settings-current-password"` / `id="settings-new-password"`）。ラベル文言（「表示名」「自己紹介」「現在のパスワード」「新しいパスワード（12文字以上）」）は不変。

- [ ] **Step 4: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck`
Expected: 全 green（AdminUsersPage.test が通ること）

```bash
git add apps/web
git commit -m "feat(web): refresh admin and settings screens"
```

---

### Task 10: 旧 CSS の撤去と全体検証

**Files:**
- Delete: `apps/web/src/styles.css`
- Modify: `apps/web/src/main.tsx`（styles.css の import を削除）

- [ ] **Step 1: 旧クラス名の残存がないことを確認**

Run: `grep -rn "auth-form\|auth-page\|article-card\|article-list\|form-error\|primary-link\|markdown-body\|tag-chips\|tag-input\|editor-actions\|className=\"chip\"\|className=\"badge\"\|className=\"meta\"\|className=\"tabs\"\|className=\"header\"\|className=\"content\"\|className=\"layout\"\|className=\"brand\"\|className=\"me\"\|className=\"excerpt\"\|className=\"loading\"" apps/web/src --include='*.tsx' --include='*.ts'`
Expected: ヒット 0 件（残っていたら該当タスクの流儀で置き換えてから進む）

- [ ] **Step 2: styles.css を削除し main.tsx から import を外す**

```bash
git rm apps/web/src/styles.css
```

main.tsx から `import './styles.css';` の行を削除。

- [ ] **Step 3: 全体検証**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck && pnpm --filter @knowledge-hub/web check:contrast && pnpm --filter @knowledge-hub/web build && pnpm typecheck`
Expected: すべて green / ok / クリーン

- [ ] **Step 4: Commit**

```bash
git add -A apps/web
git commit -m "refactor(web): remove legacy stylesheet after design migration"
```

---

## 完了後の検証（コントローラーが実施）

プラン外・マージ判断の材料として、コントローラー（メインセッション）が実施する:

1. dev サーバー（API :3000 / web :5173）を起動し、Playwright（headless Chromium）で全 8 画面 × ライト/ダークのスクリーンショットを取得して目視確認。
2. viewport 375px でフィード・記事詳細・エディタに横スクロールが出ないことを確認。
3. スペックの受け入れ基準（既存テスト green / typecheck・build クリーン / check:contrast 通過）を最終確認。
