# UI/UX 刷新 S3: 統一記事カード + フィード/ピックアップ + 各一覧適用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 確定済みの統一記事カード（左横長 16:9 サムネ・画像なしはカテゴリ色フォールバック・カテゴリ/タグ/著者/日付/反応数）を共有コンポーネント化し、フィード・ピックアップ・各一覧（カテゴリ/タグ/著者/マイ記事/ブックマーク/検索）に適用する。

**Architecture:** 一覧付加情報の集約を `fetchListMetadata(db, ids)` に切り出して DRY 化し、article-service（S2 で対応済み）に加え engagement-service（bookmarks）・search-service も同じメタ情報を返すようにする。web は `ArticleCard` を確定デザインに作り替え、`Avatar` を新設。ほとんどの一覧は `ArticleList`→`ArticleCard` 経由なのでカード差し替えで自動反映され、HomePage ピックアップと SearchPage のみ個別対応する。

**Tech Stack:** Hono + Drizzle + PostgreSQL（Testcontainers）、React 19 + Vitest + Testing Library、Tailwind v4 トークン。

**Spec:** `docs/superpowers/specs/2026-07-07-ui-ux-overhaul-design.md` の §5（統一カード）・§7（検索の適用）・§8（アバター統一）・§10(S3)。確定デザインはビジュアルコンパニオンで承認済み（左横長 16:9 サムネ・フォールバックタイル・ピックアップは同カード＋📌＋アクセント枠・縦並び）。

## Global Constraints

- カード表示に必要な付加情報（heroImage/categoryName/authorAvatarUrl/tags/reactionCount/commentCount）を feed だけでなく **bookmarks・search の一覧 API も返す**。集約は `fetchListMetadata`（ページ内 id 集合に対する集約 1 クエリずつ・N+1 禁止）で共通化。件数は実数、commentCount はソフト削除除外。
- 色はトークンのみ（生 hex 禁止）。カテゴリ色は S1 の `categoryColorClass(id)` → `cat-dot-*` を流用（フォールバックタイル背景にも使用）。日付は絶対表記に統一。
- カーソルページング・可視性・権限は変更しない。既存の web テストはカード構造変更に合わせて更新（E2E は後続フェーズ）。
- コミットは英語 Conventional Commits。TDD（RED→GREEN）。完了時 whole-branch レビュー→`pnpm run verify` green。
- あわせて S2 積み残しの小修正: 不正 `heroImageUploadId`（存在しない UUID）で 500 になる点を、createArticle/updateArticle で `assertUploadExists` により 400 に統一（categoryId と対称）。

## ファイル構成

- Modify: `apps/server/src/services/article-service.ts`（`enrichListItems` を `fetchListMetadata` ベースに、`assertUploadExists` 追加、create/update で呼ぶ）
- Modify: `apps/server/src/services/engagement-service.ts`（`BookmarkedArticle` 拡張・`listBookmarks` で categories join＋メタ付与）
- Modify: `apps/server/src/services/search-service.ts`（`SearchResultItem` 拡張・categories join＋メタ付与）
- Test: `article-service.*.test.ts` / `engagement-service.test.ts` / `search-service.test.ts`
- Create: `apps/web/src/components/Avatar.tsx`（画像 or イニシャル）＋ `Avatar.test.tsx`
- Modify: `apps/web/src/components/ArticleCard.tsx`（確定デザインに刷新・型拡張）＋ `ArticleCard.test.tsx`
- Modify: `apps/web/src/pages/HomePage.tsx`（ピックアップに variant）
- Modify: `apps/web/src/pages/SearchPage.tsx`（`ArticleCard` を使用）＋ `SearchPage.test.tsx`

---

### Task 1: 一覧メタ情報の共通化（fetchListMetadata）＋ bookmarks/search enrich ＋ assertUploadExists

**Files:**
- Modify: `apps/server/src/services/article-service.ts`
- Modify: `apps/server/src/services/engagement-service.ts`
- Modify: `apps/server/src/services/search-service.ts`
- Test: `apps/server/src/services/article-service.read.test.ts`, `engagement-service.test.ts`, `search-service.test.ts`, `article-service.write.test.ts`

**Interfaces:**
- Produces: `export async function fetchListMetadata(db: Db, ids: string[]): Promise<Map<string, { tags: string[]; reactionCount: number; commentCount: number }>>`（`ids` 空なら空 Map）。`export async function assertUploadExists(db: Db, uploadId: string): Promise<void>`（不在なら `AppError('VALIDATION', '指定された画像が存在しません', 400)`）。
- `BookmarkedArticle` と `SearchResultItem` に追加: `heroImage: string | null; categoryName: string | null; authorAvatarUrl: string | null; tags: string[]; reactionCount: number; commentCount: number;`

- [ ] **Step 1: fetchListMetadata の抽出（リファクタ・挙動不変）**

`article-service.ts` の既存 `enrichListItems` 内の 3 集約（tags/reactions/comments）を `fetchListMetadata(db, ids)` として切り出し、`enrichListItems` はそれを呼んで `items` にマージする形に書き換える（`heroImage`/`categoryName`/`authorAvatarUrl` は従来どおり各一覧の SELECT 由来）。この時点で `pnpm --filter @knowledge-hub/server test` が**変更前と同じく green**であることを確認（純リファクタ）。

- [ ] **Step 2: bookmarks 拡張の失敗テストを書く**

`engagement-service.test.ts` に、ブックマーク一覧が heroImage/categoryName/tags/reactionCount/commentCount を含むことを検証するテストを追加（既存 seed 流儀）。RED 確認（`npx vitest run src/services/engagement-service.test.ts`）。

- [ ] **Step 3: bookmarks を実装**

`BookmarkedArticle` に上記フィールドを追加。`BOOKMARK_COLUMNS` に `heroImageUploadId: articles.heroImageUploadId`・`categoryName: categories.name`（`leftJoin(categories, eq(articles.categoryId, categories.id))`）・`authorAvatarUrl: users.avatarUrl` を追加。`listBookmarks` の items 整形後に `fetchListMetadata` でメタを付与し、`heroImage` は `heroImageUploadId ? \`/api/uploads/${id}\` : null` に写像。カーソル/ORDER BY は不変（categories は 1:1 leftJoin）。

- [ ] **Step 4: search 拡張の失敗テスト＋実装**

`search-service.test.ts` に検索結果が同メタを含むテストを追加、RED→実装（`SearchResultItem` 拡張、SELECT に heroImageUploadId/categoryName/authorAvatarUrl 追加＝categories leftJoin＋users join、結果に `fetchListMetadata` 付与、heroImage 写像）。**snippet は維持**（検索固有）。GREEN。

- [ ] **Step 5: assertUploadExists（S2 積み残し）**

`article-service.ts` に `assertUploadExists` を追加し、`createArticle`/`updateArticle` の冒頭（`assertCategoryExists` と同じ位置・`input.heroImageUploadId` があるとき）で呼ぶ。`engagement-service.test.ts` ではなく `article-service.write.test.ts` に「不在 heroImageUploadId で 400（500 でない）」テストを追加、RED→GREEN。

- [ ] **Step 6: 全 server テスト＋型** — Run: `pnpm --filter @knowledge-hub/server test`（全 PASS）、`pnpm -r typecheck`（web additive-safe）。

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/services/article-service.ts apps/server/src/services/engagement-service.ts apps/server/src/services/search-service.ts apps/server/src/services/*.test.ts
git commit -m "feat(server): share list metadata across feed, bookmarks and search"
```

---

### Task 2: Avatar コンポーネント ＋ 統一 ArticleCard

**Files:**
- Create: `apps/web/src/components/Avatar.tsx`, `apps/web/src/components/Avatar.test.tsx`
- Modify: `apps/web/src/components/ArticleCard.tsx`
- Modify: `apps/web/src/components/ArticleCard.test.tsx`

**Interfaces:**
- Consumes: S1 の `categoryColorClass`。S2 で拡張された一覧項目（heroImage/categoryName/authorAvatarUrl/tags/reactionCount/commentCount）。
- Produces: `export function Avatar(props: { name: string; src?: string | null; className?: string }): JSX.Element`（src があれば img、無ければイニシャル＋安定色）。`ArticleCard` の `ArticleItem` 型を拡張。

- [ ] **Step 1: Avatar の失敗テスト＋実装**

`Avatar.test.tsx`: src ありで img（alt=name）、src なしで name の頭文字を表示。RED→実装（`aspect` 円形、src あり `<img className="object-cover">`、なし `<span>` にイニシャル、背景は `bg-muted`/`text-muted-foreground` トークン。装飾）。GREEN。

- [ ] **Step 2: ArticleCard の失敗テストを書く**

`ArticleCard.test.tsx` を新デザインに更新（既存の title/author に加え）:

```tsx
it('カテゴリチップ・タグ・反応/コメント数・著者を表示する', () => {
  render(<MemoryRouter><ArticleCard item={{
    id: 'a1', title: 'タイトル', excerpt: '要約', authorId: 'u1', authorName: '佐藤',
    authorAvatarUrl: null, categoryId: 'c1', categoryName: 'デザイン', heroImage: null,
    tags: ['design','ui'], reactionCount: 3, commentCount: 2,
    pinnedAt: null, publishedAt: '2026-07-05T00:00:00Z', updatedAt: '2026-07-05T00:00:00Z',
  }} /></MemoryRouter>);
  expect(screen.getByText('デザイン')).toBeInTheDocument();
  expect(screen.getByText('design')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'タイトル' })).toHaveAttribute('href', '/articles/a1');
  expect(screen.getByText('佐藤')).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();  // 反応数
});
it('heroImage があればサムネ画像、無ければフォールバックタイル', () => {
  const { rerender } = render(<MemoryRouter><ArticleCard item={{ /* heroImage: '/api/uploads/up1' の item */ } as any} /></MemoryRouter>);
  expect(screen.getByRole('img')).toHaveAttribute('src', '/api/uploads/up1');
  rerender(<MemoryRouter><ArticleCard item={{ /* heroImage: null, categoryName:'デザイン' */ } as any} /></MemoryRouter>);
  // フォールバック: img が無く、カテゴリ頭文字タイルが出る
  expect(screen.queryByRole('img')).toBeNull();
});
```

RED 確認。

- [ ] **Step 3: ArticleCard を実装**

`ArticleItem` 型を拡張:

```ts
export type ArticleItem = {
  id: string; title: string; excerpt: string;
  authorId: string; authorName: string; authorAvatarUrl: string | null;
  categoryId: string | null; categoryName: string | null;
  heroImage: string | null; tags: string[]; reactionCount: number; commentCount: number;
  pinnedAt: string | null; publishedAt: string | null; updatedAt: string;
};
```

カード本体（確定デザイン。左 16:9 サムネがカード高さいっぱい・フォールバックタイル・カテゴリチップ・タイトル・抜粋・メタ）:

```tsx
import { Link } from 'react-router';
import { Heart, MessageCircle } from 'lucide-react';
import { categoryColorClass } from '../lib/category-color';
import { Avatar } from './Avatar';

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function ArticleCard({ item, variant = 'default' }: { item: ArticleItem; variant?: 'default' | 'pickup' }) {
  const date = formatDate(item.publishedAt ?? item.updatedAt);
  return (
    <article className={`flex items-stretch overflow-hidden rounded-xl border bg-card text-card-foreground transition-colors hover:border-ring/40 ${variant === 'pickup' ? 'border-ring/60' : ''}`}>
      <Link to={`/articles/${item.id}`} className="w-28 shrink-0 self-stretch sm:w-40" aria-hidden tabIndex={-1}>
        {item.heroImage ? (
          <img src={item.heroImage} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className={`flex aspect-[16/9] h-full w-full items-center justify-center text-2xl font-bold text-white ${item.categoryId ? categoryColorClass(item.categoryId) : 'bg-muted'}`}>
            {(item.categoryName ?? item.title).slice(0, 1)}
          </div>
        )}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3.5">
        <div className="flex items-center gap-2">
          {variant === 'pickup' && <span className="text-xs font-bold text-accent-foreground">📌 ピックアップ</span>}
          {item.categoryName && item.categoryId && (
            <Link to={`/categories/${item.categoryId}`} className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-bold text-accent-foreground hover:underline">{item.categoryName}</Link>
          )}
        </div>
        <h3 className="font-semibold leading-snug">
          <Link to={`/articles/${item.id}`} className="hover:underline">{item.title}</Link>
        </h3>
        {item.excerpt && <p className="line-clamp-1 text-xs leading-relaxed text-muted-foreground">{item.excerpt}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <Link to={`/users/${item.authorId}`} className="flex items-center gap-1.5 hover:underline">
            <Avatar name={item.authorName} src={item.authorAvatarUrl} className="size-4" />
            {item.authorName}
          </Link>
          {date && <span>· {date}</span>}
          {item.tags.slice(0, 3).map((t) => (
            <Link key={t} to={`/tags/${encodeURIComponent(t)}`} className="rounded-full border px-2 py-0.5 hover:bg-muted">{t}</Link>
          ))}
          <span className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-1"><Heart className="size-3" aria-hidden />{item.reactionCount}</span>
            <span className="flex items-center gap-1"><MessageCircle className="size-3" aria-hidden />{item.commentCount}</span>
          </span>
        </div>
      </div>
    </article>
  );
}
```

注（トークン原則の例外）: フォールバックタイルの文字は彩度のあるカテゴリ色地の上に載るため `text-white` を用いる（唯一の生色例外・大きな装飾グリフの可読性確保）。厳密にトークン化したい場合は index.css にカテゴリ前景トークンを足してもよいが、本 S3 では `text-white` を許容する。

- [ ] **Step 4: GREEN＋既存一覧テストの追随**

Run: `npx vitest run src/components/ArticleCard.test.tsx src/components/Avatar.test.tsx`（PASS）。続いて `pnpm --filter @knowledge-hub/web test`。**ArticleList を使う各ページのテスト（HomePage/Category/Tag/Profile/MyArticles/Bookmarks）が新カード構造でセレクタ不一致になったら、テスト側を新構造に更新**（機能不変）。ページのモックデータに新フィールド（tags: [], reactionCount: 0 等）を足す必要があれば追加。`pnpm -r typecheck`（web が新 ArticleItem 型で解決すること）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/Avatar.tsx apps/web/src/components/Avatar.test.tsx apps/web/src/components/ArticleCard.tsx apps/web/src/components/ArticleCard.test.tsx apps/web/src/pages/*.test.tsx
git commit -m "feat(web): rebuild article card with thumbnail and metadata"
```

---

### Task 3: HomePage ピックアップ ＋ SearchPage をカードに統一

**Files:**
- Modify: `apps/web/src/pages/HomePage.tsx`
- Modify: `apps/web/src/pages/SearchPage.tsx`
- Modify: `apps/web/src/pages/SearchPage.test.tsx`

**Interfaces:**
- Consumes: Task 2 の `ArticleCard`（`variant` 対応）、Task 1 で enrich された search 結果。

- [ ] **Step 1: HomePage ピックアップに variant 適用**

`HomePage.tsx` のピックアップ描画 `{pickup.data!.map((it) => <ArticleCard key={it.id} item={it} />)}` を `variant="pickup"` 付きに変更（アクセント枠＋📌）。ピックアップ/フィードの item は article-service enriched（S2）なので型は満たす。HomePage.test の pickup/feed モックに新フィールドを追加。RED（あれば）→GREEN。

- [ ] **Step 2: SearchPage をカードに統一（TDD）**

`SearchPage.test.tsx` に、検索結果が `ArticleCard`（カテゴリチップ・著者・反応数）で描画されることを検証するテストを追加/更新。RED→実装: `SearchPage.tsx` の独自 result 描画（snippet の `<p>` 等）を `<ArticleCard item={...} />` に置換し、`SearchResultItem`（Task 1 で拡張済み）を `ArticleItem` 形にマップ（`excerpt: item.snippet` を渡す。snippet をカードの抜粋として表示）。カテゴリ/タグ絞り込みフォームは維持。GREEN。

- [ ] **Step 3: web 全体＋build＋型** — Run: `pnpm --filter @knowledge-hub/web test`、`pnpm --filter @knowledge-hub/web check:contrast`、`pnpm --filter @knowledge-hub/web build`、`pnpm -r typecheck`（すべて green/クリーン）。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/HomePage.tsx apps/web/src/pages/SearchPage.tsx apps/web/src/pages/SearchPage.test.tsx
git commit -m "feat(web): apply unified card to pickup and search"
```

---

## 完了条件

- 全タスク後、最終 whole-branch レビュー → `pnpm run verify` exit 0。
- フィード・ピックアップ・カテゴリ/タグ/著者/マイ記事/ブックマーク/検索の全一覧が統一カード（16:9 サムネ＋フォールバック・カテゴリ/タグ/著者/日付/反応数）で表示され、ピックアップは 📌＋アクセント枠で区別される。
- コントローラー実 DB/実ブラウザ確認（任意・マージ判断前）: 各一覧のカード表示、ヒーロー画像あり/なし（フォールバック）、ピックアップ、ダーク。
